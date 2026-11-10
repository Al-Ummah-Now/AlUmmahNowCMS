/**
 * Registers the CMS Worker as the consumer of its queues (docs/AI_ASSIST_SPEC.md §3).
 *
 * `wrangler versions upload` / `versions deploy` (promote.ts) never create queue consumers — only a
 * plain `wrangler deploy` does (QA). This step runs after a promote on stage and production: for each
 * consumer in wrangler.jsonc's env, if the queue doesn't list this Worker yet, it is added with the
 * same settings. An existing consumer is left alone (changing settings is a remove + add by hand).
 *
 *   node --experimental-strip-types scripts/release/queue-consumers.ts --env stage|production
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "../lib/jsonc.ts";
import { ENVS, parseEnv, type EnvName } from "./envs.ts";

export interface ConsumerConfig {
   queue: string;
   max_batch_size?: number;
   max_batch_timeout?: number;
   max_retries?: number;
   max_concurrency?: number;
   dead_letter_queue?: string;
   retry_delay?: number;
}

interface EnvConfig {
   queues?: { consumers?: ConsumerConfig[] };
}

export function consumersFor(config: EnvConfig & { env?: Record<string, EnvConfig> }, env: EnvName): ConsumerConfig[] {
   const c = env === "production" ? config : (config.env?.[env] ?? {});
   return c.queues?.consumers ?? [];
}

/** Worker names in `wrangler queues info` output ("Consumers: worker:a, worker:b"). */
export function listedConsumers(info: string): string[] {
   const line = info.split("\n").find((l) => /^Consumers:/.test(l.trim()));
   if (!line) return [];
   return [...line.matchAll(/worker:([\w-]+)/g)].map((m) => m[1]);
}

export function addArgs(worker: string, c: ConsumerConfig): string[] {
   const args = ["queues", "consumer", "add", c.queue, worker];
   if (c.max_batch_size != null) args.push("--batch-size", String(c.max_batch_size));
   if (c.max_batch_timeout != null) args.push("--batch-timeout", String(c.max_batch_timeout));
   if (c.max_retries != null) args.push("--message-retries", String(c.max_retries));
   if (c.max_concurrency != null) args.push("--max-concurrency", String(c.max_concurrency));
   if (c.dead_letter_queue) args.push("--dead-letter-queue", c.dead_letter_queue);
   if (c.retry_delay != null) args.push("--retry-delay-secs", String(c.retry_delay));
   return args;
}

/** The wrangler commands still needed: one `consumer add` per queue that doesn't list `worker`. */
export function consumerPlan(worker: string, consumers: ConsumerConfig[], info: (queue: string) => string): string[][] {
   return consumers.filter((c) => !listedConsumers(info(c.queue)).includes(worker)).map((c) => addArgs(worker, c));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(new URL(import.meta.url)));
if (isMain) {
   const env = parseEnv(process.argv.slice(2), ["stage", "production"]);
   const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
   const config = parseJsonc<EnvConfig & { env?: Record<string, EnvConfig> }>(readFileSync(resolve(root, "wrangler.jsonc"), "utf8"));
   const run = (args: string[]) =>
      execFileSync("npx", ["wrangler", ...args], { cwd: root, encoding: "utf8", env: { ...process.env, CI: "true" }, stdio: ["ignore", "pipe", "pipe"] });
   const worker = ENVS[env].worker;
   const plan = consumerPlan(worker, consumersFor(config, env), (queue) => run(["queues", "info", queue]));
   if (!plan.length) process.stdout.write(`${worker}: queue consumers already registered\n`);
   for (const args of plan) {
      process.stdout.write(`wrangler ${args.join(" ")}\n`);
      run(args);
   }
}
