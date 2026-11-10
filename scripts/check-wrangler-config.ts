/**
 * wrangler.jsonc must match the environment table (SPEC §2, scripts/release/envs.ts):
 * top level = production, env.stage and env.qa; custom domains only; workers_dev off; every env
 * lists its own D1 (with migrations_dir) and R2 binding, the Workers AI binding, and the right auth
 * issuer/client id.
 *
 *   node --experimental-strip-types scripts/check-wrangler-config.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "./lib/jsonc.ts";
import { ENVS, type EnvName } from "./release/envs.ts";

interface EnvConfig {
   name?: string;
   workers_dev?: boolean;
   routes?: { pattern: string; custom_domain?: boolean }[];
   vars?: Record<string, string>;
   d1_databases?: { binding: string; database_name: string; database_id: string; migrations_dir?: string }[];
   r2_buckets?: { binding: string; bucket_name: string }[];
   kv_namespaces?: { binding: string; id: string }[];
   ai?: { binding?: string };
   triggers?: { crons?: string[] };
   queues?: {
      producers?: { binding: string; queue: string }[];
      consumers?: { queue: string; max_retries?: number; dead_letter_queue?: string; max_batch_size?: number; max_concurrency?: number }[];
   };
}
interface WranglerConfig extends EnvConfig {
   env?: Record<string, EnvConfig>;
}

export const SNAPSHOT_CRON = "*/30 * * * *";
/** Scheduled posts going live onto the home timeline (src/lib/feed/jobs.ts duePosts). */
export const FEED_DUE_CRON = "* * * * *";

