import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetSearchIndex } from "../../src/lib/search/source.ts";
import { makeWorker } from "./helpers.ts";

const SECRET = "SECRETWORD";

beforeAll(async () => {
   const db = env.DB;
   const now = "2026-11-08T10:00:00.000Z";
   const future = "2099-01-01T00:00:00.000Z";
   await db.batch([
      db.prepare("DELETE FROM posts"),
      db.prepare("DELETE FROM media"),
      db.prepare(
         `INSERT INTO posts (id, slug, locale, title, excerpt, body, status, published_at, publish_at, tags, kind, created_at, updated_at) VALUES
          (1, 'prayer-times', 'en', 'Prayer times', 'When to pray', 'Body', 'published', '2026-11-01T00:00:00.000Z', NULL, '[]', 'article', '${now}', '${now}'),
          (2, 'times-of-prayer', 'en', 'Times of prayer', NULL, 'Body', 'published', '2026-11-05T00:00:00.000Z', NULL, '[]', 'article', '${now}', '${now}'),
          (3, 'ramadan', 'en', 'Ramadan', NULL, 'We pray at night', 'published', '2026-11-06T00:00:00.000Z', NULL, '[]', 'article', '${now}', '${now}'),
          (4, 'draft', 'en', 'Prayer ${SECRET} draft', NULL, '${SECRET}', 'draft', NULL, NULL, '[]', 'article', '${now}', '${now}'),
          (5, 'scheduled', 'en', 'Prayer ${SECRET} scheduled', NULL, '${SECRET}', 'published', '${future}', '${future}', '[]', 'article', '${now}', '${now}'),
          (6, 'ahmad', 'ar', 'أَحمد شوقي', 'مقتطف', 'نص', 'published', '2026-11-02T00:00:00.000Z', NULL, '[]', 'article', '${now}', '${now}'),
          (7, 'hadith', 'ar', 'الحديث النبوي', NULL, 'نص', 'published', '2026-11-03T00:00:00.000Z', NULL, '[]', 'cards', '${now}', '${now}'),
          (8, 'unpublished', 'en', 'Prayer ${SECRET} unpublished', NULL, '${SECRET}', 'unpublished', '2026-11-01T00:00:00.000Z', NULL, '[]', 'article', '${now}', '${now}')`,
      ),
      db.prepare(
         `INSERT INTO media (path, mime_type, size, reference, entity_id, scope, metadata) VALUES
          ('prayer.png', 'image/png', 4, 'posts.cover', '1', 'cover', '{"width":10,"height":5,"alt":"Alt"}')`,
      ),
   ]);
});

beforeEach(() => resetSearchIndex());

const api = (path: string, init?: RequestInit, envOverride = {}) => makeWorker(undefined, envOverride)(`/api/public/v1${path}`, init);

describe("GET /search/suggest", () => {
   it("ranks title prefix > word prefix > body, with the hit shape", async () => {
      const res = await api("/search/suggest?locale=en&q=pray");
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
      const hits = (await res.json()) as Record<string, unknown>[];
      expect(hits.map((h) => h.slug)).toEqual(["prayer-times", "times-of-prayer", "ramadan"]);
      expect(hits[0]).toEqual({
         id: 1,
         type: "article",
         title: "Prayer times",
         slug: "prayer-times",
         locale: "en",
         href: "/en/articles/prayer-times/",
         thumbnailUrl: "https://cms.test/api/public/v1/media/prayer.png?w=320&f=webp",
         excerpt: "When to pray",
         publishedAt: "2026-11-01T00:00:00.000Z",
      });
      expect(hits[1].thumbnailUrl).toBeNull();
   });

   it("never returns drafts, scheduled or unpublished posts", async () => {
      for (const q of ["prayer", SECRET, "draft", "scheduled", "unpublished"]) {
         const text = await (await api(`/search/suggest?locale=en&q=${q}`)).text();
         expect(text).not.toContain(SECRET);
         const full = await (await api(`/search?locale=en&q=${q}`)).text();
         expect(full).not.toContain(SECRET);
      }
   });

   it("normalises Arabic on both sides (lang= works as locale=)", async () => {
      const hits = (await (await api(`/search/suggest?lang=ar&q=${encodeURIComponent("احمد")}`)).json()) as { slug: string }[];
      expect(hits.map((h) => h.slug)).toEqual(["ahmad"]);
      const cards = (await (await api(`/search/suggest?locale=ar&q=${encodeURIComponent("حديث")}`)).json()) as { slug: string; type: string }[];
      expect(cards).toMatchObject([{ slug: "hadith", type: "cards" }]);
   });

   it("limit 1–10, q capped, locale required, empty q → []", async () => {
      expect(((await (await api("/search/suggest?locale=en&q=pray&limit=1")).json()) as unknown[]).length).toBe(1);
      expect((await api("/search/suggest?locale=en&q=pray&limit=11")).status).toBe(400);
      expect((await api("/search/suggest?locale=en&q=pray&limit=0")).status).toBe(400);
      expect((await api("/search/suggest?q=pray")).status).toBe(400);
      expect(await (await api("/search/suggest?locale=en&q=%20%21")).json()).toEqual([]);
      expect(await (await api(`/search/suggest?locale=en&q=${"x".repeat(5000)}`)).json()).toEqual([]);
   });

   it("CORS for www", async () => {
      const res = await api("/search/suggest?locale=en&q=pray", { headers: { Origin: "https://www.test" } });
      expect(res.headers.get("access-control-allow-origin")).toBe("https://www.test");
   });

   it("rate limits per IP (only cache misses count)", async () => {
      const seen = new Map<string, number>();
      const SEARCH_LIMITER = {
         limit: async ({ key }: { key: string }) => {
            seen.set(key, (seen.get(key) ?? 0) + 1);
            return { success: (seen.get(key) ?? 0) <= 2 };
         },
      };
      const headers = { "CF-Connecting-IP": "203.0.113.9" };
      const call = (q: string, h: Record<string, string> = headers) => api(`/search/suggest?locale=en&q=${q}`, { headers: h }, { SEARCH_LIMITER });
      expect((await call("rl-one")).status).toBe(200);
      expect((await call("rl-two")).status).toBe(200);
      const limited = await call("rl-three");
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBe("60");
      expect(await limited.json()).toEqual({ error: "rate_limited" });
      expect((await call("rl-one")).status).toBe(200); // cached: not counted
      expect((await call("rl-four", { "CF-Connecting-IP": "203.0.113.10" })).status).toBe(200);
      // Over the service binding (no CF-Connecting-IP), www names the visitor in X-Client-IP.
      await call("rl-five", { "X-Client-IP": "198.51.100.1" });
      expect(seen.get("198.51.100.1")).toBe(1);
   });
});

describe("GET /search", () => {
   it("pages every match, best first, with the total", async () => {
      const page1 = (await (await api("/search?locale=en&q=pray&limit=2")).json()) as { items: { slug: string }[]; total: number; page: number };
      expect(page1.total).toBe(3);
      expect(page1.items.map((i) => i.slug)).toEqual(["prayer-times", "times-of-prayer"]);
      const page2 = (await (await api("/search?locale=en&q=pray&limit=2&page=2")).json()) as { items: { slug: string }[] };
      expect(page2.items.map((i) => i.slug)).toEqual(["ramadan"]);
      expect(await (await api("/search?locale=en&q=")).json()).toEqual({ items: [], page: 1, limit: 10, total: 0 });
      expect((await api("/search?locale=en&q=x&limit=21")).status).toBe(400);
   });
});
