/**
 * Live secrets check (pre-promote gate). For each CMS Worker in secrets-manifest.ts, against
 * what is DEPLOYED: the Worker exists, every required secret is bound as a secret, and no
 * forbidden one is bound. Prints names only, never values. Exits 1 on any failure.
 *
 *   node --experimental-strip-types scripts/check-secrets.ts [--env production|stage|qa]
 *
 * Needs CLOUDFLARE_API_TOKEN (Workers Scripts:Read) and CLOUDFLARE_ACCOUNT_ID.
 */
import { resolve } from "node:path";
import { SECRETS_MANIFEST, type WorkerSecrets } from "./secrets-manifest.ts";
import type { EnvName } from "./release/envs.ts";

export const DEFAULT_ACCOUNT_ID = "0e4b6e7f9faf280c3c9bf95995edc64f";

export interface Binding {
   type: string;
   name: string;
}

export interface Finding {
   env: EnvName;
   worker: string;
   ok: boolean;
   check: string;
   detail?: string;
}

export function checkBindings(entry: WorkerSecrets, bindings: Binding[] | null): Finding[] {
   const base = { env: entry.env, worker: entry.worker };
   if (!bindings) return [{ ...base, ok: false, check: "worker exists", detail: "not deployed" }];
   const out: Finding[] = [{ ...base, ok: true, check: "worker exists" }];
   for (const req of entry.required) {
      const b = bindings.find((x) => x.name === req.name);
      if (!b) out.push({ ...base, ok: false, check: `secret ${req.name}`, detail: `missing (${req.purpose})` });
      else if (b.type !== "secret_text" && b.type !== "secrets_store_secret") {
         out.push({ ...base, ok: false, check: `secret ${req.name}`, detail: `bound as ${b.type}, not a secret` });
      } else out.push({ ...base, ok: true, check: `secret ${req.name}`, detail: b.type });
   }
   for (const opt of entry.optional ?? []) {
      const b = bindings.find((x) => x.name === opt.name);
      if (!b) out.push({ ...base, ok: true, check: `optional ${opt.name}`, detail: "not set (feature off)" });
      else if (b.type !== "secret_text" && b.type !== "secrets_store_secret") {
         out.push({ ...base, ok: false, check: `optional ${opt.name}`, detail: `bound as ${b.type}, not a secret` });
      } else out.push({ ...base, ok: true, check: `optional ${opt.name}`, detail: b.type });
   }
   for (const name of entry.forbidden) {
      if (bindings.some((x) => x.name === name)) out.push({ ...base, ok: false, check: `forbidden ${name}`, detail: "must not be bound" });
   }
   return out;
}

async function liveBindings(worker: string): Promise<Binding[] | null> {
   const token = process.env.CLOUDFLARE_API_TOKEN;
   if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not set");
   const account = process.env.CLOUDFLARE_ACCOUNT_ID || DEFAULT_ACCOUNT_ID;
   const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}/settings`, {
      headers: { Authorization: `Bearer ${token}` },
   });
   if (res.status === 404) return null;
   const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: { bindings?: Binding[] }; errors?: { message: string }[] };
   if (!res.ok || json.success === false) {
      throw new Error(`GET ${worker}/settings → ${res.status} ${json.errors?.map((e) => e.message).join("; ") ?? ""}`);
   }
   return json.result?.bindings ?? [];
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
   const argv = process.argv.slice(2);
   const env = argv.includes("--env") ? (argv[argv.indexOf("--env") + 1] as EnvName) : undefined;
   try {
      const entries = SECRETS_MANIFEST.filter((e) => !env || e.env === env);
      if (entries.length === 0) throw new Error(`unknown --env ${env}`);
      const findings = (await Promise.all(entries.map(async (e) => checkBindings(e, await liveBindings(e.worker))))).flat();
      for (const f of findings) process.stdout.write(`${f.ok ? "ok  " : "FAIL"}  ${f.env.padEnd(10)} ${f.check}${f.detail ? ` — ${f.detail}` : ""}\n`);
      const failed = findings.filter((f) => !f.ok);
      process.stdout.write(`\n${failed.length === 0 ? "Secrets check passed" : `Secrets check failed: ${failed.length} problem(s)`}\n`);
      if (failed.length) process.exit(1);
   } catch (error) {
      process.stderr.write(`check-secrets: ${(error as Error).message}\n`);
      process.exit(2);
   }
}
