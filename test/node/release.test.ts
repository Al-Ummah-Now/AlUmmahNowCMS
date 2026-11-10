import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkBindings } from "../../scripts/check-secrets.ts";
import { checkWranglerConfig } from "../../scripts/check-wrangler-config.ts";
import { parseJsonc } from "../../scripts/lib/jsonc.ts";
import { currentVersion, isNotDeployed, parseVersionId, promote, type PromoteDeps, waitForVersion } from "../../scripts/release/promote.ts";
import { lastReleasedSha } from "../../scripts/release/last-released.ts";
import { parseRollbackArgs, rollbackArgv, rollbackTarget, targetFromResult } from "../../scripts/release/rollback.ts";
import { overrideHeader, runSmoke } from "../../scripts/release/smoke.ts";
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

describe("smoke", () => {
   it("builds the override header", () => expect(overrideHeader("al-ummah-now-cms", V2)).toBe(`al-ummah-now-cms="${V2}"`));
   it("passes against a healthy fake CMS and sends the override", async () => {
      const seen: Headers[] = [];
      const fake = (async (url: string, init: RequestInit) => {
         seen.push(new Headers(init.headers));
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
      }) as unknown as typeof fetch;
      const results = await runSmoke({ env: "stage", version: V2, fetchImpl: fake });
      expect(results.filter((r) => !r.ok)).toEqual([]);
      expect(seen.every((h) => h.get("Cloudflare-Workers-Version-Overrides") === `al-ummah-now-cms-stage="${V2}"`)).toBe(true);
   });
   it("fails when /healthz is served by another version", async () => {
      const fake = (async () => Response.json({ status: "ok", version: V1 })) as unknown as typeof fetch;
      const results = await runSmoke({ env: "production", version: V2, fetchImpl: fake });
      expect(results[0]).toMatchObject({ ok: false });
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
   it("parseJsonc handles comments, trailing commas and // inside strings", () => {
      expect(parseJsonc('{ // c\n "a": "http://x", /* b */ "b": [1,2,], }')).toEqual({ a: "http://x", b: [1, 2] });
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
