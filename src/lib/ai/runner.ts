/**
 * Queue consumers for AI jobs (docs/AI_ASSIST_SPEC.md §3).
 *
 *   main queue: claim → run the feature's steps → done | retry with backoff | failed (+flag)
 *   DLQ:        retries exhausted → failed (+flag)
 *
 * Idempotent: a done/failed job acks without calling the model; a translation stores each finished
 * chunk, so a retry continues where the last attempt stopped. Every model call (each provider attempt,
 * fallback included) is logged in ai_usage. Before every call the monthly budget is checked: once it
 * is reached the job fails with `budget_reached` instead of spending more.
 */
import type { AiEnv, AiJobMessage } from "./config.ts";
import { budgetState } from "./budget.ts";
import type { Reasoning } from "./providers/types.ts";
import { createRouter, type ProviderDeps, type Router } from "./router.ts";
import { loadSettings, type AiSettings } from "./settings.ts";
import { errText, log } from "../log.ts";
import { claimJob, completeJob, failJob, getJob, recordUsage, releaseJob, savePartial, type Job } from "./jobs.ts";
import { chunkMarkdown, invariantWarnings } from "./markdown.ts";
import { entriesFor, glossaryPrompt } from "../translation-flags/glossary.ts";
import {
   checkSystem,
   documentBlock,
   type Feature,
   InvalidOutput,
   MODELS,
   SCHEMAS,
   seoSystem,
   translateSystem,
   validateCheck,
   validateSeo,
   validateTranslateChunk,
} from "./prompts.ts";

export interface RunnerEnv extends AiEnv {
   DB: D1Database;
}

export type Outcome = { kind: "done" } | { kind: "retry"; delaySeconds: number; error: string } | { kind: "failed"; error: string } | { kind: "skip" };

export const backoffSeconds = (attempt: number) => Math.min(300, 15 * 2 ** Math.max(0, attempt - 1));

class StepFailed extends Error {
   constructor(
      readonly code: string,
      readonly retryable: boolean,
   ) {
      super(code);
   }
}

interface Ctx {
   env: RunnerEnv;
   job: Job;
   router: Router;
   settings: AiSettings;
   now: () => number;
}

interface Call {
   reasoning: Reasoning;
   maxTokens: number;
   system: string;
   user: string;
   schema: Record<string, unknown>;
}

async function step(x: Ctx, feature: Feature, call: Call): Promise<unknown> {
   const budget = await budgetState(x.env.DB, x.env.ENVIRONMENT, x.settings, x.now());
   if (budget.reached) throw new StepFailed("budget_reached", false);
   const out = await x.router.complete(feature, { system: call.system, messages: [{ role: "user", content: call.user }], schema: call.schema, reasoning: call.reasoning, maxTokens: call.maxTokens }, async ({ result }) => {
      await recordUsage(x.env.DB, { env: x.env.ENVIRONMENT, job: x.job, result, now: x.now() });
      if (!result.ok) log.warn("ai call failed", { jobId: x.job.id, provider: result.provider, model: result.model, code: result.code, detail: result.detail });
   });
   if (!out.ok) throw new StepFailed(out.code, out.retryable);
   return out.json;
}

async function translate(x: Ctx) {
   const { env, job, now } = x;
   const { input } = job;
   const to = job.target_locale ?? (job.locale === "en" ? "ar" : "en");
   const cfg = MODELS.translate;
   const glossary = glossaryPrompt(await entriesFor(env.DB, job.locale, `${input.title}\n${input.summary}\n${input.body}`));
   const system = translateSystem(job.locale, to, glossary);
   const chunks = chunkMarkdown(input.body);
   const partial = job.partial ?? { chunks: [] };
   const count = Math.max(1, chunks.length);
   for (let i = 0; i < count; i++) {
      if (typeof partial.chunks[i] === "string" && (i > 0 || partial.title !== undefined)) continue;
      const first = i === 0;
      const fields: Record<string, string> = first ? { title: input.title, summary: input.summary, body: chunks[0] ?? "" } : { body: chunks[i] };
      const note = count > 1 ? `\n\nThis is part ${i + 1} of ${count} of the body; translate only this part.` : "";
      const data = await step(x, "translate", { ...cfg, system, user: documentBlock(fields) + note, schema: first ? SCHEMAS.translateFirst : SCHEMAS.translateMore });
      let parsed;
      try {
         parsed = validateTranslateChunk(data, first);
      } catch (e) {
         throw new StepFailed(e instanceof InvalidOutput ? "invalid_output" : "unknown", true);
      }
      partial.chunks[i] = parsed.body.trim();
      if (first) {
         partial.title = parsed.title ?? "";
         partial.summary = parsed.summary ?? "";
      }
      await savePartial(env.DB, job.id, partial, now());
   }
   const body = partial.chunks.slice(0, count).join("\n\n");
   return { title: partial.title ?? "", summary: partial.summary ?? "", body, locale: to, warnings: invariantWarnings(input.body, body) };
}

