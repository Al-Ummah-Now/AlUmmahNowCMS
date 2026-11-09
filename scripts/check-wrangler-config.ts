/**
 * wrangler.jsonc must match the environment table (SPEC §2, scripts/release/envs.ts):
 * top level = production, env.stage and env.qa; custom domains only; workers_dev off; every env
 * lists its own D1 (with migrations_dir) and R2 binding and the right auth issuer/client id.
 *
 *   node --experimental-strip-types scripts/check-wrangler-config.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseJsonc } from "./lib/jsonc.ts";
import { ENVS, type EnvName } from "./release/envs.ts";

interface EnvConfig {
   name?: string;
   workers_dev?: boolean;
   routes?: { pattern: string; custom_domain?: boolean }[];
   vars?: Record<string, string>;
   d1_databases?: { binding: string; database_name: string; database_id: string; migrations_dir?: string }[];
   r2_buckets?: { binding: string; bucket_name: string }[];
}
interface WranglerConfig extends EnvConfig {
   env?: Record<string, EnvConfig>;
}

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
      const d1 = c.d1_databases ?? [];
      if (d1.length !== 1 || d1[0].binding !== "DB" || d1[0].database_name !== want.d1.name || d1[0].database_id !== want.d1.id) {
         errors.push(`${where}: d1_databases must be [DB → ${want.d1.name} (${want.d1.id})]`);
      } else if (d1[0].migrations_dir !== "migrations") errors.push(`${where}: D1 migrations_dir must be "migrations"`);
      const r2 = c.r2_buckets ?? [];
      if (r2.length !== 1 || r2[0].binding !== "MEDIA" || r2[0].bucket_name !== want.r2) {
         errors.push(`${where}: r2_buckets must be [MEDIA → ${want.r2}]`);
      }
   }
   return errors;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
   const root = resolve(new URL("..", import.meta.url).pathname);
   const errors = checkWranglerConfig(parseJsonc<WranglerConfig>(readFileSync(resolve(root, "wrangler.jsonc"), "utf8")));
   if (errors.length) {
      process.stderr.write(`wrangler.jsonc check failed:\n${errors.map((e) => `  - ${e}`).join("\n")}\n`);
      process.exit(1);
   }
   process.stdout.write("wrangler.jsonc check passed (production, stage, qa).\n");
}
