import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkBindings } from "../../scripts/check-secrets.ts";
import { checkWranglerConfig } from "../../scripts/check-wrangler-config.ts";
import { consumerPlan, consumersFor } from "../../scripts/release/queue-consumers.ts";
import { parseJsonc } from "../../scripts/lib/jsonc.ts";
import { currentVersion, isNotDeployed, parseVersionId, promote, type PromoteDeps, waitForVersion } from "../../scripts/release/promote.ts";
import { lastReleasedSha } from "../../scripts/release/last-released.ts";
import { parseRollbackArgs, rollbackArgv, rollbackTarget, targetFromResult } from "../../scripts/release/rollback.ts";
import { overrideHeader, REQUEST_TIMEOUT_MS, runSmoke, VERSION_PAUSE_MS, VERSION_WAIT_MS, type CheckResult } from "../../scripts/release/smoke.ts";
import { SECRETS_MANIFEST } from "../../scripts/secrets-manifest.ts";

const V1 = "11111111-1111-1111-1111-111111111111";
const V2 = "22222222-2222-2222-2222-222222222222";

describe("promote: parsing", () => {
   it("parses the version id", () => expect(parseVersionId(`Uploaded\nWorker Version ID: ${V2}\n`)).toBe(V2));
   it("throws without one", () => expect(() => parseVersionId("nope")).toThrow());
   it("finds the single 100% version and refuses splits", () => {
      expect(currentVersion(JSON.stringify({ versions: [{ version_id: V1, percentage: 100 }] }), "w")).toBe(V1);
      expect(() => currentVersion(JSON.stringify({ versions: [{ version_id: V1, percentage: 90 }, { version_id: V2, percentage: 10 }] }), "w")).toThrow(/split/);
   });
   it("recognizes a never-deployed worker", () => {
      expect(isNotDeployed(Object.assign(new Error("x"), { stderr: "This Worker does not exist on your account. [code: 10007]" }))).toBe(true);
      expect(isNotDeployed(new Error("network down"))).toBe(false);
   });
});

function fakeDeps(opts: { preFails?: boolean; postFails?: boolean; notDeployed?: boolean } = {}) {
   const calls: string[][] = [];
   const deps: PromoteDeps = {
      run: (args) => {
         calls.push(args);
         if (args[0] === "deployments") {
            if (opts.notDeployed) throw Object.assign(new Error("failed"), { stderr: "Worker not found [code: 10007]" });
            return JSON.stringify({ versions: [{ version_id: V1, percentage: 100 }] });
         }
         if (args[0] === "versions" && args[1] === "upload") return `Worker Version ID: ${V2}`;
         if (args[0] === "deploy") return `Current Version ID: ${V2}`;
         return "ok";
      },
      smoke: async (version) => [{ name: "x", ok: !(version ? opts.preFails : opts.postFails), detail: "" }],
      waitForVersion: async () => {},
      log: () => {},
   };
   return { deps, calls };
}

describe("promote: flow", () => {
   it("uploads, 0% + override smoke, 100%, smoke", async () => {
      const { deps, calls } = fakeDeps();
      const r = await promote("stage", "dist/stage/index.js", "release abc", deps);
      expect(r).toEqual({ worker: "al-ummah-now-cms-stage", previous: V1, candidate: V2, firstDeploy: false });
      const verbs = calls.map((c) => c.slice(0, 3).join(" "));
      expect(verbs).toEqual([
         "deployments status --json",
         "versions upload --env",
         `versions deploy ${V2}@0%`,
         `versions deploy ${V2}@100%`,
         "triggers deploy --env",
      ]);
      expect(calls[1]).toContain("--no-bundle");
      expect(calls.every((c) => c.includes("--env") && c.includes("stage"))).toBe(true);
   });
   it("production targets the top-level config explicitly", async () => {
      const { deps, calls } = fakeDeps();
      await promote("production", "dist/production/index.js", "m", deps);
      expect(calls.every((c) => c.includes("--env=") && !c.includes("stage"))).toBe(true);
   });
   it("rolls back when the pre-traffic smoke fails", async () => {
      const { deps, calls } = fakeDeps({ preFails: true });
      await expect(promote("production", "b", "m", deps)).rejects.toMatchObject({ rolledBack: true });
      expect(calls.at(-1)?.slice(0, 2)).toEqual(["rollback", V1]);
      expect(calls.some((c) => c.includes(`${V2}@100%`))).toBe(false);
   });
   it("rolls back when the post-promote smoke fails", async () => {
      const { deps, calls } = fakeDeps({ postFails: true });
      await expect(promote("production", "b", "m", deps)).rejects.toMatchObject({ rolledBack: true });
      expect(calls.at(-1)?.slice(0, 2)).toEqual(["rollback", V1]);
   });
   it("first deployment is a plain deploy", async () => {
      const { deps, calls } = fakeDeps({ notDeployed: true });
      const r = await promote("stage", "b", "m", deps);
      expect(r).toMatchObject({ previous: null, candidate: V2, firstDeploy: true });
      expect(calls[1][0]).toBe("deploy");
   });
});

