/**
 * Translation flags and the glossary (docs/TRANSLATION_FLAGS.md): flag → source alignment, roles (editors
 * resolve; a scholar flags only their own posts), resolve / dismiss / reopen with the audit trail, the
 * list badge, "Re-translate selection" against a mocked Workers AI (never for Qur'an), add to glossary,
 * soft delete and restore, and the glossary reaching the translation prompt. No real AI call.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { handleAiQueue } from "../../src/lib/ai/runner.ts";
import { purgeGlossary } from "../../src/lib/translation-flags/glossary.ts";
import { mockWorkersAi } from "../support/workers-ai-mock.ts";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

const ORIGIN = "https://cms.test";

async function session(roles: string[], id: string) {
   const { callback } = await signIn(roles, { id, email: `${id}@example.com` });
   return cookiesOf(callback);
}

const SOURCE_BODY = "كُتب عليكم الصيام. وهو يعلّم الصبر. وينتهي عند الغروب.";
const TARGET_BODY = "Fasting is prescribed for you. It teaches endurance. It ends at sunset.";

let seq = 1000;
/** An Arabic original and its English translation, linked by translation_key. Returns the English id. */
async function pair(o: { authorSub?: string | null; targetBody?: string; sourceBody?: string } = {}): Promise<{ en: number; ar: number }> {
   const key = crypto.randomUUID();
   const ar = ++seq;
   const en = ++seq;
   const now = new Date().toISOString();
   await env.DB.batch([
      env.DB.prepare(
         "INSERT INTO posts (id, slug, locale, translation_key, title, excerpt, body, status, author_sub, created_at, updated_at) VALUES (?1, ?2, 'ar', ?3, 'الصيام', 'ملخص', ?4, 'draft', ?5, ?6, ?6)",
      ).bind(ar, `s-${ar}`, key, o.sourceBody ?? SOURCE_BODY, o.authorSub ?? null, now),
      env.DB.prepare(
         "INSERT INTO posts (id, slug, locale, translation_key, title, excerpt, body, status, author_sub, created_at, updated_at) VALUES (?1, ?2, 'en', ?3, 'Fasting', 'Summary', ?4, 'draft', ?5, ?6, ?6)",
      ).bind(en, `s-${en}`, key, o.targetBody ?? TARGET_BODY, o.authorSub ?? null, now),
   ]);
   return { en, ar };
}

