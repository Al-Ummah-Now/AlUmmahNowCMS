/**
 * Pluggable providers in the Worker (docs/AI_PROVIDERS.md): the admin settings API (admin-only,
 * validated, versioned, audit-logged, never a key), "Test connection", the settings screen, the monthly
 * budget stop (new jobs and running jobs), and the queue consumer running features on generic HTTP
 * providers with a fallback to Workers AI.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getJob } from "../../src/lib/ai/jobs.ts";
import { MODEL_ID } from "../../src/lib/ai/prompts.ts";
import { handleAiQueue } from "../../src/lib/ai/runner.ts";
import { defaultSettings, saveSettings, type AiSettings } from "../../src/lib/ai/settings.ts";
import { fakeHttp, KEY_A, KEY_B, shapeA, shapeB } from "../support/fake-http-providers.ts";
import { mockWorkersAi } from "../support/workers-ai-mock.ts";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

const ORIGIN = "https://cms.test";
const idleAi = { run: async () => Promise.reject(new Error("not called")) };
const queue = () => {
   const sent: { jobId: string }[] = [];
   return { sent, binding: { send: async (m: { jobId: string }) => void sent.push(m), sendBatch: async () => undefined } as unknown as Queue<{ jobId: string }> };
};
const keys = { AI_KEY_A: KEY_A, AI_KEY_B: KEY_B };

async function session(roles: string[], id: string) {
   const { callback } = await signIn(roles, { id, email: `${id}@example.com` });
   return cookiesOf(callback);
}

const json = (cookie: string, method: string, body: unknown) => ({ method, headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });

function batch(queueName: string, jobId: string, attempts = 1) {
   const m: { acked: boolean; retried?: number } = { acked: false };
   const message = { id: crypto.randomUUID(), timestamp: new Date(), body: { jobId }, attempts, ack: () => void (m.acked = true), retry: (o?: { delaySeconds?: number }) => void (m.retried = o?.delaySeconds ?? 0) };
   return { m, batch: { queue: queueName, messages: [message], ackAll() {}, retryAll() {} } as unknown as MessageBatch<{ jobId: string }> };
}

const withHttp = (over: Partial<AiSettings> = {}): AiSettings => ({ ...defaultSettings(), providers: [...defaultSettings().providers, shapeA(), shapeB()], ...over });
const admin = { id: 1, email: "admin@example.com" };

beforeEach(async () => {
   for (const t of ["ai_jobs", "ai_usage", "ai_settings", "ai_settings_audit"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("settings API", () => {
   it("admins only; GET shows the defaults, bound AI_KEY_* names and the budget — never a value", async () => {
      const f = makeWorker(undefined, { AI: idleAi, ...keys } as never);
      const editor = await session(["Moderator"], "set-ed");
      for (const [path, init] of [
         ["/admin/api/ai/settings", { headers: { cookie: editor } }],
         ["/admin/api/ai/settings", json(editor, "PUT", { settings: defaultSettings(), version: 0 })],
         ["/admin/api/ai/settings/test", json(editor, "POST", { provider: shapeA(), model: "a-small" })],
      ] as const) {
         expect((await f(path, init)).status).toBe(403);
      }
      const cookie = await session(["Admin"], "set-admin");
      const res = await f("/admin/api/ai/settings", { headers: { cookie } });
      const text = await res.text();
      expect(text).not.toContain(KEY_A);
      const body = JSON.parse(text) as { settings: AiSettings; version: number; secrets: string[]; budget: { capUsd: number; spentUsd: number } };
      expect(body.settings).toEqual(defaultSettings());
      expect(body.version).toBe(0);
      expect(body.secrets).toEqual(["AI_KEY_A", "AI_KEY_B"]);
      expect(body.budget).toMatchObject({ capUsd: 50, spentUsd: 0, reached: false });
   });

   it("PUT validates, saves with a version, refuses a stale form, and audit-logs who changed what", async () => {
      const f = makeWorker(undefined, { AI: idleAi, ...keys } as never);
      const cookie = await session(["Admin"], "set-put");
      const bad = await f("/admin/api/ai/settings", json(cookie, "PUT", { settings: withHttp({ features: { ...defaultSettings().features, seo: { provider: "shape-a", model: "nope" } } }), version: 0 }));
      expect(bad.status).toBe(400);
      expect(await bad.json()).toEqual({ error: "invalid", errors: [{ path: "features.seo.model", code: "unknown_model" }] });
      const next = withHttp({ monthlyBudgetUsd: 25, features: { ...defaultSettings().features, seo: { provider: "shape-a", model: "a-large" } } });
      const ok = await f("/admin/api/ai/settings", json(cookie, "PUT", { settings: next, version: 0 }));
      expect(ok.status).toBe(200);
      const saved = (await ok.json()) as { version: number; changed: string[] };
      expect(saved.version).toBe(1);
      expect(saved.changed).toEqual(expect.arrayContaining(["monthlyBudgetUsd", "features.seo.provider", "providers.shape-a", "providers.shape-b"]));
      expect((await f("/admin/api/ai/settings", json(cookie, "PUT", { settings: defaultSettings(), version: 0 }))).status).toBe(409);
      const audit = await env.DB.prepare("SELECT * FROM ai_settings_audit").all<Record<string, unknown>>();
      expect(audit.results).toHaveLength(1);
      expect(audit.results[0]).toMatchObject({ action: "update", email: "set-put@example.com", version: 1 });
      // The stored settings name the secrets; the keys are nowhere in D1
      const row = await env.DB.prepare("SELECT data FROM ai_settings").first<{ data: string }>();
      expect(row!.data).toContain("AI_KEY_A");
      for (const t of ["ai_settings", "ai_settings_audit"]) {
         const all = JSON.stringify((await env.DB.prepare(`SELECT * FROM ${t}`).all()).results);
         expect(all).not.toContain(KEY_A);
         expect(all).not.toContain(KEY_B);
      }
   });

   it("Test connection runs a tiny prompt through the unsaved config: latency, cost, usage logged, audited", async () => {
      const http = fakeHttp();
      const f = makeWorker((url, init) => http.fetch(url, init), { AI: idleAi, ...keys } as never);
      const cookie = await session(["Admin"], "set-test");
      const res = await f("/admin/api/ai/settings/test", json(cookie, "POST", { provider: { ...shapeB(), enabled: false }, model: "b/one" }));
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({ ok: true, model: "b/one", usage: { inputTokens: 1200, outputTokens: 300 } });
      expect(Number(body.costUsd)).toBeCloseTo(1.2 * 0.01 + 0.3 * 0.03, 6);
      expect(http.seen[0].url.searchParams.get("key")).toBe(KEY_B);
      const usage = await env.DB.prepare("SELECT feature, provider, model, job_id, status FROM ai_usage").all();
      expect(usage.results).toEqual([{ feature: "test", provider: "shape-b", model: "b/one", job_id: null, status: "ok" }]);
      const audit = await env.DB.prepare("SELECT action, changed FROM ai_settings_audit").first<{ action: string; changed: string }>();
      expect(audit).toEqual({ action: "test", changed: JSON.stringify(["shape-b: ok"]) });
   });

   it("a failing test shows the code, the mapped error and the raw response with the key redacted", async () => {
      const http = fakeHttp(() => ({ kind: "http", status: 400, body: JSON.stringify({ error: { message: `unknown field; your key ${KEY_A}` } }) }));
      const f = makeWorker((url, init) => http.fetch(url, init), { AI: idleAi, ...keys } as never);
      const cookie = await session(["Admin"], "set-test-fail");
      const body = (await (await f("/admin/api/ai/settings/test", json(cookie, "POST", { provider: shapeA(), model: "a-small" }))).json()) as Record<string, string>;
      expect(body).toMatchObject({ ok: false, code: "bad_request" });
      expect(body.detail).toContain("HTTP 400: unknown field");
      expect(body.raw).toContain("[redacted]");
      expect(JSON.stringify(body)).not.toContain(KEY_A);
      const unbound = (await (await f("/admin/api/ai/settings/test", json(cookie, "POST", { provider: shapeA({ auth: { type: "header", header: "Authorization", prefix: "", secret: "AI_KEY_MISSING" } }), model: "a-small" }))).json()) as Record<string, string>;
      expect(unbound).toMatchObject({ ok: false, code: "not_configured" });
      const invalid = await f("/admin/api/ai/settings/test", json(cookie, "POST", { provider: shapeA({ url: "ftp://x" }), model: "" }));
      expect(invalid.status).toBe(400);
   });
});

describe("settings screen", () => {
   it("admins see it (en and Arabic RTL) with the bound secret names and no values; editors get 403 and no nav link", async () => {
      const f = makeWorker(undefined, { AI: idleAi, AI_JOBS: queue().binding, ...keys } as never);
      const cookie = await session(["Admin"], "scr-admin");
      const en = await (await f("/ai-settings", { headers: { cookie } })).text();
      expect(en).toContain("AI assist settings");
      expect(en).toContain('href="/ai-settings"');
      expect(en).toContain("AI_KEY_A");
      expect(en).not.toContain(KEY_A);
      expect(en).toContain('id="ai-remove"');
      expect(en).not.toMatch(/\b(alert|confirm|prompt)\(/);
      const ar = await (await f("/ai-settings?lang=ar", { headers: { cookie } })).text();
      expect(ar).toContain('dir="rtl"');
      expect(ar).toContain("إعدادات المساعد الذكي");
      const editor = await session(["Moderator"], "scr-ed");
      const denied = await f("/ai-settings", { headers: { cookie: editor } });
      expect(denied.status).toBe(403);
      expect(await (await f("/posts", { headers: { cookie: editor } })).text()).not.toContain('href="/ai-settings"');
   });
});

describe("monthly budget", () => {
   async function spend(usd: number) {
      await env.DB.prepare(
         "INSERT INTO ai_usage (id, at, day, env, user_id, feature, provider, model, job_id, input_tokens, output_tokens, cost_usd, status) VALUES (?1, ?2, ?3, 'qa', 1, 'seo', 'workers-ai', 'm', NULL, 1, 1, ?4, 'ok')",
      )
         .bind(crypto.randomUUID(), Date.now(), new Date().toISOString().slice(0, 10), usd)
         .run();
   }

   it("stops new jobs with 402 budget_reached once this month's estimate reaches the cap; last month doesn't count", async () => {
      await saveSettings(env.DB, { ...defaultSettings(), monthlyBudgetUsd: 2 }, 0, admin, Date.now());
      const f = makeWorker(undefined, { AI: idleAi, AI_JOBS: queue().binding });
      const cookie = await session(["Moderator"], "budget-ed");
      const body = { feature: "seo", kind: "posts", locale: "en", ui: "en", fields: { title: "T", summary: "", body: "b" } };
      await env.DB.prepare("INSERT INTO ai_usage (id, at, day, env, user_id, feature, provider, model, input_tokens, output_tokens, cost_usd, status) VALUES ('old', 0, '2000-01-15', 'qa', 1, 'seo', 'workers-ai', 'm', 1, 1, 99, 'ok')").run();
      expect((await f("/admin/api/ai/jobs", json(cookie, "POST", body))).status).toBe(202);
      await spend(2);
      const stopped = await f("/admin/api/ai/jobs", json(cookie, "POST", { ...body, fields: { ...body.fields, body: "c" } }));
      expect(stopped.status).toBe(402);
      expect(await stopped.json()).toEqual({ error: "budget_reached" });
   });

   it("a queued job stops before its next model call, fails with budget_reached and is flagged", async () => {
      const f = makeWorker(undefined, { AI: idleAi, AI_JOBS: queue().binding });
      const cookie = await session(["Moderator"], "budget-run");
      const res = await f("/admin/api/ai/jobs", json(cookie, "POST", { feature: "seo", kind: "posts", locale: "en", ui: "en", fields: { title: "T", summary: "", body: "b" } }));
      const { id } = ((await res.json()) as { job: { id: string } }).job;
      await saveSettings(env.DB, { ...defaultSettings(), monthlyBudgetUsd: 1 }, 0, admin, Date.now());
      await spend(1.5);
      const mock = mockWorkersAi();
      const { m, batch: b } = batch("al-ummah-now-cms-ai", id);
      await handleAiQueue(b, { ...env, AI: idleAi } as never, { binding: mock.binding });
      expect(m.acked).toBe(true);
      expect(mock.requests).toHaveLength(0);
      expect(await getJob(env.DB, id)).toMatchObject({ status: "failed", error: "budget_reached", flagged: 1 });
   });
});

describe("queue consumer on configured providers", () => {
   async function queued(feature: string, who: string) {
      const f = makeWorker(undefined, { AI: idleAi, AI_JOBS: queue().binding });
      const cookie = await session(["Moderator"], who);
      const res = await f("/admin/api/ai/jobs", json(cookie, "POST", { feature, kind: "posts", id: 4, locale: "en", ui: "en", fields: { title: "Hajj guide", summary: "", body: "How Hajj works." } }));
      expect(res.status).toBe(202);
      return ((await res.json()) as { job: { id: string } }).job.id;
   }

   it("SEO on HTTP shape B: the same validated result as on Workers AI, usage logged with provider and cost", async () => {
      await saveSettings(env.DB, withHttp({ features: { ...defaultSettings().features, seo: { provider: "shape-b", model: "b/one" } } }), 0, admin, Date.now());
      const id = await queued("seo", "prov-b");
      const http = fakeHttp();
      await handleAiQueue(batch("al-ummah-now-cms-ai", id).batch, { ...env, ...keys } as never, { binding: mockWorkersAi().binding, fetch: http.fetch });
      const job = await getJob(env.DB, id);
      expect(job).toMatchObject({ status: "done", result: { seo_title: "Hajj guide — guide" } });
      expect(http.seen).toHaveLength(1);
      const u = await env.DB.prepare("SELECT provider, model, cost_usd, neurons, status FROM ai_usage WHERE job_id = ?1").bind(id).first<Record<string, unknown>>();
      expect(u).toMatchObject({ provider: "shape-b", model: "b/one", neurons: 0, status: "ok" });
      expect(Number(u!.cost_usd)).toBeCloseTo(0.021, 6);
   });

   it("translate on shape A falls back to Workers AI when A is down; both attempts are in ai_usage", async () => {
      await saveSettings(
         env.DB,
         withHttp({ features: { ...defaultSettings().features, translate: { provider: "shape-a", model: "a-small" } }, fallback: { provider: "workers-ai", model: MODEL_ID } }),
         0,
         admin,
         Date.now(),
      );
      const id = await queued("translate", "prov-fb");
      const http = fakeHttp(() => ({ kind: "error", code: 0, status: 503, message: "maintenance" }));
      const mock = mockWorkersAi();
      await handleAiQueue(batch("al-ummah-now-cms-ai", id).batch, { ...env, ...keys } as never, { binding: mock.binding, fetch: http.fetch });
      expect(await getJob(env.DB, id)).toMatchObject({ status: "done", result: { title: "ترجمة: Hajj guide", locale: "ar" } });
      expect(mock.requests).toHaveLength(1);
      const rows = await env.DB.prepare("SELECT provider, status FROM ai_usage WHERE job_id = ?1 ORDER BY at, provider DESC").bind(id).all();
      expect(rows.results).toEqual(expect.arrayContaining([{ provider: "shape-a", status: "unavailable" }, { provider: "workers-ai", status: "ok" }]));
      // The admin usage rollup names both vendors
      const f = makeWorker(undefined, { AI: idleAi });
      const cookie = await session(["Admin"], "prov-usage");
      const roll = (await (await f("/admin/api/ai/usage", { headers: { cookie } })).json()) as { vendor_costs_daily: { vendor: string }[] };
      expect(roll.vendor_costs_daily.map((d) => d.vendor).sort()).toEqual(["cloudflare-workers-ai", "http:shape-a"]);
   });

   it("an HTTP provider without its key and no fallback: the job fails (not configured), nothing retried", async () => {
      await saveSettings(env.DB, withHttp({ features: { ...defaultSettings().features, check: { provider: "shape-a", model: "a-small" } } }), 0, admin, Date.now());
      const id = await queued("check", "prov-nokey");
      const http = fakeHttp();
      const { m, batch: b } = batch("al-ummah-now-cms-ai", id);
      await handleAiQueue(b, { ...env } as never, { binding: mockWorkersAi().binding, fetch: http.fetch });
      expect(m.acked).toBe(true);
      expect(http.seen).toHaveLength(0);
      expect(await getJob(env.DB, id)).toMatchObject({ status: "failed", error: "not_configured", flagged: 1 });
   });

   it("an env with no Workers AI binding is ready when a feature runs on an enabled HTTP provider", async () => {
      const f = makeWorker(undefined, { AI: undefined, AI_JOBS: queue().binding });
      const cookie = await session(["Moderator"], "prov-ready");
      expect(await (await f("/admin/api/ai/status", { headers: { cookie } })).json()).toEqual({ configured: false });
      await saveSettings(env.DB, withHttp({ features: { ...defaultSettings().features, seo: { provider: "shape-a", model: "a-small" } } }), 0, admin, Date.now());
      expect(await (await f("/admin/api/ai/status", { headers: { cookie } })).json()).toEqual({ configured: true });
   });
});