describe("rollback", () => {
   const deployments = JSON.stringify([
      { created_on: "2026-11-01T00:00:00Z", versions: [{ version_id: "a0000000-0000-0000-0000-000000000000", percentage: 100 }] },
      { created_on: "2026-11-02T00:00:00Z", versions: [{ version_id: V1, percentage: 100 }] },
      { created_on: "2026-11-03T00:00:00Z", versions: [{ version_id: V2, percentage: 0 }, { version_id: V1, percentage: 100 }] },
      { created_on: "2026-11-04T00:00:00Z", versions: [{ version_id: V2, percentage: 100 }] },
   ]);
   it("targets the previous main version", () => expect(rollbackTarget(deployments, "w")).toEqual({ current: V2, target: V1 }));
   it("honours --to", () => expect(rollbackTarget(deployments, "w", V1)).toEqual({ current: V2, target: V1 }));
   it("refuses mid-promote without --to", () => {
      const mid = JSON.stringify([{ created_on: "1", versions: [{ version_id: V2, percentage: 0 }, { version_id: V1, percentage: 100 }] }]);
      expect(() => rollbackTarget(mid, "w")).toThrow(/mid-promote/);
   });
   it("reads the target from release-result.json for the same env only", () => {
      expect(targetFromResult(JSON.stringify({ env: "production", previous: V1 }), "production")).toBe(V1);
      expect(() => targetFromResult(JSON.stringify({ env: "stage", previous: V1 }), "production")).toThrow(/stage/);
   });
   it("parses args and builds the wrangler argv by worker name", () => {
      expect(parseRollbackArgs(["--env", "production", "--dry-run"])).toMatchObject({ env: "production", dryRun: true });
      expect(() => parseRollbackArgs(["--env", "qa"])).toThrow();
      expect(() => parseRollbackArgs(["--env", "stage", "--to", "x; rm -rf"])).toThrow(/uuid/);
      expect(rollbackArgv("production", V1, "r")).toEqual(["rollback", V1, "--name", "al-ummah-now-cms", "-y", "--message", "r"]);
   });
});

/** A real server whose answers stall: no headers, or headers and half a body, then nothing. */
async function stalling(run: (url: string) => Promise<void>): Promise<void> {
   const server = createServer((req, res) => {
      if (req.url === "/body") res.writeHead(200, { "Content-Type": "application/json" }).write('{"status":');
   });
   await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
   try {
      await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
   } finally {
      server.closeAllConnections();
      server.close();
   }
}