type Call = (method: string, path: string, body?: unknown) => Promise<Response>;
function caller(worker: ReturnType<typeof makeWorker>, cookie: string): Call {
   return (method, path, body) =>
      worker(path, { method, headers: { cookie, origin: ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
}

const sel = (id: number, text: string, quote: string, extra: Record<string, unknown> = {}) => {
   const start = text.indexOf(quote);
   return { kind: "posts", id, field: "body", text, start, end: start + quote.length, reason: "term", ...extra };
};

beforeEach(async () => {
   await env.DB.prepare("DELETE FROM translation_flags").run();
   await env.DB.prepare("DELETE FROM translation_flag_events").run();
   await env.DB.prepare("DELETE FROM translation_glossary").run();
   await env.DB.prepare("DELETE FROM ai_usage").run();
   await env.DB.prepare("DELETE FROM ai_jobs").run();
});

describe("flagging", () => {
   it("an editor flags a word: anchored, aligned to the source sentence, listed, counted on the list", async () => {
      const worker = makeWorker();
      const call = caller(worker, await session(["Moderator"], "trf-ed-1"));
      const { en } = await pair();
      const res = await call("POST", "/admin/api/translation-flags", sel(en, TARGET_BODY, "endurance", { suggestion: "patience", note: "الصبر is patience" }));
      expect(res.status).toBe(201);
      const { flag } = (await res.json()) as { flag: Record<string, unknown> };
      expect(flag).toMatchObject({ quote: "endurance", prefix: " prescribed for you. It teaches ", sourceText: "وهو يعلّم الصبر.", sourceScope: "sentence", reason: "term", suggestion: "patience", status: "open", quran: false, createdBy: "trf-ed-1@example.com" });

      const list = (await (await call("GET", `/admin/api/translation-flags?kind=posts&id=${en}`)).json()) as { flags: { id: string; events: { action: string }[] }[]; canResolve: boolean };
      expect(list.canResolve).toBe(true);
      expect(list.flags).toHaveLength(1);
      expect(list.flags[0].events.map((e) => e.action)).toEqual(["created"]);

      const html = await (await worker("/posts?locale=en", { headers: { cookie: (await session(["Moderator"], "trf-ed-1")) } })).text();
      expect(html).toContain("data-trf-badge");
      expect(html).toContain("1 open");
   });

   it("preview returns the source span and detects Qur'an", async () => {
      const call = caller(makeWorker(), await session(["Moderator"], "trf-ed-2"));
      const { en } = await pair({ targetBody: "Indeed, with hardship comes ease.", sourceBody: "قال تعالى ﴿فإن مع العسر يسرا﴾" });
      const res = await call("POST", "/admin/api/translation-flags/preview", sel(en, "Indeed, with hardship comes ease.", "hardship"));
      expect(await res.json()).toMatchObject({ quote: "hardship", sourceScope: "field", quran: true });
   });

   it("the editor page shows the card on a translation only", async () => {
      const worker = makeWorker();
      const cookie = await session(["Moderator"], "trf-ed-3");
      const { en } = await pair();
      const page = await (await worker(`/posts/${en}`, { headers: { cookie } })).text();
      expect(page).toContain('data-trf="1"');
      expect(page).toContain("data-trf-card");
      expect(page).toContain('id="trf-dlg"');
      const now = new Date().toISOString();
      await env.DB.prepare("INSERT INTO posts (id, slug, locale, title, body, status, created_at, updated_at) VALUES (?1, ?2, 'en', 'Alone', 'x', 'draft', ?3, ?3)").bind(++seq, `alone-${seq}`, now).run();
      const alone = await (await worker(`/posts/${seq}`, { headers: { cookie } })).text();
      expect(alone).not.toContain("data-trf-card");
   });

   it("rejects a bad selection or reason", async () => {
      const call = caller(makeWorker(), await session(["Moderator"], "trf-ed-4"));
      const { en } = await pair();
      expect((await call("POST", "/admin/api/translation-flags", { ...sel(en, TARGET_BODY, "endurance"), reason: "nope" })).status).toBe(400);
      expect((await call("POST", "/admin/api/translation-flags", { ...sel(en, TARGET_BODY, "endurance"), start: 5, end: 5 })).status).toBe(400);
      expect((await call("POST", "/admin/api/translation-flags", { ...sel(en, TARGET_BODY, "endurance"), field: "seo_title" })).status).toBe(400);
      expect((await call("POST", "/admin/api/translation-flags", sel(999_999, TARGET_BODY, "endurance"))).status).toBe(404);
   });
});

describe("roles", () => {
   it("a scholar flags their own post but cannot resolve; someone else's post is not found", async () => {
      const worker = makeWorker();
      const sch = caller(worker, await session(["Scholar"], "trf-sch-1"));
      const sub = (await env.DB.prepare("SELECT sso_sub FROM users WHERE email = 'trf-sch-1@example.com'").first<{ sso_sub: string }>())!.sso_sub;
      const mine = await pair({ authorSub: sub });
      const theirs = await pair({ authorSub: "someone-else" });
      const res = await sch("POST", "/admin/api/translation-flags", sel(mine.en, TARGET_BODY, "endurance"));
      expect(res.status).toBe(201);
      const { flag } = (await res.json()) as { flag: { id: string } };
      expect((await sch("POST", `/admin/api/translation-flags/${flag.id}/resolve`, { resolution: "fixed" })).status).toBe(403);
      expect((await sch("POST", `/admin/api/translation-flags/${flag.id}/dismiss`, {})).status).toBe(403);
      expect(((await (await sch("GET", `/admin/api/translation-flags?kind=posts&id=${mine.en}`)).json()) as { canResolve: boolean }).canResolve).toBe(false);
      expect((await sch("POST", "/admin/api/translation-flags", sel(theirs.en, TARGET_BODY, "endurance"))).status).toBe(404);
      expect((await sch("GET", `/admin/api/translation-flags?kind=posts&id=${theirs.en}`)).status).toBe(404);
      expect((await sch("GET", "/admin/api/glossary")).status).toBe(403);
   });

   it("anonymous and cross-origin callers are refused", async () => {
      const worker = makeWorker();
      expect((await worker("/admin/api/translation-flags?kind=posts&id=1")).status).toBe(401);
      const cookie = await session(["Moderator"], "trf-ed-5");
      const cross = await worker("/admin/api/translation-flags", { method: "POST", headers: { cookie, origin: "https://evil.test", "content-type": "application/json" }, body: "{}" });
      expect(cross.status).toBe(403);
   });
});

describe("resolving", () => {
   it("resolve, dismiss and reopen keep the flag as history with an audit trail", async () => {
      const call = caller(makeWorker(), await session(["Moderator"], "trf-ed-6"));
      const { en } = await pair();
      const a = ((await (await call("POST", "/admin/api/translation-flags", sel(en, TARGET_BODY, "endurance", { suggestion: "patience" }))).json()) as { flag: { id: string } }).flag;
      const b = ((await (await call("POST", "/admin/api/translation-flags", sel(en, TARGET_BODY, "sunset", { reason: "grammar" }))).json()) as { flag: { id: string } }).flag;
      const r = await call("POST", `/admin/api/translation-flags/${a.id}/resolve`, { resolution: "applied", text: "patience" });
      expect(await r.json()).toMatchObject({ flag: { status: "resolved", resolution: "applied", resolvedBy: "trf-ed-6@example.com" } });
      expect((await call("POST", `/admin/api/translation-flags/${a.id}/resolve`, { resolution: "applied" })).status).toBe(409);
      expect(await (await call("POST", `/admin/api/translation-flags/${b.id}/dismiss`, { note: "fine as is" })).json()).toMatchObject({ flag: { status: "dismissed" } });
      expect(await (await call("POST", `/admin/api/translation-flags/${b.id}/reopen`)).json()).toMatchObject({ flag: { status: "open", resolvedBy: null } });
      const list = (await (await call("GET", `/admin/api/translation-flags?kind=posts&id=${en}`)).json()) as { flags: { id: string; status: string; events: { action: string; detail: unknown }[] }[] };
      expect(list.flags[0]).toMatchObject({ id: b.id, status: "open" }); // open first
      const hist = list.flags.find((f) => f.id === a.id)!;
      expect(hist.events.map((e) => e.action)).toEqual(["created", "resolved"]);
      expect(hist.events[1].detail).toEqual({ resolution: "applied", text: "patience" });
      expect(list.flags.find((f) => f.id === b.id)!.events.map((e) => e.action)).toEqual(["created", "dismissed", "reopened"]);
      expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM translation_flags").first<{ n: number }>()).toEqual({ n: 2 });
   });
});

describe("re-translate selection (mocked Workers AI)", () => {
   const queue = { send: async () => undefined, sendBatch: async () => undefined } as unknown as Queue;

   it("returns 2–3 alternatives for the span, logs usage as retranslate", async () => {
      const ai = mockWorkersAi();
      const call = caller(makeWorker(undefined, { AI: ai.binding, AI_JOBS: queue } as never), await session(["Moderator"], "trf-ed-7"));
      const { en } = await pair();
      const { flag } = (await (await call("POST", "/admin/api/translation-flags", sel(en, TARGET_BODY, "endurance"))).json()) as { flag: { id: string } };
      const res = await call("POST", `/admin/api/translation-flags/${flag.id}/alternatives`, { text: TARGET_BODY });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ alternatives: ["Option A: endurance", "Option B: endurance"] });
      expect(ai.requests).toHaveLength(1);
      expect(ai.requests[0].user).toContain("It teaches ⟦endurance⟧.");
      expect(ai.requests[0].user).toContain("وهو يعلّم الصبر.");
      expect(await env.DB.prepare("SELECT feature, status FROM ai_usage").all()).toMatchObject({ results: [{ feature: "retranslate", status: "ok" }] });
   });

   it("never for Qur'an: refused before any model call", async () => {
      const ai = mockWorkersAi();
      const call = caller(makeWorker(undefined, { AI: ai.binding, AI_JOBS: queue } as never), await session(["Moderator"], "trf-ed-8"));
      const { en } = await pair();
      const { flag } = (await (await call("POST", "/admin/api/translation-flags", sel(en, TARGET_BODY, "endurance", { reason: "quran_hadith", quran: true }))).json()) as { flag: { id: string; quran: boolean; quranUrl: string } };
      expect(flag.quran).toBe(true);
      expect(flag.quranUrl).toMatch(/^https:\/\/quran\.com\//);
      expect((await call("POST", `/admin/api/translation-flags/${flag.id}/alternatives`, { text: TARGET_BODY })).status).toBe(409);
      expect(ai.requests).toHaveLength(0);
   });

   it("503 when AI assist isn't configured", async () => {
      const call = caller(makeWorker(undefined, { AI: undefined, AI_JOBS: queue } as never), await session(["Moderator"], "trf-ed-9"));
      const { en } = await pair();
      const { flag } = (await (await call("POST", "/admin/api/translation-flags", sel(en, TARGET_BODY, "endurance"))).json()) as { flag: { id: string } };
      expect((await call("POST", `/admin/api/translation-flags/${flag.id}/alternatives`, {})).status).toBe(503);
   });
});

describe("glossary", () => {
   it("add from a term flag, refuse a duplicate, soft delete (admin) and restore, purge after 30 days", async () => {
      const worker = makeWorker();
      const ed = caller(worker, await session(["Moderator"], "trf-ed-10"));
      const admin = caller(worker, await session(["Admin"], "trf-admin-1"));
      const { en } = await pair();
      const { flag } = (await (await ed("POST", "/admin/api/translation-flags", sel(en, TARGET_BODY, "endurance", { suggestion: "patience" }))).json()) as { flag: { id: string } };
      const add = await ed("POST", `/admin/api/translation-flags/${flag.id}/glossary`, { sourceTerm: "الصبر", targetTerm: "patience" });
      expect(add.status).toBe(201);
      const { entry } = (await add.json()) as { entry: { id: string; source_locale: string; target_locale: string } };
      expect(entry).toMatchObject({ source_locale: "ar", target_locale: "en", flag_id: flag.id });
      expect((await ed("POST", "/admin/api/glossary", { sourceLocale: "ar", sourceTerm: "الصَّبر", targetTerm: "x" })).status).toBe(409); // same term, tashkeel ignored
      const grammar = (await (await ed("POST", "/admin/api/translation-flags", sel(en, TARGET_BODY, "sunset", { reason: "grammar" }))).json()) as { flag: { id: string } };
      expect((await ed("POST", `/admin/api/translation-flags/${grammar.flag.id}/glossary`, { sourceTerm: "a", targetTerm: "b" })).status).toBe(409);

      expect((await ed("DELETE", `/admin/api/glossary/${entry.id}`)).status).toBe(403);
      expect((await admin("DELETE", `/admin/api/glossary/${entry.id}`)).status).toBe(200);
      expect(((await (await ed("GET", "/admin/api/glossary")).json()) as { entries: unknown[] }).entries).toHaveLength(0);
      expect(((await (await admin("GET", "/admin/api/glossary?deleted=1")).json()) as { entries: unknown[] }).entries).toHaveLength(1);
      expect((await admin("POST", `/admin/api/glossary/${entry.id}/restore`)).status).toBe(200);
      expect(((await (await ed("GET", "/admin/api/glossary?q=صبر")).json()) as { entries: unknown[] }).entries).toHaveLength(1);

      await admin("DELETE", `/admin/api/glossary/${entry.id}`);
      expect(await purgeGlossary(env.DB, Date.now())).toBe(0);
      expect(await purgeGlossary(env.DB, Date.now() + 31 * 24 * 3600 * 1000)).toBe(1);
      const events = await env.DB.prepare("SELECT action FROM translation_flag_events WHERE flag_id = ?1 ORDER BY at").bind(flag.id).all<{ action: string }>();
      expect(events.results.map((e) => e.action)).toEqual(["created", "glossary"]);
   });

   it("the glossary page opens with its terms listed", async () => {
      const worker = makeWorker();
      const cookie = await session(["Moderator"], "trf-ed-11");
      await caller(worker, cookie)("POST", "/admin/api/glossary", { sourceLocale: "ar", sourceTerm: "الزكاة", targetTerm: "zakat" });
      const html = await (await worker("/glossary", { headers: { cookie } })).text();
      expect(html).toContain("Translation glossary");
      expect(html).toContain("الزكاة");
      expect(html).toContain("zakat");
   });

   it("machine translation includes the matching glossary terms in its prompt", async () => {
      const ai = mockWorkersAi();
      const sent: { jobId: string }[] = [];
      const q = { send: async (m: { jobId: string }) => void sent.push(m), sendBatch: async () => undefined } as unknown as Queue;
      const worker = makeWorker(undefined, { AI: ai.binding, AI_JOBS: q } as never);
      const call = caller(worker, await session(["Moderator"], "trf-ed-12"));
      await call("POST", "/admin/api/glossary", { sourceLocale: "ar", sourceTerm: "الصبر", targetTerm: "patience" });
      await call("POST", "/admin/api/glossary", { sourceLocale: "ar", sourceTerm: "الحج", targetTerm: "Hajj" });
      const res = await call("POST", "/admin/api/ai/jobs", { feature: "translate", kind: "posts", locale: "ar", ui: "en", fields: { title: "الصيام", summary: "", body: SOURCE_BODY } });
      expect(res.status).toBe(202);
      const msg = { id: "m", timestamp: new Date(), body: sent[0], attempts: 1, ack() {}, retry() {} };
      await handleAiQueue({ queue: "al-ummah-now-cms-ai-qa", messages: [msg], ackAll() {}, retryAll() {} } as never, { ...env, AI: ai.binding } as never);
      expect(ai.requests[0].system).toContain("الصبر → patience");
      expect(ai.requests[0].system).not.toContain("Hajj"); // only terms in the text
   });
});
