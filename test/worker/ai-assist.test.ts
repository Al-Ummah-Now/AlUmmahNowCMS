/**
 * AI writing assist (docs/AI_ASSIST_SPEC.md §9): endpoints, roles, not-configured states, rate limit,
 * dedupe, the queue consumer with a mocked Workers AI binding (success, resume, retry, permanent, DLQ),
 * usage logging and the admin failure flag.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getJob } from "../../src/lib/ai/jobs.ts";
import { handleAiQueue } from "../../src/lib/ai/runner.ts";
import { MODEL_ID } from "../../src/lib/ai/prompts.ts";
import { mockNeurons, mockWorkersAi } from "../support/workers-ai-mock.ts";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

const ORIGIN = "https://cms.test";

async function session(roles: string[], id: string) {
   const { callback } = await signIn(roles, { id, email: `${id}@example.com` });
   return cookiesOf(callback);
}

function fakeQueue() {
   const sent: { jobId: string }[] = [];
   return { sent, binding: { send: async (m: { jobId: string }) => void sent.push(m), sendBatch: async () => undefined } as unknown as Queue<{ jobId: string }> };
}

/** A binding that must not be called (the HTTP side only enqueues). */
const idleAi = { run: async () => Promise.reject(new Error("not called in HTTP tests")) };
const configured = (q = fakeQueue()) => ({ q, worker: makeWorker(undefined, { AI: idleAi, AI_JOBS: q.binding }) });

function post(f: ReturnType<typeof makeWorker>, cookie: string, body: unknown, headers: Record<string, string> = {}) {
   return f("/admin/api/ai/jobs", { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

const job = (feature: string, fields: Record<string, string>, extra: Record<string, unknown> = {}) => ({ feature, kind: "posts", locale: "en", ui: "en", fields, ...extra });

interface Msg {
   acked: boolean;
   retried?: number;
}
function batch(queue: string, jobId: string, attempts = 1) {
   const m: Msg = { acked: false };
   const message = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      body: { jobId },
      attempts,
      ack: () => void (m.acked = true),
      retry: (o?: { delaySeconds?: number }) => void (m.retried = o?.delaySeconds ?? 0),
   };
   return { m, batch: { queue, messages: [message], ackAll() {}, retryAll() {} } as unknown as MessageBatch<{ jobId: string }> };
}

const aiEnv = (over: Record<string, unknown> = {}) => ({ ...env, AI: idleAi, ...over }) as never;

beforeEach(async () => {
   await env.DB.prepare("DELETE FROM ai_jobs").run();
   await env.DB.prepare("DELETE FROM ai_usage").run();
});

describe("access and configuration", () => {
   it("every endpoint needs a staff session and a same-origin Origin", async () => {
      const { worker } = configured();
      expect((await worker("/admin/api/ai/status")).status).toBe(401);
      const cookie = await session(["Moderator"], "ai-mod-1");
      expect(await (await worker("/admin/api/ai/status", { headers: { cookie } })).json()).toEqual({ configured: true });
      const cross = await post(worker, cookie, job("seo", { title: "T", summary: "", body: "b" }), { origin: "https://evil.test" });
      expect(cross.status).toBe(403);
   });

   it("not configured: 503 for jobs, the admin sees the notice, the editor sees nothing", async () => {
      const q = fakeQueue();
      const f = makeWorker(undefined, { AI: undefined, AI_JOBS: q.binding }); // no Workers AI binding
      const admin = await session(["Admin"], "ai-off-admin");
      const editor = await session(["Moderator"], "ai-off-ed");
      expect(await (await f("/admin/api/ai/status", { headers: { cookie: editor } })).json()).toEqual({ configured: false });
      const res = await post(f, editor, job("seo", { title: "T", summary: "", body: "b" }));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "ai_not_configured" });
      const a = await (await f("/posts/new", { headers: { cookie: admin } })).text();
      expect(a).toContain("AI assist isn&#39;t set up for this site");
      expect(a).not.toContain("data-ai-translate");
      expect(a).not.toContain("data-ai-seo");
      expect(a).not.toContain("data-ai-check");
      const e = await (await f("/posts/new", { headers: { cookie: editor } })).text();
      expect(e).not.toContain("set up for this site");
      expect(e).not.toContain("data-ai-");
      expect(e).not.toContain('id="ai-translate"');
   });

   it("needs both the Workers AI binding and the jobs queue; no secret is involved", async () => {
      const q = fakeQueue();
      const cookie = await session(["Admin"], "ai-binding");
      const noQueue = makeWorker(undefined, { AI: idleAi, AI_JOBS: undefined });
      expect(await (await noQueue("/admin/api/ai/status", { headers: { cookie } })).json()).toEqual({ configured: false });
      const notABinding = makeWorker(undefined, { AI: {} as never, AI_JOBS: q.binding });
      expect(await (await notABinding("/admin/api/ai/status", { headers: { cookie } })).json()).toEqual({ configured: false });
      const both = makeWorker(undefined, { AI: idleAi, AI_JOBS: q.binding });
      expect(await (await both("/admin/api/ai/status", { headers: { cookie } })).json()).toEqual({ configured: true });
   });

   it("configured: the editor shows the AI card, SEO suggest, the check and both dialogs (en and ar UI)", async () => {
      const { worker } = configured();
      const cookie = await session(["Moderator"], "ai-ui-ed");
      const en = await (await worker("/pages/new?locale=ar", { headers: { cookie } })).text();
      expect(en).toContain('data-ai="1"');
      expect(en).toContain("Translate to English");
      expect(en).toContain('aria-label="Suggest search and sharing text"');
      expect(en).toContain("Check before publishing");
      expect(en).toContain('id="ai-translate"');
      expect(en).toContain('id="ai-check"');
      expect(en).toContain('id="ai-tr-body" class="textarea code" rows="14" lang="en" dir="ltr"');
      const ar = await (await worker("/pages/new?locale=en&lang=ar", { headers: { cookie } })).text();
      expect(ar).toContain('dir="rtl"');
      expect(ar).toContain("ترجمة إلى العربية");
      expect(ar).toContain("فحص قبل النشر");
      expect(ar).toContain('id="ai-tr-body" class="textarea code" rows="14" lang="ar" dir="rtl"');
   });
});

