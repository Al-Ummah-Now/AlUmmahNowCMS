/**
 * The editor's English address suggestion (src/lib/slug-suggest.ts, POST /admin/api/ai/slug): English
 * title first, then the Arabic title translated by the AI layer (a MOCKED Workers AI binding: no real
 * provider is ever called), then transliteration. Cache, Regenerate, budget, failures, test accounts,
 * usage logging and roles.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { suggestSlug } from "../../src/lib/slug-suggest.ts";
import { mockWorkersAi, type MockReply } from "../support/workers-ai-mock.ts";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

const ORIGIN = "https://cms.test";
const AYAH = "إن الدين عند الله الإسلام";

async function session(roles: string[], id: string, email = `${id}@example.com`) {
   const { callback } = await signIn(roles, { id, email });
   return cookiesOf(callback);
}

function suggestReq(f: ReturnType<typeof makeWorker>, cookie: string, body: Record<string, unknown>) {
   return f("/admin/api/ai/slug", { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });
}

/** A cache that forgets nothing within a test (the Cache API is shared across tests otherwise). */
function memoryCache() {
   const m = new Map<string, string>();
   return {
      map: m,
      cache: {
         match: async (k: string) => (m.has(k) ? new Response(m.get(k)) : undefined),
         put: async (k: string, r: Response) => void m.set(k, await r.text()),
      } as unknown as Cache,
   };
}

const aiEnv = (binding: unknown) => ({ ...env, AI: binding }) as never;