describe("smoke", () => {
   afterEach(() => void vi.restoreAllMocks());
   it("builds the override header", () => expect(overrideHeader("al-ummah-now-cms", V2)).toBe(`al-ummah-now-cms="${V2}"`));
   /** A clock that moves only when somebody sleeps. */
   const clock = () => {
      let t = 0;
      return { now: () => t, sleep: async (ms: number) => void (t += ms) };
   };
   /** A healthy stage CMS, of no particular version. */
   const answer = (url: string): Response => {
         const u = new URL(url);
         if (u.pathname === "/healthz") return Response.json({ status: "ok", version: V2 });
         if (u.pathname === "/api/public/v1/site") {
            return u.searchParams.get("locale") === "en"
               ? Response.json({ settings: null, nav: { header: [], footer: [] } }, { headers: { "cache-control": "public, s-maxage=60" } })
               : Response.json({ error: "bad_request" }, { status: 400 });
         }
         if (u.pathname === "/") return new Response(null, { status: 302, headers: { location: "/sso/login?return=%2F" } });
         if (u.pathname === "/sso/login") {
            const a = new URL("https://auth.stage.alummahnow.net/authorize");
            a.searchParams.set("client_id", "d06fd65a-5b79-45bc-8bfd-a856b8502330");
            a.searchParams.set("redirect_uri", "https://cms.stage.alummahnow.net/sso/callback");
            a.searchParams.set("code_challenge", "c");
            a.searchParams.set("code_challenge_method", "S256");
            return new Response(null, { status: 302, headers: { location: a.toString() } });
         }
         if (u.pathname === "/api/auth/password/login") return new Response(null, { status: 404 });
         if (u.pathname === "/api/data/entity/posts") return new Response(null, { status: 403 });
         return new Response(null, { status: 500 });
   };
   /** The same, whose candidate answers every request that asks for it (X-Release-Check). */
   const proven = (url: string, init?: RequestInit): Response => {
      const res = answer(url);
      if (new Headers(init?.headers).has("X-Release-Check")) res.headers.set("X-Release-Check", "ok");
      return res;
   };
   it("passes against a healthy fake CMS and sends the override", async () => {
      const seen: Headers[] = [];
      const fake = (async (url: string, init: RequestInit) => {
         seen.push(new Headers(init.headers));
         return proven(url, init);
      }) as unknown as typeof fetch;
      const results = await runSmoke({ env: "stage", version: V2, fetchImpl: fake, ...clock() });
      expect(results.filter((r) => !r.ok)).toEqual([]);
      expect(seen.every((h) => h.get("Cloudflare-Workers-Version-Overrides") === `al-ummah-now-cms-stage="${V2}"`)).toBe(true);
      // /healthz says its version itself
      expect(seen.map((h) => h.get("X-Release-Check"))).toEqual([null, ...Array(6).fill(V2)]);
   });

   describe("who answered the other checks (X-Release-Check)", () => {
      type Page = (url: URL, init: RequestInit, n: number) => Response | null;
      const run = async (page: Page, version: string | undefined = V2, c = clock()) => {
         let n = 0;
         const seen: (string | null)[] = [];
         const fetchImpl = (async (url: string, init: RequestInit) => {
            seen.push(new Headers(init.headers).get("X-Release-Check"));
            return page(new URL(url), init, n++) ?? proven(url, init);
         }) as unknown as typeof fetch;
         return { results: await runSmoke({ env: "stage", version, fetchImpl, ...c }), seen, waited: c.now() };
      };
      const isSite = (url: URL) => url.pathname === "/api/public/v1/site" && url.searchParams.get("locale") === "en";
      const site = (results: CheckResult[]) => results.find((r) => r.name === "public API /site")!;

      it("sends nothing and asks once without a version", async () => {
         const r = await run((url) => answer(String(url)), "");
         expect(r.results.filter((x) => !x.ok)).toEqual([]);
         expect([r.waited, r.seen]).toEqual([0, Array(7).fill(null)]);
      });
      it("an old version that would pass every check passes none, within one deadline for all", async () => {
         const r = await run((url) => answer(String(url)));
         const rest = r.results.filter((x) => !x.name.startsWith("healthz"));
         expect(rest).toHaveLength(6);
         for (const x of rest) expect([x.ok, x.detail.startsWith(`not answered by candidate ${V2} of al-ummah-now-cms-stage (after 90 s; last answer, of another version: `)], x.detail).toEqual([false, true]);
         expect(r.waited).toBe(VERSION_WAIT_MS);
      });
      it("what an old version answers wrongly is asked again; what the candidate answers wrongly fails at once", async () => {
         let n = 0;
         const late = await run((url) => (isSite(url) && n++ < 2 ? new Response(null, { status: 500 }) : null));
         expect(late.results.filter((x) => !x.ok)).toEqual([]);
         expect([site(late.results).detail, late.waited]).toEqual(["200 JSON (after 10 s)", 2 * VERSION_PAUSE_MS]);
         const bad = await run((url) => (isSite(url) ? new Response(null, { status: 503, headers: { "X-Release-Check": "ok" } }) : null));
         expect([site(bad.results).detail, bad.waited]).toEqual(["status 503", 0]);
      });
      it("a failed connection fails at once, and only an exact ok is proof", async () => {
         const broken = await run((url) => { if (isSite(url)) throw new TypeError("fetch failed"); return null; });
         expect([site(broken.results).ok, site(broken.results).detail, broken.waited]).toEqual([false, "fetch failed", 0]);
         for (const value of ["OK", V2, "ok, ok"]) {
            const r = await run((url) => { if (!isSite(url)) return null; const res = answer(String(url)); res.headers.set("X-Release-Check", value); return res; });
            expect(site(r.results).detail, value).toContain("not answered by candidate");
         }
      });
      it("every environment binds the version", () => {
         const config = parseJsonc<{ version_metadata?: object; env: Record<string, { version_metadata?: object }> }>(readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8"));
         for (const block of [config, config.env.stage, config.env.qa]) expect(block.version_metadata).toEqual({ binding: "CF_VERSION_METADATA" });
      });
   });
   /** /healthz answers with these in turn (the last one from then on); the other checks are not under test. */
   const answering = (...answers: (() => Response)[]) => {
      let n = 0;
      const fetchImpl = (async (url: string) =>
         new URL(url).pathname === "/healthz" ? answers[Math.min(n++, answers.length - 1)]() : new Response(null, { status: 500, headers: { "X-Release-Check": "ok" } })) as unknown as typeof fetch;
      return { fetchImpl, asked: () => n };
   };
   const says = (version: string | null, over: object = {}, status = 200) => () => Response.json({ status: "ok", version, ...over }, { status });
   const healthz = (results: CheckResult[]) => results.find((r) => r.name.startsWith("healthz"))!;

   it("gives every request a timeout, and one that stalls in any other check is a failure", async () => {
      const signals: unknown[] = [];
      const results = await runSmoke({
         env: "production",
         version: V2,
         requestTimeoutMs: 30,
         ...clock(),
         fetchImpl: (async (url: string, init: RequestInit) => {
            signals.push(init.signal);
            if (new URL(url).pathname === "/healthz") return says(V2)();
            return new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason as Error)));
         }) as unknown as typeof fetch,
      });
      expect(signals.length).toBeGreaterThan(5);
      expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
      for (const r of results) expect([r.ok, /no answer in time/.test(r.detail)], r.name).toEqual(r.name.startsWith("healthz") ? [true, false] : [false, true]);
   });

   it.each(["/headers", "/body"])("a stalled answer (%s) is not yet while the candidate is waited for, and a failure otherwise", async (path) => {
      await stalling(async (url) => {
         const run = async (version?: string) => {
            const h = answering(says(V2));
            let n = 0;
            const results = await runSmoke({
               env: "stage",
               version,
               requestTimeoutMs: 50,
               sleep: async () => {},
               fetchImpl: (async (u: string, init: RequestInit) => (new URL(u).pathname === "/healthz" && n++ === 0 ? fetch(url + path, init) : h.fetchImpl(u, init))) as unknown as typeof fetch,
            });
            return { health: healthz(results), asked: n };
         };
         expect(await run(V2)).toMatchObject({ health: { ok: true }, asked: 2 });
         expect(await run()).toMatchObject({ health: { ok: false, detail: expect.stringMatching(/timeout/i) }, asked: 1 });
      });
   });

   it("never waits past the deadline when every answer stalls", async () => {
      const c = clock();
      let t = 0;
      const timeouts: number[] = [];
      vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => (timeouts.push(ms), new AbortController().signal));
      const results = await runSmoke({
         env: "production",
         version: V2,
         now: () => c.now() + t,
         sleep: c.sleep,
         fetchImpl: (async (url: string) => {
            if (new URL(url).pathname !== "/healthz") return new Response(null, { status: 500, headers: { "X-Release-Check": "ok" } });
            t += timeouts.at(-1)!;
            throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
         }) as unknown as typeof fetch,
      });
      expect(healthz(results)).toMatchObject({ ok: false, detail: `no answer in time, expected ${V2} (after 90 s)` });
      expect(c.now() + t).toBe(VERSION_WAIT_MS);
      expect(Math.max(...timeouts)).toBe(REQUEST_TIMEOUT_MS);
   });

   it("release.yml limits every job, the promoting ones well above what a promote with its rollback takes", () => {
      const workflow = readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
      const jobs = workflow.slice(workflow.indexOf("\njobs:")).split(/\n(?= {2}[a-z][a-z0-9-]*:\n)/).slice(1);
      const limits = Object.fromEntries(jobs.map((j) => [/^ {2}([a-z0-9-]+):/.exec(j)![1], Number(/\n {4}timeout-minutes: (\d+)/.exec(j)?.[1])]));
      expect(Object.keys(limits)).toEqual(expect.arrayContaining(["build", "stage", "production"]));
      for (const [job, minutes] of Object.entries(limits)) expect(minutes, job).toBeGreaterThan(0);
      expect(Math.min(limits.stage, limits.production)).toBeGreaterThanOrEqual(45);
   });

   describe.each(["stage", "production"] as const)("the version that answers on %s", (env) => {
      it("fails when the candidate never answers, after waiting as long as allowed and no longer", async () => {
         const c = clock();
         const h = answering(says(V1));
         expect(healthz(await runSmoke({ env, version: V2, fetchImpl: h.fetchImpl, ...c }))).toMatchObject({ ok: false, detail: `served by ${V1}, expected ${V2} (after 90 s)` });
         expect(c.now()).toBe(VERSION_WAIT_MS);
      });
      it("waits for the candidate while an edge location still answers with the version before", async () => {
         const c = clock();
         const h = answering(says(V1), says(null), says(V2));
         expect(healthz(await runSmoke({ env, version: V2, fetchImpl: h.fetchImpl, ...c }))).toMatchObject({ ok: true, detail: `ok (version ${V2}) (after ${(2 * VERSION_PAUSE_MS) / 1000} s)` });
         expect([h.asked(), c.now()]).toEqual([3, 2 * VERSION_PAUSE_MS]);
      });
      it("does not wait for an error, a status or an unhealthy answer, not even between tries", async () => {
         const bad: [string, () => Response, RegExp][] = [
            ["status", says(V2, {}, 500), /status 500/],
            ["unhealthy", says(V2, { status: "degraded", checks: { db: "fail" } }), /fail/],
            ["unhealthy, old version", says(V1, { status: "degraded", checks: { db: "fail" } }, 503), /status 503/],
            ["not JSON", () => new Response("<html>"), /./],
            ["network", () => { throw new TypeError("fetch failed"); }, /fetch failed/],
         ];
         for (const [name, answer, detail] of bad) {
            const first = clock();
            const a = answering(answer, says(V2));
            const atOnce = healthz(await runSmoke({ env, version: V2, fetchImpl: a.fetchImpl, ...first }));
            expect([atOnce.ok, a.asked(), first.now()], name).toEqual([false, 1, 0]);
            expect(atOnce.detail, name).toMatch(detail);
            const later = clock();
            const b = answering(says(V1), answer, says(V2));
            const afterOne = healthz(await runSmoke({ env, version: V2, fetchImpl: b.fetchImpl, ...later }));
            expect([afterOne.ok, b.asked(), later.now()], name).toEqual([false, 2, VERSION_PAUSE_MS]);
            expect(afterOne.detail, name).toMatch(detail);
         }
      });
      it("asks once without a version (after the promotion waitForVersion reads it)", async () => {
         const c = clock();
         const h = answering(says(V1));
         expect(healthz(await runSmoke({ env, fetchImpl: h.fetchImpl, ...c }))).toMatchObject({ ok: true, detail: `ok (version ${V1})` });
         expect([h.asked(), c.now()]).toEqual([1, 0]);
      });
      it("promotes only when the candidate itself answered the pre-traffic smoke", async () => {
         const release = async (version: string) => {
            const { deps, calls } = fakeDeps();
            deps.smoke = async (wanted) => [healthz(await runSmoke({ env, version: wanted, fetchImpl: answering(says(version)).fetchImpl, ...clock() }))];
            return { calls, done: await promote(env, "b", "m", deps).catch((e: Error) => e) };
         };
         const stale = await release(V1);
         expect(stale.done).toMatchObject({ rolledBack: true, message: expect.stringContaining(`expected ${V2}`) });
         expect(stale.calls.some((c) => c.includes(`${V2}@100%`))).toBe(false);
         const fresh = await release(V2);
         expect(fresh.done).toMatchObject({ candidate: V2 });
         expect(fresh.calls.some((c) => c.includes(`${V2}@100%`))).toBe(true);
      });
   });
});

