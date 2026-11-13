import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { makeWorker } from "./helpers.ts";

/** Renamed slugs keep their old address (migration 0018, D-SEO-7): www asks /redirects and answers 301. */
const NOW = "2026-11-08T10:00:00.000Z";

beforeAll(async () => {
   const db = env.DB;
   await db.batch([
      db.prepare("DELETE FROM slug_history"),
      db.prepare("DELETE FROM posts WHERE id >= 900"),
      db.prepare("DELETE FROM pages WHERE id >= 900"),
      db.prepare(
         `INSERT INTO posts (id, slug, locale, title, body, status, published_at, created_at, updated_at) VALUES
          (900, 'first-name', 'ar', 'منشور', 'نص', 'published', '${NOW}', '${NOW}', '${NOW}'),
          (901, 'draft-name', 'ar', 'مسودة', 'نص', 'draft', NULL, '${NOW}', '${NOW}')`,
      ),
      db.prepare(
         `INSERT INTO pages (id, slug, locale, title, body, status, published_at, show_in_sitemap, created_at, updated_at) VALUES
          (900, 'old-page', 'en', 'Page', 'x', 'published', '${NOW}', 1, '${NOW}', '${NOW}')`,
      ),
   ]);
   await db.prepare("UPDATE posts SET slug = 'second-name' WHERE id = 900").run();
   await db.prepare("UPDATE posts SET slug = 'third-name' WHERE id = 900").run();
   await db.prepare("UPDATE posts SET slug = 'draft-renamed' WHERE id = 901").run();
   await db.prepare("UPDATE pages SET slug = 'new-page' WHERE id = 900").run();
});

const get = (path: string) => makeWorker()(`/api/public/v1${path}`);

describe("slug history", () => {
   it("every old address of a published post leads to its current slug", async () => {
      for (const old of ["first-name", "second-name"]) {
         const res = await get(`/redirects/post/${old}?locale=ar`);
         expect(res.status).toBe(200);
         expect(await res.json()).toEqual({ slug: "third-name" });
      }
   });

   it("pages too", async () => {
      expect(await (await get("/redirects/page/old-page?locale=en")).json()).toEqual({ slug: "new-page" });
   });

   it("a draft's earlier slug was never public: nothing recorded", async () => {
      expect((await get("/redirects/post/draft-name?locale=ar")).status).toBe(404);
   });

   it("is per language, and unknown slugs or types are 404", async () => {
      expect((await get("/redirects/post/first-name?locale=en")).status).toBe(404);
      expect((await get("/redirects/post/never-there?locale=ar")).status).toBe(404);
      expect((await get("/redirects/user/first-name?locale=ar")).status).toBe(404);
   });

   it("an unpublished target leads nowhere", async () => {
      await env.DB.prepare("UPDATE pages SET status = 'draft' WHERE id = 900").run();
      expect((await get("/redirects/page/old-page?locale=en")).status).toBe(404);
      await env.DB.prepare("UPDATE pages SET status = 'published' WHERE id = 900").run();
   });

   it("renaming back to an old address removes its redirect", async () => {
      await env.DB.prepare("UPDATE posts SET slug = 'first-name' WHERE id = 900").run();
      expect((await get("/redirects/post/first-name?locale=ar")).status).toBe(404);
      expect(await (await get("/redirects/post/third-name?locale=ar")).json()).toEqual({ slug: "first-name" });
   });
});