async function run(x: Ctx): Promise<unknown> {
   const { job } = x;
   const { input } = job;
   if (job.feature === "translate") return translate(x);
   const doc = documentBlock({ title: input.title, summary: input.summary, body: input.body });
   try {
      if (job.feature === "seo") return validateSeo(await step(x, "seo", { ...MODELS.seo, system: seoSystem(job.locale), user: doc, schema: SCHEMAS.seo }));
      return validateCheck(await step(x, "check", { ...MODELS.check, system: checkSystem(input.ui), user: doc, schema: SCHEMAS.check }));
   } catch (e) {
      if (e instanceof InvalidOutput) throw new StepFailed("invalid_output", true);
      throw e;
   }
}

/** Runs one job delivery. `attempts` = the queue's delivery count (1-based). `deps` overrides providers (tests). */
export async function runJob(env: RunnerEnv, jobId: string, deps: ProviderDeps, attempts: number, now: () => number = Date.now): Promise<Outcome> {
   const { job, busy } = await claimJob(env.DB, jobId, now());
   if (!job) return busy ? { kind: "retry", delaySeconds: 60, error: "busy" } : { kind: "skip" };
   const { settings } = await loadSettings(env.DB);
   const x: Ctx = { env, job, router: createRouter(settings, env, deps), settings, now };
   try {
      const result = await run(x);
      await completeJob(env.DB, jobId, result, now());
      return { kind: "done" };
   } catch (e) {
      const code = e instanceof StepFailed ? e.code : "unknown";
      const retryable = e instanceof StepFailed ? e.retryable : true;
      if (!(e instanceof StepFailed)) log.error("ai job error", { jobId, error: errText(e) });
      if (retryable) {
         await releaseJob(env.DB, jobId, code, now());
         return { kind: "retry", delaySeconds: backoffSeconds(attempts), error: code };
      }
      await failJob(env.DB, jobId, code, now());
      return { kind: "failed", error: code };
   }
}

export const isDeadLetterQueue = (name: string) => /-dlq(?:-|$)/.test(name);
/** al-ummah-now-cms-ai[-dlq][-stage|-qa]: the AI assist queues (every other consumer is image variants). */
export const isAiQueue = (name: string) => /^al-ummah-now-cms-ai(?:-|$)/.test(name);

/** The Worker's `queue` handler for both the AI queue and its DLQ. */
export async function handleAiQueue(batch: MessageBatch<AiJobMessage>, env: RunnerEnv, deps: ProviderDeps = {}, now: () => number = Date.now): Promise<void> {
   const dlq = isDeadLetterQueue(batch.queue);
   for (const msg of batch.messages) {
      const jobId = typeof msg.body?.jobId === "string" ? msg.body.jobId : "";
      if (!jobId) {
         msg.ack();
         continue;
      }
      if (dlq) {
         const job = await getJob(env.DB, jobId);
         if (job && job.status !== "done") await failJob(env.DB, jobId, "retries_exhausted", now());
         msg.ack();
         continue;
      }
      const out = await runJob(env, jobId, deps, msg.attempts, now);
      if (out.kind === "retry") msg.retry({ delaySeconds: out.delaySeconds });
      else msg.ack();
   }
}