describe("secrets manifest", () => {
   it("requires BKND_JWT_SECRET on every worker and forbids CMS_CLIENT_SECRET", () => {
      expect(SECRETS_MANIFEST.map((e) => e.worker).sort()).toEqual(["al-ummah-now-cms", "al-ummah-now-cms-qa", "al-ummah-now-cms-stage"]);
      for (const e of SECRETS_MANIFEST) {
         expect(e.required.map((r) => r.name)).toEqual(["BKND_JWT_SECRET"]);
         expect(e.forbidden).toContain("CMS_CLIENT_SECRET");
      }
   });
   it("checkBindings", () => {
      const entry = SECRETS_MANIFEST[0];
      expect(checkBindings(entry, null)[0]).toMatchObject({ ok: false, detail: "not deployed" });
      expect(checkBindings(entry, [{ type: "secret_text", name: "BKND_JWT_SECRET" }]).every((f) => f.ok)).toBe(true);
      expect(checkBindings(entry, [{ type: "plain_text", name: "BKND_JWT_SECRET" }]).some((f) => !f.ok)).toBe(true);
      expect(checkBindings(entry, []).some((f) => !f.ok)).toBe(true);
      expect(checkBindings(entry, [{ type: "secret_text", name: "BKND_JWT_SECRET" }, { type: "secret_text", name: "CMS_CLIENT_SECRET" }]).some((f) => !f.ok)).toBe(true);
   });
});

