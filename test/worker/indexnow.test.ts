import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { INDEXNOW_KEY, indexNowUrls, pingIndexNow } from "../../src/lib/indexnow.ts";

/** IndexNow pings for www (wiki AUN-SEO, phase 3). */
const NOW = Date.parse("2026-11-13T12:00:00.000Z");

beforeAll(async () => {
   const db = env.DB;
   await db.batch([
      db.prepare("DELETE FROM posts WHERE id >= 950"),
      db.prepare("DELETE FROM pages WHERE id >= 950"),
      db.prepare(
         `INSERT INTO posts (id, slug, locale, title, body, status, published_at, publish_at, created_at, updated_at) VALUES
          (950, 'fresh-post', 'ar', 'منشور', 'نص', 'published', '2026-11-13T11:50:00.000Z', NULL, '2026-11-13T11:50:00.000Z', '2026-11-13T11:50:00.000Z'),
          (951, 'old-post', 'en', 'Old', 'x', 'published', '2026-11-01T00:00:00.000Z', NULL, '2026-11-01T00:00:00.000Z', '2026-11-01 00:00:00'),
          (952, 'went-live', 'en', 'Scheduled', 'x', 'published', NULL, '2026-11-13T11:59:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z'),
          (953, 'not-yet', 'en', 'Later', 'x', 'published', NULL, '2026-11-13T13:00:00.000Z', '2026-11-13T11:55:00.000Z', '2026-11-13T11:55:00.000Z'),
          (954, 'draft-edit', 'en', 'Draft', 'x', 'draft', NULL, NULL, '2026-11-13T11:55:00.000Z', '2026-11-13 11:55:00')`,
      ),
      db.prepare(
         `INSERT INTO pages (id, slug, locale, title, body, status, published_at, show_in_sitemap, created_at, updated_at) VALUES
          (950, 'about-us', 'en', 'About', 'x', 'published', '2026-11-01T00:00:00.000Z', 1, '2026-11-01T00:00:00.000Z', '2026-11-13 11:40:00')`,
      ),
   ]);
});

describe("indexNowUrls", () => {
   it("maps posts and pages to www addresses, skipping static sections and bad slugs", () => {
      expect(
         indexNowUrls("https://www.alummahnow.net/", [{ slug: "a-b", locale: "ar" }, { slug: "BAD SLUG", locale: "en" }], [{ slug: "about", locale: "en" }, { slug: "videos", locale: "en" }]),
      ).toEqual(["https://www.alummahnow.net/ar/articles/a-b/", "https://www.alummahnow.net/en/about/"]);
   });
});

describe("pingIndexNow", () => {
   it("sends what changed or went live in the window, with the key and its location", async () => {
      const fetcher = vi.fn(async () => new Response(null, { status: 202 }));
      const out = await pingIndexNow({ ...env, ENVIRONMENT: "production", WWW_URL: "https://www.alummahnow.net" } as never, NOW, fetcher as never);
      expect(out).toEqual({ sent: 3, status: 202 });
      const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.indexnow.org/indexnow");
      const body = JSON.parse(String(init.body));
      expect(body.host).toBe("www.alummahnow.net");
      expect(body.key).toBe(INDEXNOW_KEY);
      expect(body.keyLocation).toBe(`https://www.alummahnow.net/${INDEXNOW_KEY}.txt`);
      expect(body.urlList.sort()).toEqual([
         "https://www.alummahnow.net/ar/articles/fresh-post/",
         "https://www.alummahnow.net/en/about-us/",
         "https://www.alummahnow.net/en/articles/went-live/",
      ]);
   });

   it("never pings outside production", async () => {
      const fetcher = vi.fn();
      expect(await pingIndexNow({ ...env, ENVIRONMENT: "qa", WWW_URL: "https://www.qa.alummahnow.net" } as never, NOW, fetcher as never)).toEqual({ sent: 0 });
      expect(fetcher).not.toHaveBeenCalled();
   });
});
