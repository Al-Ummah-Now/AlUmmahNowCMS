/**
 * Localized fields (docs/LOCALIZED_FIELDS.md): the staff Translate endpoint against a mocked Workers AI
 * (Workers AI only, glossary, «مرئي» rule, Qur'an refused, limits, staff only) and the home timeline's
 * en/ar "Title on the site" pair (both or neither, no cross-language fallback, legacy rows marked).
 * No real AI call: setup.ts swaps the real binding for one that throws.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { feedItems } from "../../src/lib/feed/source.ts";
import { arabicVideoWording } from "../../src/lib/field-translate.ts";
import { mockWorkersAi } from "../support/workers-ai-mock.ts";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";
import { insertVideoEntry, resetFeed, testEnv } from "./feed-helpers.ts";

const ORIGIN = "https://cms.test";

async function session(roles: string[], id: string) {
   const { callback } = await signIn(roles, { id, email: `${id}@example.com` });
   return cookiesOf(callback);
}

function caller(cookie: string, over: Record<string, unknown> = {}) {
   const f = makeWorker(undefined, over as never);
   return (method: string, path: string, body?: unknown) =>
      f(path, { method, headers: { cookie, origin: ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
}

beforeEach(async () => {
   await env.DB.prepare("DELETE FROM ai_usage").run();
   await env.DB.prepare("DELETE FROM translation_glossary").run();
   await env.DB.prepare("DELETE FROM ai_settings").run();
   await resetFeed();
});

describe("POST /admin/api/translate (mocked Workers AI)", () => {
   it("fills the other language, logs who asked (feature field_translate), sends the glossary", async () => {
      const ai = mockWorkersAi();
      const call = caller(await session(["Moderator"], "l10n-ed-1"), { AI: ai.binding });
      await env.DB.prepare("INSERT INTO translation_glossary (id, source_locale, source_term, target_locale, target_term, created_at, updated_at) VALUES ('g1', 'en', 'Shorts', 'ar', 'المقاطع القصيرة', 1, 1)").run();
      const res = await call("POST", "/admin/api/translate", { text: "New Shorts", from: "en", to: "ar" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ text: "ترجمة: New Shorts" });
      expect(ai.requests).toHaveLength(1);
      expect(ai.requests[0].system).toContain("into Modern Standard Arabic");
      expect(ai.requests[0].system).toContain("Shorts → المقاطع القصيرة");
      expect(ai.requests[0].system).toContain("«مرئي»");
      const rows = (await env.DB.prepare("SELECT feature, status, provider, user_id FROM ai_usage").all()).results;
      expect(rows).toMatchObject([{ feature: "field_translate", status: "ok", provider: "workers-ai" }]);
      expect(rows[0].user_id).not.toBeNull();
      const back = await call("POST", "/admin/api/translate", { text: "مرئيات جديدة", from: "ar", to: "en" });
      expect(await back.json()).toEqual({ text: "Translated: مرئيات جديدة" });
   });

   it("Arabic output never says فيديو", async () => {
      const ai = mockWorkersAi(() => ({ kind: "json", data: { text: "أحدث الفيديوهات وفيديو واحد", quran: "none" } }));
      const call = caller(await session(["Moderator"], "l10n-ed-2"), { AI: ai.binding });
      expect(await (await call("POST", "/admin/api/translate", { text: "Latest videos and one video", from: "en", to: "ar" })).json()).toEqual({ text: "أحدث المرئيات ومرئي واحد" });
      expect(arabicVideoWording("مقاطع الفيديو")).toBe("مرئيات");
   });

   it("Qur'an is refused: detected before any call, or reported by the model", async () => {
      const ai = mockWorkersAi();
      const call = caller(await session(["Moderator"], "l10n-ed-3"), { AI: ai.binding });
      const r1 = await call("POST", "/admin/api/translate", { text: "﴿ إِنَّ الدِّينَ عِندَ اللَّهِ الْإِسْلَامُ ﴾", from: "ar", to: "en" });
      expect(r1.status).toBe(422);
      expect(await r1.json()).toMatchObject({ error: "quran", quranUrl: expect.stringContaining("https://quran.com/") });
      expect(ai.requests).toHaveLength(0);
      const ai2 = mockWorkersAi(() => ({ kind: "json", data: { text: "Indeed the religion with Allah is Islam", quran: "yes" } }));
      const call2 = caller(await session(["Moderator"], "l10n-ed-4"), { AI: ai2.binding });
      expect((await call2("POST", "/admin/api/translate", { text: "إن الدين عند الله الإسلام", from: "ar", to: "en" })).status).toBe(422);
   });

   it("runs on Workers AI even when translate is routed to an HTTP provider, with no fallback", async () => {
      const ai = mockWorkersAi();
      const settings = {
         providers: [
            { id: "workers-ai", kind: "workers-ai", label: "Cloudflare Workers AI", enabled: true, models: ["@cf/deepseek-ai/deepseek-v4.1-flash-1017"] },
            { id: "ext", kind: "http", label: "Ext", enabled: true, method: "POST", url: "https://ext.example/v1", auth: { type: "header", header: "Authorization", prefix: "Bearer ", secret: "AI_KEY_EXT" }, headers: {}, body: "{}", output: "text", models: ["m"] },
         ],
         features: { translate: { provider: "ext", model: "m" }, seo: { provider: "workers-ai", model: "x" }, check: { provider: "workers-ai", model: "x" } },
         fallback: { provider: "ext", model: "m" },
         monthlyBudgetUsd: 50,
      };
      await env.DB.prepare("INSERT INTO ai_settings (id, data, version, updated_at) VALUES (1, ?1, 1, 1)").bind(JSON.stringify(settings)).run();
      const call = caller(await session(["Moderator"], "l10n-ed-5"), { AI: ai.binding });
      const res = await call("POST", "/admin/api/translate", { text: "Home", from: "en", to: "ar" });
      expect(res.status).toBe(200);
      expect(ai.requests).toHaveLength(1);
      expect((await env.DB.prepare("SELECT provider FROM ai_usage").all()).results).toEqual([{ provider: "workers-ai" }]);
   });

   it("staff only, validated, capped per day", async () => {
      const ai = mockWorkersAi();
      const writer = caller(await session(["Scholar"], "l10n-wr-1"), { AI: ai.binding });
      expect((await writer("POST", "/admin/api/translate", { text: "Hi", from: "en", to: "ar" })).status).toBe(403);
      const call = caller(await session(["Moderator"], "l10n-ed-6"), { AI: ai.binding });
      expect((await call("POST", "/admin/api/translate", { text: "Hi", from: "en", to: "en" })).status).toBe(400);
      expect((await call("POST", "/admin/api/translate", { text: " ", from: "en", to: "ar" })).status).toBe(400);
      expect((await call("POST", "/admin/api/translate", { text: "x".repeat(2001), from: "en", to: "ar" })).status).toBe(413);
      const day = new Date().toISOString().slice(0, 10);
      const stmts = Array.from({ length: 400 }, (_, i) =>
         env.DB.prepare("INSERT INTO ai_usage (id, at, day, env, user_id, feature, provider, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, neurons, cost_usd, status) VALUES (?1, ?2, ?3, 'qa', 1, 'field_translate', 'workers-ai', 'm', 0, 0, 0, 0, 0, 0, 'ok')").bind(`cap-${i}`, Date.now() - 86_400_000 + 1, day),
      );
      await env.DB.batch(stmts);
      const res = await call("POST", "/admin/api/translate", { text: "Hi", from: "en", to: "ar" });
      expect(res.status).toBe(429);
      expect(await res.json()).toEqual({ error: "daily_cap" });
      expect(ai.requests).toHaveLength(0);
   });

   it("the loud guard: the real binding throws under test", async () => {
      expect(() => (env as unknown as { AI: { run(): unknown } }).AI.run()).toThrow(/REAL WORKERS AI CALLED UNDER TEST/);
   });
});

describe("home timeline: en/ar title on the site", () => {
   const titles = async (l: "en" | "ar") => (await feedItems(testEnv(), l, { pinned: false })).map((i) => i.video?.title_override ?? null);

   it("an entry shown in both languages takes both titles or neither; each language gets only its own", async () => {
      const call = caller(await session(["Moderator"], "l10n-tl-1"));
      const id = await insertVideoEntry({ ref: "pair-1", date: "2026-10-01T10:00:00.000Z" });
      const half = await call("PATCH", `/admin/api/timeline/entries/v${id}`, { title_override: "Our talk", title_override_ar: null });
      expect(half.status).toBe(400);
      expect(await half.json()).toEqual({ error: "ar_missing" });
      expect((await call("PATCH", `/admin/api/timeline/entries/v${id}`, { title_override: "", title_override_ar: "حديثنا" })).status).toBe(400);
      expect((await call("PATCH", `/admin/api/timeline/entries/v${id}`, { title_override: "Our talk", title_override_ar: "حديثنا" })).status).toBe(200);
      expect(await titles("en")).toEqual(["Our talk"]);
      expect(await titles("ar")).toEqual(["حديثنا"]);
      // Language change keeps that language's title.
      expect((await call("PATCH", `/admin/api/timeline/entries/v${id}`, { locale: "ar" })).status).toBe(200);
      expect(await env.DB.prepare("SELECT title_override, title_override_ar FROM timeline_entries WHERE id = ?1").bind(id).first()).toEqual({ title_override: "حديثنا", title_override_ar: null });
      // Clearing both is fine (the video's own title shows).
      expect((await call("PATCH", `/admin/api/timeline/entries/v${id}`, { locale: "all" })).status).toBe(200);
      expect((await call("PATCH", `/admin/api/timeline/entries/v${id}`, { title_override: null, title_override_ar: null })).status).toBe(200);
      expect(await titles("en")).toEqual([null]);
   });

   it("legacy rows: one text belongs to its own language, the other shows the video's title and is marked", async () => {
      const cookie = await session(["Moderator"], "l10n-tl-2");
      const en = await insertVideoEntry({ ref: "legacy-en", date: "2026-10-02T10:00:00.000Z" });
      const ar = await insertVideoEntry({ ref: "legacy-ar", date: "2026-10-01T10:00:00.000Z" });
      await env.DB.prepare("UPDATE timeline_entries SET title_override = ?2 WHERE id = ?1").bind(en, "English only").run();
      await env.DB.prepare("UPDATE timeline_entries SET title_override = ?2 WHERE id = ?1").bind(ar, "عربي فقط").run();
      expect(await titles("en")).toEqual(["English only", null]);
      expect(await titles("ar")).toEqual([null, "عربي فقط"]);
      const f = makeWorker();
      const html = await (await f("/timeline?locale=en", { headers: { cookie } })).text();
      expect(html).toContain('data-l10n-missing="ar"');
      expect(html).toContain('data-l10n-missing="en"');
      expect(html).toContain("Missing a language");
      expect(html).toContain('data-l10n-pair');
      expect(html).toMatch(/lang="ar" dir="rtl"[^>]*data-l10n-input="ar"/);
      const missing = await (await f("/timeline?locale=en&missing=1", { headers: { cookie } })).text();
      expect(missing).toContain("data-tl-translate-missing");
      expect(missing).not.toContain("data-pins");
      expect(html).not.toContain("Leave empty");
   });
});