describe("wrangler config", () => {
   const config = parseJsonc<Record<string, unknown>>(readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8"));
   it("the committed wrangler.jsonc passes", () => expect(checkWranglerConfig(config as never)).toEqual([]));
   it("catches a workers.dev or a wrong D1", () => {
      const bad = structuredClone(config) as { workers_dev: boolean; env: { qa: { d1_databases: { database_id: string }[] } } };
      bad.workers_dev = true;
      bad.env.qa.d1_databases[0].database_id = "ad825428-5f0d-4d0b-878b-45b94e3c9c63";
      const errs = checkWranglerConfig(bad as never);
      expect(errs.join("\n")).toMatch(/workers_dev/);
      expect(errs.join("\n")).toMatch(/env.qa: d1_databases/);
   });
   it("catches a missing feed namespace, a concurrent feed consumer or an unconsumed DLQ", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a deep edit of parsed JSON
      const bad = structuredClone(config) as Record<string, any>;
      bad.env.stage.kv_namespaces = [];
      bad.queues.consumers.find((x: { queue: string }) => x.queue === "al-ummah-now-cms-feed").max_concurrency = 4;
      bad.env.qa.queues.consumers = bad.env.qa.queues.consumers.filter((x: { queue: string }) => x.queue !== "al-ummah-now-cms-feed-dlq-qa");
      bad.env.qa.triggers.crons = ["*/30 * * * *"];
      const errs = checkWranglerConfig(bad as never).join("\n");
      expect(errs).toMatch(/env.stage: kv_namespaces must bind FEED/);
      expect(errs).toMatch(/top level: the feed consumer must run one build at a time/);
      expect(errs).toMatch(/env.qa: queues.consumers must consume the DLQ al-ummah-now-cms-feed-dlq-qa/);
      expect(errs).toMatch(/env.qa: triggers.crons must include "\* \* \* \* \*"/);
   });
   it("catches a missing search limiter or one shared between envs", () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a deep edit of parsed JSON
      const bad = structuredClone(config) as Record<string, any>;
      delete bad.env.stage.ratelimits;
      bad.env.qa.ratelimits[0].namespace_id = bad.ratelimits[0].namespace_id;
      const errs = checkWranglerConfig(bad as never).join("\n");
      expect(errs).toMatch(/env.stage: ratelimits must bind SEARCH_LIMITER/);
      expect(errs).toMatch(/env.qa: SEARCH_LIMITER namespace_id 1101 is used by another env/);
   });
   it("parseJsonc handles comments, trailing commas and // inside strings", () => {
      expect(parseJsonc('{ // c\n "a": "http://x", /* b */ "b": [1,2,], }')).toEqual({ a: "http://x", b: [1, 2] });
   });
});

