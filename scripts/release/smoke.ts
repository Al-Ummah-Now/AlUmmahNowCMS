/**
 * Release smoke checks: fast, read-only, safe against production.
 *
 *   node --experimental-strip-types scripts/release/smoke.ts --env stage
 *   node --experimental-strip-types scripts/release/smoke.ts --env production --version <id>
 *
 * With --version, every request carries `Cloudflare-Workers-Version-Overrides`, so the checks
 * hit that (0 %-traffic) version with production bindings. /healthz must report it; every other check
 * sends X-Release-Check and counts only when that version answered (src/lib/release-check.ts). Another
 * version's answer is asked for again, up to VERSION_WAIT_MS for the whole smoke. Without --version
 * every check asks once.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RELEASE_CHECK_HEADER, RELEASE_CHECK_OK } from "../../src/lib/release-check.ts";
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
   now?: () => number;
   sleep?: (ms: number) => Promise<void>;
   /** How long one request may take (tests). */
   requestTimeoutMs?: number;
}

/** How long the whole smoke may wait for answers of the candidate instead of another version, and the pause between tries. */
export const VERSION_WAIT_MS = 90_000;
export const VERSION_PAUSE_MS = 5_000;

/** One request may take this long (a stalled one must not outlive the waits around it). */
export const REQUEST_TIMEOUT_MS = 15_000;
export const isTimeout = (error: unknown): boolean => (error as Error)?.name === "TimeoutError";

export function overrideHeader(worker: string, version: string): string {
   return `${worker}="${version}"`;
}

export async function runSmoke(opts: SmokeOptions): Promise<CheckResult[]> {
   const info = ENVS[opts.env];
   const doFetch = opts.fetchImpl ?? fetch;
   const now = opts.now ?? Date.now;
   const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
   const headers: Record<string, string> = { "User-Agent": "al-ummah-now-cms-release-smoke" };
   if (opts.version) headers["Cloudflare-Workers-Version-Overrides"] = overrideHeader(info.worker, opts.version);
   const requestTimeout = opts.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
   const version = opts.version;
   const get = (path: string, timeoutMs = requestTimeout, method = "GET", extra: Record<string, string> = {}) =>
      doFetch(`${info.url}${path}`, { method, headers: { ...headers, ...extra }, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
   type Get = (path: string, method?: string) => Promise<Response>;
   const results: CheckResult[] = [];
   const deadline = now() + VERSION_WAIT_MS;
   const started = now();
   const timeLeft = () => Math.min(requestTimeout, Math.max(VERSION_PAUSE_MS, deadline - now()));
   const waited = () => Math.round((now() - started) / 1000);

   /**
    * One check. With a candidate, the verdict counts only when the candidate answered every request of the check
    * (X-Release-Check, src/lib/release-check.ts); otherwise (an older version, an edge error page, a stalled request)
    * the whole check runs again, one deadline for the whole smoke. A verdict of the candidate, pass or fail, and a
    * failed connection end it at once.
    */
   const check = async (name: string, fn: (get: Get) => Promise<string>) => {
      for (let tries = 1; ; tries++) {
         const proven: boolean[] = [];
         let broken = false;
         const ask: Get = async (path, method) => {
            try {
               const res = await get(path, version ? timeLeft() : requestTimeout, method, version ? { [RELEASE_CHECK_HEADER]: version } : {});
               proven.push(res.headers.get(RELEASE_CHECK_HEADER) === RELEASE_CHECK_OK);
               return res;
            } catch (error) {
               broken = broken || !isTimeout(error);
               throw error;
            }
         };
         let result: CheckResult;
         let stalled = false;
         try {
            result = { name, ok: true, detail: await fn(ask) };
         } catch (error) {
            stalled = isTimeout(error);
            result = { name, ok: false, detail: (error as Error).message };
         }
         const answeredByCandidate = proven.length > 0 && proven.every(Boolean) && !stalled;
         if (!version || broken || answeredByCandidate) {
            if (version && tries > 1 && result.ok) result.detail += ` (after ${waited()} s)`;
            results.push(result);
            return;
         }
         const timeUp = now() + VERSION_PAUSE_MS > deadline;
         if (timeUp) {
            const last = stalled ? "no answer in time" : `last answer, of another version: ${result.detail}`;
            results.push({ name, ok: false, detail: `not answered by candidate ${version} of ${info.worker} (after ${waited()} s; ${last})` });
            return;
         }
         await sleep(VERSION_PAUSE_MS);
      }
   };

   // Says which version answered in its body, the same rule otherwise
   const health = "healthz deep (config + D1 + version)";
   try {
      for (;;) {
         let served: string;
         try {
            const res = await get("/healthz?deep=1", version ? timeLeft() : requestTimeout);
            const body = (await res.json()) as { status?: string; version?: string | null; checks?: Record<string, string> };
            if (res.status !== 200 || body.status !== "ok") throw new Error(`status ${res.status} ${JSON.stringify(body.checks ?? body)}`);
            if (!version || body.version === version) {
               results.push({ name: health, ok: true, detail: `ok (version ${body.version})${waited() >= 1 && version ? ` (after ${waited()} s)` : ""}` });
               break;
            }
            served = `served by ${body.version}`;
         } catch (error) {
            // A request that stalls says nothing about the candidate yet
            if (!version || !isTimeout(error)) throw error;
            served = "no answer in time";
         }
         // Edge locations learn of a new deployment at different times: one can still answer with the version
         // before it, after waitForVersion saw the candidate. Only that (and a stalled request) is waited for: an
         // error, another status or an unhealthy answer fails above, at once, on every try.
         if (now() + VERSION_PAUSE_MS > deadline) throw new Error(`${served}, expected ${version} (after ${waited()} s)`);
         await sleep(VERSION_PAUSE_MS);
      }
   } catch (error) {
      results.push({ name: health, ok: false, detail: (error as Error).message });
   }

   await check("public API /site", async (get) => {
      const res = await get("/api/public/v1/site?locale=en");
      if (res.status !== 200) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { nav?: { header?: unknown[] } };
      if (!Array.isArray(body.nav?.header)) throw new Error("unexpected body");
      if (!(res.headers.get("cache-control") ?? "").includes("s-maxage=60")) throw new Error("missing cache headers");
      return "200 JSON";
   });

   await check("public API rejects a bad locale", async (get) => {
      const res = await get("/api/public/v1/site?locale=xx");
      if (res.status !== 400) throw new Error(`status ${res.status}`);
      return "400";
   });

   await check("admin UI redirects to SSO", async (get) => {
      const res = await get("/");
      const loc = res.headers.get("location") ?? "";
      if (res.status !== 302 || !loc.startsWith("/sso/login")) throw new Error(`status ${res.status} → ${loc}`);
      return `302 → ${loc}`;
   });

   await check("SSO login goes to auth with PKCE and the exact redirect_uri", async (get) => {
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

   await check("bknd password login is gone", async (get) => {
      const res = await get("/api/auth/password/login", "POST");
      if (res.status !== 404) throw new Error(`status ${res.status}`);
      return "404";
   });

   await check("guest cannot read the data API", async (get) => {
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
