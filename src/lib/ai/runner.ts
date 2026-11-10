/**
 * Queue consumers for AI jobs (docs/AI_ASSIST_SPEC.md §3).
 *
 *   main queue: claim → run the feature's steps → done | retry with backoff | failed (+flag)
 *   DLQ:        retries exhausted → failed (+flag)
 *
 * Idempotent: a done/failed job acks without calling the API; a translation stores each finished
 * chunk, so a retry continues where the last attempt stopped. Every API call is logged in ai_usage.
 */
import { apiBaseUrl, resolveApiKey, type AiEnv, type AiJobMessage } from "./config.ts";
import { createClaude, type Claude, type CallOutcome } from "./client.ts";
import { claimJob, completeJob, failJob, getJob, recordUsage, releaseJob, savePartial, type Job } from "./jobs.ts";
import { chunkMarkdown, invariantWarnings } from "./markdown.ts";
import {
   checkSystem,
   documentBlock,
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

async function step(env: RunnerEnv, job: Job, claude: Claude, call: Parameters<Claude["call"]>[0], now: () => number): Promise<unknown> {
   const out: CallOutcome = await claude.call(call);
   if (out.usage) await recordUsage(env.DB, { env: env.ENVIRONMENT, job, usage: out.usage, status: out.ok ? "ok" : out.code, now: now() });
   if (!out.ok) throw new StepFailed(out.code, out.retryable);
   return out.data;
}

async function translate(env: RunnerEnv, job: Job, claude: Claude, now: () => number) {
   const { input } = job;
   const to = job.target_locale ?? (job.locale === "en" ? "ar" : "en");
   const cfg = MODELS.translate;
   const system = translateSystem(job.locale, to);
   const chunks = chunkMarkdown(input.body);
   const partial = job.partial ?? { chunks: [] };
   const count = Math.max(1, chunks.length);
   for (let i = 0; i < count; i++) {
      if (typeof partial.chunks[i] === "string" && (i > 0 || partial.title !== undefined)) continue;
      const first = i === 0;
      const fields: Record<string, string> = first ? { title: input.title, summary: input.summary, body: chunks[0] ?? "" } : { body: chunks[i] };
      const note = count > 1 ? `\n\nThis is part ${i + 1} of ${count} of the body; translate only this part.` : "";
      const data = await step(env, job, claude, { ...cfg, system, user: documentBlock(fields) + note, schema: first ? SCHEMAS.translateFirst : SCHEMAS.translateMore }, now);
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

async function run(env: RunnerEnv, job: Job, claude: Claude, now: () => number): Promise<unknown> {
   const { input } = job;
   if (job.feature === "translate") return translate(env, job, claude, now);
   const doc = documentBlock({ title: input.title, summary: input.summary, body: input.body });
   try {
      if (job.feature === "seo") return validateSeo(await step(env, job, claude, { ...MODELS.seo, system: seoSystem(job.locale), user: doc, schema: SCHEMAS.seo }, now));
      return validateCheck(await step(env, job, claude, { ...MODELS.check, system: checkSystem(input.ui), user: doc, schema: SCHEMAS.check }, now));
   } catch (e) {
      if (e instanceof InvalidOutput) throw new StepFailed("invalid_output", true);
      throw e;
   }
}

/** Runs one job delivery. `attempts` = the queue's delivery count (1-based). */
export async function runJob(env: RunnerEnv, jobId: string, claude: Claude | null, attempts: number, now: () => number = Date.now): Promise<Outcome> {
   const { job, busy } = await claimJob(env.DB, jobId, now());
   if (!job) return busy ? { kind: "retry", delaySeconds: 60, error: "busy" } : { kind: "skip" };
   if (!claude) {
      await failJob(env.DB, jobId, "not_configured", now());
      return { kind: "failed", error: "not_configured" };
   }
   try {
      const result = await run(env, job, claude, now);
      await completeJob(env.DB, jobId, result, now());
      return { kind: "done" };
   } catch (e) {
      const code = e instanceof StepFailed ? e.code : "unknown";
      const retryable = e instanceof StepFailed ? e.retryable : true;
      if (!(e instanceof StepFailed)) console.error(JSON.stringify({ msg: "ai_job_error", jobId, error: e instanceof Error ? e.name : "unknown" }));
      if (retryable) {
         await releaseJob(env.DB, jobId, code, now());
         return { kind: "retry", delaySeconds: backoffSeconds(attempts), error: code };
      }
      await failJob(env.DB, jobId, code, now());
      return { kind: "failed", error: code };
   }
}

export async function claudeFor(env: AiEnv, fetchImpl?: typeof fetch): Promise<Claude | null> {
   const apiKey = await resolveApiKey(env);
   return apiKey ? createClaude({ apiKey, baseURL: apiBaseUrl(env), fetch: fetchImpl }) : null;
}

export const isDeadLetterQueue = (name: string) => /-dlq(?:-|$)/.test(name);
/** al-ummah-now-cms-ai[-dlq][-stage|-qa]: the AI assist queues (every other consumer is image variants). */
export const isAiQueue = (name: string) => /^al-ummah-now-cms-ai(?:-|$)/.test(name);

/** The Worker's `queue` handler for both the AI queue and its DLQ. */
export async function handleAiQueue(batch: MessageBatch<AiJobMessage>, env: RunnerEnv, fetchImpl?: typeof fetch, now: () => number = Date.now): Promise<void> {
   const dlq = isDeadLetterQueue(batch.queue);
   const claude = dlq ? null : await claudeFor(env, fetchImpl);
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
      const out = await runJob(env, jobId, claude, msg.attempts, now);
      if (out.kind === "retry") msg.retry({ delaySeconds: out.delaySeconds });
      else msg.ack();
   }
}