describe("queue consumers (scripts/release/queue-consumers.ts)", () => {
   const config = parseJsonc<Record<string, unknown>>(readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8"));
   it("registers the feed queue and its DLQ on stage when they are missing, and nothing already there", () => {
      const consumers = consumersFor(config as never, "stage");
      const plan = consumerPlan("al-ummah-now-cms-stage", consumers, (q) =>
         q.includes("-feed") ? "Consumers: " : "Consumers: worker:al-ummah-now-cms-stage",
      );
      expect(plan.map((a) => a[3])).toEqual(["al-ummah-now-cms-feed-stage", "al-ummah-now-cms-feed-dlq-stage"]);
      expect(plan[0]).toEqual(expect.arrayContaining(["--dead-letter-queue", "al-ummah-now-cms-feed-dlq-stage", "--max-concurrency", "1"]));
   });
});

describe("last released", () => {
   const sha = (c: string) => c.repeat(40);
   it("returns the newest deployment whose message is a release", () => {
      const json = JSON.stringify([
         { created_on: "2026-11-01T00:00:00Z", annotations: { "workers/message": `release ${sha("a")}` } },
         { created_on: "2026-11-03T00:00:00Z", annotations: { "workers/message": "auto-rollback: smoke failed" } },
         { created_on: "2026-11-02T00:00:00Z", annotations: { "workers/message": `release ${sha("b")}` } },
         { created_on: "2026-11-02T01:00:00Z", annotations: { "workers/message": `release ${sha("c")} (0%)` } },
      ]);
      expect(lastReleasedSha(json)).toBe(sha("c"));
   });
   it("ignores short SHAs and returns undefined when nothing was released", () => {
      expect(lastReleasedSha(JSON.stringify([{ created_on: "1", annotations: { "workers/message": "release abc1234" } }, { created_on: "2" }]))).toBeUndefined();
   });
});

describe("waitForVersion: the edge must serve the candidate steadily", () => {
   const V = "0ea73b06-7c5a-4061-af56-ddaabcfe1e60";
   const OLD = "e62c5482-c227-428f-995f-46f1038c893a";
   const serving = (versions: string[]) => {
      let i = 0;
      const seen: string[] = [];
      const doFetch = (async () => {
         const v = versions[Math.min(i++, versions.length - 1)];
         seen.push(v);
         return new Response(JSON.stringify({ version: v }));
      }) as unknown as typeof fetch;
      return { doFetch, seen };
   };

   it("does not return on a single match that the edge then contradicts", async () => {
      const f = serving([V, OLD, V, V, V]);
      await waitForVersion("stage", V, true, 5_000, 3, f.doFetch, 1);
      expect(f.seen).toEqual([V, OLD, V, V, V]);
   });

   it("gives up with the last version seen when the candidate never holds", async () => {
      const f = serving([V, OLD]);
      await expect(waitForVersion("stage", V, true, 50, 3, f.doFetch, 1)).rejects.toThrow(`last: version ${OLD}`);
   });
});