describe("POST /admin/api/ai/jobs", () => {
   it("validates the body", async () => {
      const { worker } = configured();
      const cookie = await session(["Moderator"], "ai-val");
      const noJson = await worker("/admin/api/ai/jobs", { method: "POST", headers: { cookie, origin: ORIGIN }, body: "x" });
      expect(noJson.status).toBe(415);
      expect((await post(worker, cookie, job("poem", { title: "T", summary: "", body: "" }))).status).toBe(400);
      expect((await post(worker, cookie, { ...job("seo", { title: "T", summary: "", body: "" }), kind: "users" })).status).toBe(400);
      const empty = await post(worker, cookie, job("seo", { title: " ", summary: "", body: "  " }));
      expect(empty.status).toBe(400);
      expect(await empty.json()).toEqual({ error: "empty" });
      const long = await post(worker, cookie, job("check", { title: "T", summary: "", body: "x".repeat(60_001) }));
      expect(long.status).toBe(413);
      expect(await long.json()).toEqual({ error: "too_long" });
   });

   it("queues one job and dedupes the same request", async () => {
      const { q, worker } = configured();
      const cookie = await session(["Moderator"], "ai-dedupe");
      const body = job("seo", { title: "Ramadan timetable", summary: "", body: "The timetable." }, { id: 7 });
      const first = await post(worker, cookie, body);
      expect(first.status).toBe(202);
      const a = ((await first.json()) as { job: { id: string; status: string } }).job;
      expect(a.status).toBe("queued");
      const second = await post(worker, cookie, body);
      expect(second.status).toBe(200);
      const b = (await second.json()) as { job: { id: string }; deduped: boolean };
      expect(b.deduped).toBe(true);
      expect(b.job.id).toBe(a.id);
      expect(q.sent).toEqual([{ jobId: a.id }]);
   });

   it("rate-limits per user (translations weigh 3) with Retry-After", async () => {
      const { worker } = configured();
      const cookie = await session(["Moderator"], "ai-rate");
      const other = await session(["Moderator"], "ai-rate-other");
      for (let i = 0; i < 3; i++) expect((await post(worker, cookie, job("translate", { title: `T${i}`, summary: "", body: "b" }))).status).toBe(202);
      const over = await post(worker, cookie, job("translate", { title: "T3", summary: "", body: "b" }));
      expect(over.status).toBe(429);
      expect(Number(over.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect(((await over.json()) as { error: string }).error).toBe("rate_limited");
      // One more SEO job (weight 1) still fits: 9 + 1 = 10.
      expect((await post(worker, cookie, job("seo", { title: "S", summary: "", body: "b" }))).status).toBe(202);
      // Another user is not affected.
      expect((await post(worker, other, job("translate", { title: "T0", summary: "", body: "b" }))).status).toBe(202);
   });

   it("a job is readable by its owner and admins only, never echoing the input", async () => {
      const { worker } = configured();
      const owner = await session(["Moderator"], "ai-own");
      const peer = await session(["Moderator"], "ai-peer");
      const admin = await session(["Super Admin"], "ai-own-admin");
      const res = await post(worker, owner, job("seo", { title: "Private draft", summary: "", body: "secret text" }));
      const { id } = ((await res.json()) as { job: { id: string } }).job;
      expect((await worker(`/admin/api/ai/jobs/${id}`, { headers: { cookie: peer } })).status).toBe(404);
      const own = await (await worker(`/admin/api/ai/jobs/${id}`, { headers: { cookie: owner } })).text();
      expect(own).not.toContain("secret text");
      expect((await worker(`/admin/api/ai/jobs/${id}`, { headers: { cookie: admin } })).status).toBe(200);
   });
});

async function queued(feature: string, fields: Record<string, string>, roles = ["Moderator"], who = "ai-run") {
   const { worker } = configured();
   const cookie = await session(roles, who);
   const res = await post(worker, cookie, job(feature, fields, { id: 3 }));
   const { id } = ((await res.json()) as { job: { id: string } }).job;
   return { id, cookie, worker };
}

describe("queue consumer (mocked Workers AI)", () => {
   it("SEO: DeepSeek V4.1 Flash on Workers AI, no reasoning, JSON schema, result stored, usage logged in Neurons", async () => {
      const { id, cookie, worker } = await queued("seo", { title: "Zakat guide", summary: "", body: "How zakat works." });
      const mock = mockWorkersAi();
      const { m, batch: b } = batch("al-ummah-now-cms-ai", id);
      await handleAiQueue(b, aiEnv(), mock.binding);
      expect(m.acked).toBe(true);
      expect(mock.requests).toHaveLength(1);
      const r = mock.requests[0];
      expect(r.model).toBe(MODEL_ID);
      expect(r.inputs).toMatchObject({ reasoning_effort: "none", response_format: { type: "json_schema" } });
      expect(r.user).toContain("<document>");
      const got = (await (await worker(`/admin/api/ai/jobs/${id}`, { headers: { cookie } })).json()) as { job: { status: string; result: Record<string, string> } };
      expect(got.job.status).toBe("done");
      expect(got.job.result.seo_title).toBe("Zakat guide — guide");
      const usage = await env.DB.prepare("SELECT * FROM ai_usage WHERE job_id = ?1").bind(id).all<Record<string, unknown>>();
      expect(usage.results).toHaveLength(1);
      expect(usage.results[0]).toMatchObject({ feature: "seo", model: MODEL_ID, input_tokens: 1200, output_tokens: 300, env: "qa", status: "ok" });
      expect(usage.results[0].neurons).toBeCloseTo(mockNeurons(1200, 300), 3);
      expect(usage.results[0].cost_usd).toBeCloseTo((mockNeurons(1200, 300) * 0.011) / 1000, 7);
   });

   it("usage without a Neurons figure is estimated from the token counts", async () => {
      const { id } = await queued("seo", { title: "No neurons", summary: "", body: "b" }, ["Moderator"], "ai-est");
      const mock = mockWorkersAi(() => ({ kind: "json", data: { seo_title: "t", seo_description: "d", social_summary: "s" }, input: 1000, output: 100, neurons: null }));
      await handleAiQueue(batch("al-ummah-now-cms-ai", id).batch, aiEnv(), mock.binding);
      const u = await env.DB.prepare("SELECT neurons FROM ai_usage WHERE job_id = ?1").bind(id).first<{ neurons: number }>();
      expect(u?.neurons).toBeCloseTo(mockNeurons(1000, 100), 2);
   });

   it("check: policy categories from epic 28, notes in the editor's UI language", async () => {
      const { worker } = configured();
      const cookie = await session(["Moderator"], "ai-check-ar");
      const res = await post(worker, cookie, { ...job("check", { title: "عنوان", summary: "", body: "نص" }), locale: "ar", ui: "ar" });
      const { id } = ((await res.json()) as { job: { id: string } }).job;
      const mock = mockWorkersAi();
      await handleAiQueue(batch("al-ummah-now-cms-ai", id).batch, aiEnv(), mock.binding);
      expect(mock.requests[0].system).toContain("Write your notes in Modern Standard Arabic");
      expect(mock.requests[0].system).toContain("sectarian_hate");
      expect(mock.requests[0].system).toContain("religious_authenticity");
      expect(mock.requests[0].inputs).toMatchObject({ reasoning_effort: "low", chat_template_kwargs: { enable_thinking: true } });
      const j = await getJob(env.DB, id);
      expect(j?.status).toBe("done");
      expect((j?.result as { policy: { category: string }[] }).policy[0].category).toBe("religious_authenticity");
   });

   it("translate: no reasoning, Markdown and ::video lines kept, en → ar", async () => {
      const body = "## Intro\n\nSee [the guide](https://example.org/guide).\n\n::video[abc123]\n\nThe end.";
      const { id } = await queued("translate", { title: "Hello", summary: "Short", body }, ["Moderator"], "ai-tr");
      const mock = mockWorkersAi();
      await handleAiQueue(batch("al-ummah-now-cms-ai", id).batch, aiEnv(), mock.binding);
      expect(mock.requests).toHaveLength(1);
      expect(mock.requests[0].model).toBe(MODEL_ID);
      expect(mock.requests[0].inputs).toMatchObject({ reasoning_effort: "none", max_tokens: 16_000 });
      const j = await getJob(env.DB, id);
      const r = j?.result as { title: string; body: string; locale: string; warnings: string[] };
      expect(j?.status).toBe("done");
      expect(r.locale).toBe("ar");
      expect(r.title).toBe("ترجمة: Hello");
      expect(r.body).toContain("::video[abc123]");
      expect(r.warnings).toEqual([]);
   });

   it("a long translation resumes after a failure without re-calling finished chunks", async () => {
      const para = (n: number) => `Paragraph ${n} ${"word ".repeat(1000)}`;
      const body = Array.from({ length: 6 }, (_, i) => para(i)).join("\n\n"); // 6 × ~5k chars → 6 chunks
      const { id } = await queued("translate", { title: "Long", summary: "", body }, ["Moderator"], "ai-long");
      // Out of capacity from the second chunk on during the first delivery.
      let overloaded = true;
      const mock = mockWorkersAi((_req, n) => (overloaded && n >= 2 ? { kind: "error", code: 3040, message: "Capacity temporarily exceeded" } : undefined));
      const first = batch("al-ummah-now-cms-ai", id, 1);
      await handleAiQueue(first.batch, aiEnv(), mock.binding);
      expect(first.m.retried).toBe(15); // backoff after attempt 1
      expect(first.m.acked).toBe(false);
      const mid = await getJob(env.DB, id);
      expect(mid?.status).toBe("queued");
      expect(mid?.partial?.chunks.filter(Boolean)).toHaveLength(1);
      const callsBefore = mock.requests.length; // chunk 1, then chunk 2 (failed)
      expect(callsBefore).toBe(2);
      overloaded = false;
      const second = batch("al-ummah-now-cms-ai", id, 2);
      await handleAiQueue(second.batch, aiEnv(), mock.binding);
      expect(second.m.acked).toBe(true);
      const done = await getJob(env.DB, id);
      expect(done?.status).toBe("done");
      // Only the five remaining chunks were requested on the second delivery.
      expect(mock.requests.length - callsBefore).toBe(5);
      expect(mock.requests.slice(callsBefore).every((r) => !r.user.includes("<title>"))).toBe(true);
      expect((done?.result as { body: string }).body.split("\n\n")).toHaveLength(6);
   });

   it("a duplicate delivery of a done job is a no-op", async () => {
      const { id } = await queued("seo", { title: "Once", summary: "", body: "b" }, ["Moderator"], "ai-dup");
      const mock = mockWorkersAi();
      await handleAiQueue(batch("al-ummah-now-cms-ai", id).batch, aiEnv(), mock.binding);
      const again = batch("al-ummah-now-cms-ai", id, 2);
      await handleAiQueue(again.batch, aiEnv(), mock.binding);
      expect(again.m.acked).toBe(true);
      expect(mock.requests).toHaveLength(1);
   });

   it("a refusal is permanent: failed, flagged for admins, shown on the admin Overview only, dismissable", async () => {
      const { id, worker } = await queued("check", { title: "Refused", summary: "", body: "b" }, ["Moderator"], "ai-refuse");
      const mock = mockWorkersAi(() => ({ kind: "json", data: {}, refusal: "I can't help with that." }));
      const { m, batch: b } = batch("al-ummah-now-cms-ai", id);
      await handleAiQueue(b, aiEnv(), mock.binding);
      expect(m.acked).toBe(true);
      expect(m.retried).toBeUndefined();
      const j = await getJob(env.DB, id);
      expect(j).toMatchObject({ status: "failed", error: "declined", flagged: 1 });
      const usage = await env.DB.prepare("SELECT status FROM ai_usage WHERE job_id = ?1").bind(id).first<{ status: string }>();
      expect(usage?.status).toBe("declined");
      const admin = await session(["Admin"], "ai-ov-admin");
      const editor = await session(["Moderator"], "ai-ov-ed");
      const ov = await (await worker("/", { headers: { cookie: admin } })).text();
      expect(ov).toContain("AI assist needs a look");
      expect(ov).toContain("The AI declined the text");
      expect(ov).toContain(`data-ai-dismiss="${id}"`);
      expect(await (await worker("/", { headers: { cookie: editor } })).text()).not.toContain("AI assist needs a look");
      const dismiss = (cookie: string) => worker(`/admin/api/ai/failures/${id}/dismiss`, { method: "POST", headers: { cookie, origin: ORIGIN } });
      expect((await dismiss(editor)).status).toBe(403);
      expect((await dismiss(admin)).status).toBe(200);
      expect(await (await worker("/", { headers: { cookie: admin } })).text()).not.toContain("AI assist needs a look");
   });

   it("a model the account can't use is permanent; out of capacity is retried with backoff; a cut-off answer is permanent", async () => {
      const a = await queued("seo", { title: "Auth", summary: "", body: "b" }, ["Moderator"], "ai-auth");
      await handleAiQueue(batch("al-ummah-now-cms-ai", a.id).batch, aiEnv(), mockWorkersAi(() => ({ kind: "error", code: 5018, message: "Account not allowed for private model" })).binding);
      expect(await getJob(env.DB, a.id)).toMatchObject({ status: "failed", error: "auth" });
      const g = await queued("seo", { title: "Gone", summary: "", body: "b" }, ["Moderator"], "ai-gone");
      await handleAiQueue(batch("al-ummah-now-cms-ai", g.id).batch, aiEnv(), mockWorkersAi(() => ({ kind: "error", code: 5028, message: "Model deprecated" })).binding);
      expect(await getJob(env.DB, g.id)).toMatchObject({ status: "failed", error: "bad_request" });
      const l = await queued("seo", { title: "Cut", summary: "", body: "b" }, ["Moderator"], "ai-len");
      await handleAiQueue(batch("al-ummah-now-cms-ai", l.id).batch, aiEnv(), mockWorkersAi(() => ({ kind: "json", data: {}, finish: "length" })).binding);
      expect(await getJob(env.DB, l.id)).toMatchObject({ status: "failed", error: "incomplete" });
      const r = await queued("seo", { title: "Busy", summary: "", body: "b" }, ["Moderator"], "ai-429");
      const msg = batch("al-ummah-now-cms-ai", r.id, 3);
      await handleAiQueue(msg.batch, aiEnv(), mockWorkersAi(() => ({ kind: "error", code: 3040, status: 429, message: "Capacity temporarily exceeded" })).binding);
      expect(msg.m.retried).toBe(60); // 15 · 2^(3-1)
      expect(await getJob(env.DB, r.id)).toMatchObject({ status: "queued", error: "rate_limited" });
   });

   it("the DLQ marks a job failed (retries exhausted) and flags it; no AI binding → failed not_configured", async () => {
      const { id } = await queued("seo", { title: "Dead", summary: "", body: "b" }, ["Moderator"], "ai-dlq");
      const d = batch("al-ummah-now-cms-ai-dlq-qa", id, 1);
      const mock = mockWorkersAi();
      await handleAiQueue(d.batch, aiEnv(), mock.binding);
      expect(d.m.acked).toBe(true);
      expect(mock.requests).toHaveLength(0);
      expect(await getJob(env.DB, id)).toMatchObject({ status: "failed", error: "retries_exhausted", flagged: 1 });
      const n = await queued("seo", { title: "Nokey", summary: "", body: "b" }, ["Moderator"], "ai-nokey");
      await handleAiQueue(batch("al-ummah-now-cms-ai", n.id).batch, aiEnv({ AI: undefined }));
      expect(await getJob(env.DB, n.id)).toMatchObject({ status: "failed", error: "not_configured" });
   });
});

describe("usage rollup for the cost dashboard (#266)", () => {
   it("admin only; vendor_costs_daily rows per model, totals by feature and user", async () => {
      const { id, worker } = await queued("seo", { title: "Usage", summary: "", body: "b" }, ["Moderator"], "ai-usage-ed");
      await handleAiQueue(batch("al-ummah-now-cms-ai", id).batch, aiEnv(), mockWorkersAi().binding);
      const editor = await session(["Moderator"], "ai-usage-ed");
      const admin = await session(["Admin"], "ai-usage-admin");
      const today = new Date().toISOString().slice(0, 10);
      expect((await worker(`/admin/api/ai/usage?from=${today}&to=${today}`, { headers: { cookie: editor } })).status).toBe(403);
      expect((await worker("/admin/api/ai/usage?from=bad", { headers: { cookie: admin } })).status).toBe(400);
      const res = (await (await worker(`/admin/api/ai/usage?from=${today}&to=${today}`, { headers: { cookie: admin } })).json()) as {
         vendor_costs_daily: Record<string, unknown>[];
         by_feature: Record<string, unknown>[];
         by_user: Record<string, unknown>[];
      };
      expect(res.vendor_costs_daily).toHaveLength(1);
      expect(res.vendor_costs_daily[0]).toMatchObject({ day: today, vendor: "cloudflare-workers-ai", line_item: MODEL_ID, env: "qa", source: "estimate", input_tokens: 1200, output_tokens: 300, calls: 1 });
      expect(res.vendor_costs_daily[0].neurons).toBeCloseTo(mockNeurons(1200, 300), 3);
      expect(res.vendor_costs_daily[0].amount_usd).toBeCloseTo((mockNeurons(1200, 300) * 0.011) / 1000, 7);
      expect(res.by_feature[0]).toMatchObject({ feature: "seo", calls: 1 });
      expect(res.by_user[0]).toMatchObject({ email: "ai-usage-ed@example.com", calls: 1 });
   });
});
