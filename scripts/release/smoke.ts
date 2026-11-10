/**
 * Release smoke checks: fast, read-only, safe against production.
 *
 *   node --experimental-strip-types scripts/release/smoke.ts --env stage
 *   node --experimental-strip-types scripts/release/smoke.ts --env production --version <id>
 *
 * With --version, every request carries `Cloudflare-Workers-Version-Overrides`, so the checks
 * hit that (0 %-traffic) version with production bindings, and /healthz must report it.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENVS, parseEnv, type EnvName } from "./envs.ts";

export interface CheckResult {
   name: string;
   ok: boolean;
   detail: string;
}

export interface SmokeOptions {
   env: EnvName;
   /** Candidate version id (pre-traffic smoke). */
   version?: string;
   fetchImpl?: typeof fetch;
}

export function overrideHeader(worker: string, version: string): string {
   return `${worker}="${version}"`;
}

export async function runSmoke(opts: SmokeOptions): Promise<CheckResult[]> {
   const info = ENVS[opts.env];
   const doFetch = opts.fetchImpl ?? fetch;
   const headers: Record<string, string> = { "User-Agent": "al-ummah-now-cms-release-smoke" };
   if (opts.version) headers["Cloudflare-Workers-Version-Overrides"] = overrideHeader(info.worker, opts.version);
   const get = (path: string) => doFetch(`${info.url}${path}`, { headers, redirect: "manual" });
   const results: CheckResult[] = [];
   const check = async (name: string, fn: () => Promise<string>) => {
      try {
         results.push({ name, ok: true, detail: await fn() });
      } catch (error) {
         results.push({ name, ok: false, detail: (error as Error).message });
      }
   };

   await check("healthz deep (config + D1 + version)", async () => {
      const res = await get("/healthz?deep=1");
      const body = (await res.json()) as { status?: string; version?: string | null; checks?: Record<string, string> };
      if (res.status !== 200 || body.status !== "ok") throw new Error(`status ${res.status} ${JSON.stringify(body.checks ?? body)}`);
      if (opts.version && body.version !== opts.version) throw new Error(`served by ${body.version}, expected ${opts.version}`);
      return `ok (version ${body.version})`;
   });

   await check("public API /site", async () => {
      const res = await get("/api/public/v1/site?locale=en");
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { nav?: { header?: unknown[] } };
      if (!Array.isArray(body.nav?.header)) throw new Error("unexpected body");
      if (!(res.headers.get("cache-control") ?? "").includes("s-maxage=60")) throw new Error("missing cache headers");
      return "200 JSON";
   });

   await check("public API rejects a bad locale", async () => {
      const res = await get("/api/public/v1/site?locale=xx");
      if (res.status !== 400) throw new Error(`status ${res.status}`);
      return "400";
   });

   await check("admin UI redirects to SSO", async () => {
      const res = await get("/");
      const loc = res.headers.get("location") ?? "";
      if (res.status !== 302 || !loc.startsWith("/sso/login")) throw new Error(`status ${res.status} → ${loc}`);
      return `302 → ${loc}`;
   });

   await check("SSO login goes to auth with PKCE and the exact redirect_uri", async () => {
      const res = await get("/sso/login");
      const loc = new URL(res.headers.get("location") ?? "about:blank");
      const ok =
         res.status === 302 &&
         `${loc.origin}${loc.pathname}` === `${info.authIssuer}/authorize` &&
         loc.searchParams.get("client_id") === info.clientId &&
         loc.searchParams.get("redirect_uri") === `${info.url}/sso/callback` &&
         loc.searchParams.get("code_challenge_method") === "S256" &&
         !!loc.searchParams.get("code_challenge");
      if (!ok) throw new Error(`status ${res.status} → ${loc}`);
      return "302 → authorize";
   });

   await check("bknd password login is gone", async () => {
      const res = await doFetch(`${info.url}/api/auth/password/login`, { method: "POST", headers, redirect: "manual" });
      if (res.status !== 404) throw new Error(`status ${res.status}`);
      return "404";
   });

   await check("guest cannot read the data API", async () => {
      const res = await get("/api/data/entity/posts");
      if (res.status !== 403 && res.status !== 401) throw new Error(`status ${res.status}`);
      return String(res.status);
   });

   return results;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(new URL(import.meta.url)));
if (isMain) {
   const argv = process.argv.slice(2);
   const env = parseEnv(argv);
   const version = argv.includes("--version") ? argv[argv.indexOf("--version") + 1] : undefined;
   const results = await runSmoke({ env, version });
   for (const r of results) process.stdout.write(`${r.ok ? "PASS" : "FAIL"}  ${r.name}: ${r.detail}\n`);
   if (results.some((r) => !r.ok)) process.exit(1);
}