beforeEach(async () => {
   for (const t of ["ai_usage", "ai_settings"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("suggestSlug", () => {
   it("translates an Arabic title to a short English phrase and caches it by title", async () => {
      const ai = mockWorkersAi();
      const { cache, map } = memoryCache();
      const s = await suggestSlug(aiEnv(ai.binding), { title: AYAH, cache, user: { id: 7, email: "editor@example.com" } });
      expect(s).toEqual({ base: "religion-with-allah-is-islam", source: "translated" });
      expect(ai.requests).toHaveLength(1);
      expect(ai.requests[0].system).toContain("literally and neutrally");
      expect(ai.requests[0].user).toBe(`<title>\n${AYAH}\n</title>`);
      // Cached: the second ask does not call the model; Regenerate (fresh) does.
      expect((await suggestSlug(aiEnv(ai.binding), { title: AYAH, cache })).base).toBe("religion-with-allah-is-islam");
      expect(ai.requests).toHaveLength(1);
      expect(map.size).toBe(1);
      await suggestSlug(aiEnv(ai.binding), { title: AYAH, cache, fresh: true });
      expect(ai.requests).toHaveLength(2);
      // Each call is logged as feature "slug".
      const usage = await env.DB.prepare("SELECT feature, user_id, status FROM ai_usage ORDER BY at").all<{ feature: string; user_id: number | null; status: string }>();
      expect(usage.results.map((u) => u.feature)).toEqual(["slug", "slug"]);
      expect(usage.results[0]).toMatchObject({ user_id: 7, status: "ok" });
   });

   it("uses an English title as it is, without the model", async () => {
      const ai = mockWorkersAi();
      expect(await suggestSlug(aiEnv(ai.binding), { title: AYAH, englishTitle: "Religion with God", cache: null })).toEqual({ base: "religion-with-god", source: "english" });
      expect(await suggestSlug(aiEnv(ai.binding), { title: "Fasting in Shawwal", cache: null })).toEqual({ base: "fasting-in-shawwal", source: "english" });
      expect(ai.requests).toHaveLength(0);
   });

   const failing: [string, MockReply, string][] = [
      ["a provider error", { kind: "error", code: 3040, status: 429 }, "rate_limited"],
      ["an answer with Arabic in it", { kind: "json", data: { phrase: "الدين", quran: "none" } }, "invalid_output"],
      ["one word", { kind: "json", data: { phrase: "religion", quran: "none" } }, "invalid_output"],
      ["only numbers", { kind: "json", data: { phrase: "3 19", quran: "mostly" } }, "invalid_output"],
      ["a refusal", { kind: "json", data: { phrase: "x y", quran: "none" }, refusal: "no" }, "declined"],
   ];
   for (const [what, reply, reason] of failing) {
      it(`falls back to transliteration on ${what}`, async () => {
         const ai = mockWorkersAi(() => reply);
         const s = await suggestSlug(aiEnv(ai.binding), { title: AYAH, cache: null });
         expect(s.base).toBe("inna-al-din-inda-allah-al-islam");
         expect(s.source).toBe("transliterated");
         expect(s.reason).toBe(reason);
      });
   }

   it("falls back on a timeout, without waiting for the model", async () => {
      const slow = { run: () => new Promise(() => undefined) };
      const s = await suggestSlug(aiEnv(slow), { title: AYAH, cache: null, timeoutMs: 20 });
      expect(s).toMatchObject({ source: "transliterated", reason: "timeout" });
   });

   it("never calls a provider for automated test accounts on a deployed env", async () => {
      const ai = mockWorkersAi();
      for (const email of ["delivered+cms-e2e-admin@resend.dev", "qa-admin@e2e.alummahnow.net", "e2e+123-1-a@e2e.alummahnow.net", "qa-creator@delivered.resend.dev"]) {
         const s = await suggestSlug(aiEnv(ai.binding), { title: AYAH, cache: null, user: { email } });
         expect(s, email).toMatchObject({ source: "transliterated", reason: "test_account" });
      }
      expect(ai.requests).toHaveLength(0);
   });

   it("stops at the monthly budget", async () => {
      const ai = mockWorkersAi();
      await env.DB.prepare("INSERT INTO ai_usage (id, at, day, env, user_id, feature, provider, model, job_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, neurons, cost_usd, status) VALUES ('b', ?1, ?2, ?3, NULL, 'translate', 'workers-ai', 'm', NULL, 0, 0, 0, 0, 0, 1000, 'ok')")
         .bind(Date.now(), new Date().toISOString().slice(0, 10), env.ENVIRONMENT)
         .run();
      const s = await suggestSlug(aiEnv(ai.binding), { title: AYAH, cache: null });
      expect(s).toMatchObject({ source: "transliterated", reason: "budget_reached" });
      expect(ai.requests).toHaveLength(0);
   });
});

describe("POST /admin/api/ai/slug", () => {
   it("returns a free English slug for an Arabic title, the linked English version's title first", async () => {
      const ai = mockWorkersAi();
      const f = makeWorker(undefined, { AI: ai.binding as never });
      const cookie = await session(["Admin"], "slug-api-admin");
      const title = `${AYAH} api`;
      let r = await suggestReq(f, cookie, { kind: "posts", locale: "ar", title });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ slug: "religion-with-allah-is-islam-api", base: "religion-with-allah-is-islam-api", source: "translated", reason: null });
      // Taken → -2.
      const made = await f("/api/data/entity/posts", { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ locale: "ar", title, slug: "religion-with-allah-is-islam-api", translation_key: "k-slug-api" }) });
      expect(made.status).toBe(201);
      const id = ((await made.json()) as { data: { id: number } }).data.id;
      r = await suggestReq(f, cookie, { kind: "posts", locale: "ar", title });
      expect(((await r.json()) as { slug: string }).slug).toBe("religion-with-allah-is-islam-api-2");
      // The row itself keeps its own slug free.
      r = await suggestReq(f, cookie, { kind: "posts", locale: "ar", title, id });
      expect(((await r.json()) as { slug: string }).slug).toBe("religion-with-allah-is-islam-api");
      // Linked to an English version: its title wins.
      await f("/api/data/entity/posts", { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ locale: "en", title: "The religion with God", slug: "x-en-slug-api", translation_key: "k-slug-api" }) });
      r = await suggestReq(f, cookie, { kind: "posts", locale: "ar", title, id });
      expect(await r.json()).toMatchObject({ slug: "the-religion-with-god", source: "english" });
   });

   it("answers with transliteration when AI is off, and refuses bad input and non-staff", async () => {
      const f = makeWorker(undefined, { AI: undefined });
      const cookie = await session(["Admin"], "slug-api-off");
      const r = await suggestReq(f, cookie, { kind: "pages", locale: "ar", title: "كتاب التوحيد", fresh: true });
      expect(await r.json()).toMatchObject({ slug: "ktab-al-tuhid", source: "transliterated" });
      expect((await suggestReq(f, cookie, { kind: "videos", locale: "ar", title: "x" })).status).toBe(400);
      expect((await suggestReq(f, cookie, { kind: "posts", locale: "fr", title: "x" })).status).toBe(400);
      expect((await suggestReq(f, cookie, { kind: "posts", locale: "ar", title: "x".repeat(201) })).status).toBe(400);
      const viewer = await session([], "slug-api-viewer");
      expect((await suggestReq(f, viewer, { kind: "posts", locale: "ar", title: "x" })).status).not.toBe(200);
   });
});