export function checkWranglerConfig(config: WranglerConfig): string[] {
   const errors: string[] = [];
   const envs: [EnvName, EnvConfig][] = [
      ["production", config],
      ["stage", config.env?.stage ?? {}],
      ["qa", config.env?.qa ?? {}],
   ];
   const extra = Object.keys(config.env ?? {}).filter((k) => k !== "stage" && k !== "qa");
   if (extra.length) errors.push(`unexpected envs: ${extra.join(", ")}`);
   for (const [env, c] of envs) {
      const want = ENVS[env];
      const where = env === "production" ? "top level" : `env.${env}`;
      const host = new URL(want.url).host;
      if (c.name !== want.worker) errors.push(`${where}: name ${c.name} ≠ ${want.worker}`);
      if (c.workers_dev !== false) errors.push(`${where}: workers_dev must be false`);
      const routes = c.routes ?? [];
      if (routes.length !== 1 || routes[0].pattern !== host || routes[0].custom_domain !== true) {
         errors.push(`${where}: routes must be exactly [{ pattern: "${host}", custom_domain: true }]`);
      }
      const v = c.vars ?? {};
      if (v.PUBLIC_URL !== want.url) errors.push(`${where}: PUBLIC_URL ${v.PUBLIC_URL} ≠ ${want.url}`);
      if (v.AUTH_ISSUER !== want.authIssuer) errors.push(`${where}: AUTH_ISSUER ${v.AUTH_ISSUER} ≠ ${want.authIssuer}`);
      if (v.AUTH_CLIENT_ID !== want.clientId) errors.push(`${where}: AUTH_CLIENT_ID ${v.AUTH_CLIENT_ID} ≠ ${want.clientId}`);
      if (v.ENVIRONMENT !== env) errors.push(`${where}: ENVIRONMENT ${v.ENVIRONMENT} ≠ ${env}`);
      for (const k of ["VIDEOS_API_URL", "VIDEOS_WEB_URL", "WWW_URL", "WWW_ORIGINS", "ADMIN_API_URL", "ADMIN_WEB_URL"]) {
         if (!v[k]?.startsWith("https://")) errors.push(`${where}: ${k} must be an https URL`);
      }
      if ("BKND_JWT_SECRET" in v || "CMS_CLIENT_SECRET" in v) errors.push(`${where}: secrets must not be vars`);
      // A mock model URL is for local runs only (src/lib/ai/config.ts ignores it outside ENVIRONMENT=local).
      if ("AI_MOCK_URL" in v) errors.push(`${where}: AI_MOCK_URL is local-only (.dev.vars)`);
      // AI assist runs on Workers AI (docs/AI_ASSIST_SPEC.md §2): bindings aren't inherited, each env declares it.
      if (c.ai?.binding !== "AI") errors.push(`${where}: ai must be { binding: "AI" } (Workers AI for AI assist)`);
      // AI assist jobs (docs/AI_ASSIST_SPEC.md §3): producer AI_JOBS, a consumer with a DLQ, and the DLQ's consumer.
      const q = c.queues ?? {};
      const { name: aiQueue, dlq } = want.aiQueue;
      // Other queues (image variants) sit next to these; only the AI ones are checked here.
      const prod = (q.producers ?? []).filter((p) => p.binding === "AI_JOBS");
      if (prod.length !== 1 || prod[0].queue !== aiQueue) errors.push(`${where}: queues.producers must bind AI_JOBS → ${aiQueue}`);
      const cons = q.consumers ?? [];
      const main = cons.find((x) => x.queue === aiQueue);
      if (!main || main.dead_letter_queue !== dlq || main.max_batch_size !== 1 || !(main.max_retries && main.max_retries >= 1)) {
         errors.push(`${where}: queues.consumers needs ${aiQueue} (batch 1, retries ≥ 1, DLQ ${dlq})`);
      }
      if (!cons.some((x) => x.queue === dlq)) errors.push(`${where}: queues.consumers needs the DLQ ${dlq}`);
      if (cons.filter((x) => x.queue === aiQueue || x.queue === dlq).length !== 2) errors.push(`${where}: queues.consumers must consume ${aiQueue} and ${dlq} once each`);
      const d1 = c.d1_databases ?? [];
      if (d1.length !== 1 || d1[0].binding !== "DB" || d1[0].database_name !== want.d1.name || d1[0].database_id !== want.d1.id) {
         errors.push(`${where}: d1_databases must be [DB → ${want.d1.name} (${want.d1.id})]`);
      } else if (d1[0].migrations_dir !== "migrations") errors.push(`${where}: D1 migrations_dir must be "migrations"`);
      // Curated snapshot refresh (src/lib/snapshots.ts); triggers are not inherited by envs.
      if (!(c.triggers?.crons ?? []).includes(SNAPSHOT_CRON)) errors.push(`${where}: triggers.crons must include "${SNAPSHOT_CRON}"`);
      const r2 = c.r2_buckets ?? [];
      if (r2.length !== 1 || r2[0].binding !== "MEDIA" || r2[0].bucket_name !== want.r2) {
         errors.push(`${where}: r2_buckets must be [MEDIA → ${want.r2}]`);
      }
      // Image variant jobs (src/lib/variants/jobs.ts): this env's own queue, consumed by this Worker, with a DLQ.
      // Other queues may sit next to it; only the VARIANTS ones are checked.
      const producers = (c.queues?.producers ?? []).filter((p) => p.binding === "VARIANTS");
      if (producers.length !== 1 || producers[0].queue !== want.variantsQueue) errors.push(`${where}: queues.producers must bind VARIANTS → ${want.variantsQueue}`);
      const consumers = (c.queues?.consumers ?? []).filter((x) => x.queue === want.variantsQueue);
      const consumer = consumers[0];
      if (consumers.length !== 1) errors.push(`${where}: queues.consumers must consume ${want.variantsQueue} once`);
      else {
         if (consumer.dead_letter_queue !== want.variantsDlq) errors.push(`${where}: the variants consumer needs dead_letter_queue ${want.variantsDlq}`);
         if (consumer.max_batch_size !== 1) errors.push(`${where}: the variants consumer must take one message at a time (max_batch_size 1; memory)`);
         if (!consumer.max_retries || consumer.max_retries <= 5) errors.push(`${where}: the variants consumer's max_retries must exceed the job's own MAX_ATTEMPTS (5)`);
      }
      if ((c.queues?.producers ?? []).some((p) => p.binding !== "VARIANTS" && p.queue === want.variantsQueue)) errors.push(`${where}: ${want.variantsQueue} is for VARIANTS only`);
      // www's home timeline (docs/FEED.md): this env's FEED namespace (www binds the same one), the
      // build queue (one consumer at a time, retries, DLQ) and the DLQ's own consumer (flags staff).
      const f = want.feed;
      const kv = (c.kv_namespaces ?? []).filter((k) => k.binding === "FEED");
      if (kv.length !== 1 || kv[0].id !== f.kvId) errors.push(`${where}: kv_namespaces must bind FEED → ${f.kv} (${f.kvId})`);
      if (!(c.triggers?.crons ?? []).includes(FEED_DUE_CRON)) errors.push(`${where}: triggers.crons must include "${FEED_DUE_CRON}" (scheduled posts onto the timeline)`);
      const fp = (c.queues?.producers ?? []).filter((p) => p.binding === "FEED_JOBS");
      if (fp.length !== 1 || fp[0].queue !== f.queue) errors.push(`${where}: queues.producers must bind FEED_JOBS → ${f.queue}`);
      const fc = (c.queues?.consumers ?? []).filter((x) => x.queue === f.queue);
      if (fc.length !== 1) errors.push(`${where}: queues.consumers must consume ${f.queue} once`);
      else {
         if (fc[0].dead_letter_queue !== f.dlq) errors.push(`${where}: the feed consumer needs dead_letter_queue ${f.dlq}`);
         if (fc[0].max_concurrency !== 1) errors.push(`${where}: the feed consumer must run one build at a time (max_concurrency 1)`);
         if (!fc[0].max_retries || fc[0].max_retries < 1) errors.push(`${where}: the feed consumer needs max_retries ≥ 1`);
      }
      if ((c.queues?.consumers ?? []).filter((x) => x.queue === f.dlq).length !== 1) errors.push(`${where}: queues.consumers must consume the DLQ ${f.dlq} once (it flags staff)`);
   }
   return errors;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(new URL(import.meta.url)));
if (isMain) {
   const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
   const errors = checkWranglerConfig(parseJsonc<WranglerConfig>(readFileSync(resolve(root, "wrangler.jsonc"), "utf8")));
   if (errors.length) {
      process.stderr.write(`wrangler.jsonc check failed:\n${errors.map((e) => `  - ${e}`).join("\n")}\n`);
      process.exit(1);
   }
   process.stdout.write("wrangler.jsonc check passed (production, stage, qa).\n");
}
