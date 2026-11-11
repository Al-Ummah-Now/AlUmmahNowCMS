import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { makeWorker } from "./helpers.ts";

const DRAFT = "DRAFT-MUST-NOT-LEAK";

beforeAll(async () => {
   const db = env.DB;
   const now = "2026-11-08T10:00:00.000Z";
   await db.batch([
      db.prepare("DELETE FROM pages"),
      db.prepare("DELETE FROM posts"),
      db.prepare("DELETE FROM nav_items"),
      db.prepare("DELETE FROM curated_videos"),
      db.prepare("DELETE FROM site_settings"),
      db.prepare("DELETE FROM media"),
      db.prepare(
         `INSERT INTO site_settings (locale, site_title, tagline, hero_title, hero_body, social) VALUES
          ('en', 'Al Ummah Now', 'Tag', 'Hero', 'Body', '[{"kind":"x","url":"https://x.com/a"},{"bad":1},{"kind":"js","url":"javascript:alert(1)"}]')`,
      ),
      db.prepare(
         `INSERT INTO pages (id, slug, locale, translation_key, title, summary, body, status, published_at, show_in_sitemap, created_at, updated_at) VALUES
          (1, 'about', 'en', 'about', 'About', 'S', '# About', 'published', '${now}', 1, '${now}', '${now}'),
          (2, 'hawl', 'ar', 'about', 'حول', NULL, 'نص', 'published', '${now}', 1, '${now}', '${now}'),
          (3, 'secret', 'en', 'about', '${DRAFT}', NULL, '${DRAFT}', 'draft', NULL, 1, '${now}', '${now}'),
          (4, 'hidden', 'en', NULL, 'Hidden', NULL, 'x', 'published', '${now}', 0, '${now}', '${now}'),
          (5, 'sirr', 'ar', 'about-draft', '${DRAFT}', NULL, '${DRAFT}', 'draft', NULL, 1, '${now}', '${now}')`,
      ),
      db.prepare(
         `INSERT INTO posts (id, slug, locale, translation_key, title, excerpt, body, status, published_at, tags, author_name, created_at, updated_at) VALUES
          (1, 'p1', 'en', 't1', 'Post 1', 'E1', 'B1', 'published', '2026-11-01T00:00:00.000Z', '["news"]', 'A', '${now}', '${now}'),
          (2, 'p2', 'en', NULL, 'Post 2', NULL, 'B2', 'published', '2026-11-02T00:00:00.000Z', NULL, NULL, '${now}', '${now}'),
          (3, 'p3', 'en', NULL, 'Post 3', NULL, 'B3', 'published', '2026-11-03T00:00:00.000Z', '[]', NULL, '${now}', '${now}'),
          (4, 'p4', 'en', NULL, 'Post 4', NULL, 'B4', 'published', '2026-11-04T00:00:00.000Z', '[]', NULL, '${now}', '${now}'),
          (5, 'draft', 'en', 't1', '${DRAFT}', '${DRAFT}', '${DRAFT}', 'draft', NULL, '[]', NULL, '${now}', '${now}'),
          (6, 'p1-ar', 'ar', 't1', 'منشور', NULL, 'ب', 'published', '2026-11-01T00:00:00.000Z', '[]', NULL, '${now}', '${now}')`,
      ),
      db.prepare(
         `INSERT INTO nav_items (menu, locale, label, url, sort, status) VALUES
          ('header', 'en', 'About', '/about', 2, 'published'),
          ('header', 'en', 'Videos', '/videos', 1, 'published'),
          ('footer', 'en', 'Contact', 'https://example.com', 0, 'published'),
          ('header', 'en', '${DRAFT}', '/draft', 0, 'draft')`,
      ),
      db.prepare(
         `INSERT INTO curated_videos (id, kind, ref_id, placement, locale, title_override, sort, status, snapshot) VALUES
          (1, 'video', 'v1', 'home', 'all', NULL, 2, 'published', '{"title":"V1","thumbnail_url":"https://cdn/t.jpg","channel_name":"C"}'),
          (2, 'playlist', 'p1', 'home', 'en', 'Override', 1, 'published', NULL),
          (3, 'video', 'v-ar', 'home', 'ar', NULL, 0, 'published', NULL),
          (4, 'video', 'v-draft', 'home', 'all', '${DRAFT}', 0, 'draft', NULL),
          (5, 'channel', 'c1', 'videos', 'all', NULL, 0, 'published', NULL)`,
      ),
      db.prepare(
         `INSERT INTO media (path, mime_type, size, reference, entity_id, scope, metadata) VALUES
          ('cover1.png', 'image/png', 4, 'posts.cover', '1', 'cover', '{"width":10,"height":5,"alt":"Alt"}'),
          ('draftcover.png', 'image/png', 4, 'posts.cover', '5', 'cover', '{}')`,
      ),
   ]);
   await env.MEDIA.put("cover1.png", new Uint8Array([1, 2, 3, 4]));
});

const api = (path: string, init?: RequestInit) => makeWorker()(`/api/public/v1${path}`, init);

const ENDPOINTS = [
   "/site?locale=en",
   "/site?locale=ar",
   "/home?locale=en",
   "/home?locale=ar",
   "/pages/about?locale=en",
   "/pages/hawl?locale=ar",
   "/posts?locale=en",
   "/posts?locale=en&limit=20",
   "/posts?locale=ar",
   "/posts/p1?locale=en",
   "/posts/p1-ar?locale=ar",
   "/videos?locale=en",
   "/videos?locale=en&placement=home",
   "/videos?locale=ar&placement=home",
   "/sitemap",
];

describe("public API: published only", () => {
   it.each(ENDPOINTS)("%s never serializes a draft", async (path) => {
      const res = await api(path);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).not.toContain(DRAFT);
      expect(text).not.toContain("draftcover");
      expect(text).not.toContain('"secret"');
      expect(text).not.toContain('"sirr"');
   });

   it.each(["/pages/secret?locale=en", "/posts/draft?locale=en", "/pages/sirr?locale=ar"])("%s (a draft) is 404", async (path) => {
      const res = await api(path);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
   });
});

describe("public API: shapes (docs/PUBLIC_API.md)", () => {
   it("/site", async () => {
      const body = await (await api("/site?locale=en")).json();
      expect(body).toEqual({
         settings: { locale: "en", site_title: "Al Ummah Now", tagline: "Tag", hero_title: "Hero", hero_body: "Body", social: [{ kind: "x", url: "https://x.com/a" }] },
         nav: { header: [{ label: "Videos", url: "/videos" }, { label: "About", url: "/about" }], footer: [{ label: "Contact", url: "https://example.com" }] },
      });
   });
   it("an empty locale returns settings null and empty arrays", async () => {
      const body = await (await api("/site?locale=ar")).json();
      expect(body).toEqual({ settings: null, nav: { header: [], footer: [] } });
   });
   it("/home: home placement, locale or all, by sort; latest 3 posts", async () => {
      const body = (await (await api("/home?locale=en")).json()) as { videos: { ref_id: string; title_override: string | null; snapshot: unknown }[]; posts: { slug: string }[] };
      expect(body.videos.map((v) => v.ref_id)).toEqual(["p1", "v1"]);
      expect(body.videos[0]).toEqual({ id: 2, kind: "playlist", ref_id: "p1", title_override: "Override", snapshot: null, sort: 1 });
      expect(body.videos[1].snapshot).toEqual({ title: "V1", thumbnail_url: "https://cdn/t.jpg", channel_name: "C" });
      expect(body.posts.map((p) => p.slug)).toEqual(["p4", "p3", "p2"]);
   });
   it("/pages/:slug with published alternates only", async () => {
      const body = await (await api("/pages/about?locale=en")).json();
      expect(body).toEqual({
         slug: "about",
         locale: "en",
         title: "About",
         summary: "S",
         body: "# About",
         seo_title: null,
         seo_description: null,
         cover: null,
         published_at: "2026-11-08T10:00:00.000Z",
         updated_at: "2026-11-08T10:00:00.000Z",
         alternates: [{ locale: "ar", slug: "hawl" }],
         images: [],
         // Additive (page blocks): a row saved before blocks serves its body as one rich-text block.
         blocks: [{ id: "body", type: "markdown", text: "# About" }],
         // Additive (docs/specs/WWW-PAGES.md): a content page; list pages are served by /lists/:slug.
         list_kind: null,
      });
   });
   it("/posts paginates newest first", async () => {
      const body = (await (await api("/posts?locale=en&page=2&limit=3")).json()) as { items: { slug: string }[]; page: number; limit: number; total: number };
      expect(body).toMatchObject({ page: 2, limit: 3, total: 4 });
      expect(body.items.map((p) => p.slug)).toEqual(["p1"]);
   });
   it("/posts/:slug with cover, tags and alternates", async () => {
      const body = (await (await api("/posts/p1?locale=en")).json()) as Record<string, unknown>;
      expect(body).toMatchObject({
         slug: "p1",
         title: "Post 1",
         excerpt: "E1",
         body: "B1",
         tags: ["news"],
         author_name: "A",
         cover: { url: "https://cms.test/api/public/v1/media/cover1.png", alt: "Alt", width: 10, height: 5 },
         alternates: [{ locale: "ar", slug: "p1-ar" }],
      });
   });
   it("/videos defaults to the videos placement", async () => {
      const body = (await (await api("/videos?locale=en")).json()) as { items: { ref_id: string }[] };
      expect(body.items.map((v) => v.ref_id)).toEqual(["c1"]);
   });
   it("/sitemap lists published pages (show_in_sitemap) and posts", async () => {
      const body = (await (await api("/sitemap")).json()) as { items: { type: string; locale: string; slug: string }[] };
      const keys = body.items.map((i) => `${i.type}:${i.locale}:${i.slug}`);
      expect(keys).toContain("page:en:about");
      expect(keys).toContain("page:ar:hawl");
      expect(keys).not.toContain("page:en:hidden");
      expect(keys).toContain("post:en:p1");
      expect(keys).not.toContain("post:en:draft");
   });
});

describe("public API: HTTP", () => {
   it("400 for a missing/unknown locale and bad paging", async () => {
      for (const p of ["/site", "/site?locale=fr", "/home?locale=EN", "/posts?locale=en&limit=21", "/posts?locale=en&page=0", "/videos?locale=en&placement=x"]) {
         const res = await api(p);
         expect(res.status, p).toBe(400);
         expect(((await res.json()) as { error: string }).error).toBe("bad_request");
      }
   });
   it("404 JSON for unknown paths and slugs", async () => {
      expect((await api("/nope")).status).toBe(404);
      expect(await (await api("/pages/missing?locale=en")).json()).toEqual({ error: "not_found" });
   });
   it("cache headers, ETag and 304", async () => {
      const res = await api("/site?locale=en");
      expect(res.headers.get("cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=600");
      const etag = res.headers.get("etag")!;
      expect(etag).toMatch(/^W\/"/);
      const again = await api("/site?locale=en", { headers: { "if-none-match": etag } });
      expect(again.status).toBe(304);
   });
   it("CORS only for the env's www origins", async () => {
      const ok = await api("/site?locale=en", { headers: { origin: "https://www.test" } });
      expect(ok.headers.get("access-control-allow-origin")).toBe("https://www.test");
      const evil = await api("/site?locale=en", { headers: { origin: "https://evil.example" } });
      expect(evil.headers.get("access-control-allow-origin")).toBeNull();
      const local = await api("/site?locale=en", { headers: { origin: "http://localhost:4321" } });
      expect(local.headers.get("access-control-allow-origin")).toBeNull(); // only when ENVIRONMENT=local
      const pre = await api("/site", { method: "OPTIONS", headers: { origin: "https://www.test" } });
      expect(pre.status).toBe(204);
      expect(pre.headers.get("access-control-allow-methods")).toContain("GET");
   });
   it("media: known files from R2 with immutable caching; unknown keys 404", async () => {
      const res = await api("/media/cover1.png");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
      expect((await api("/media/not-in-media-table.png")).status).toBe(404);
      expect((await api("/media/..%2Fsecret")).status).toBe(404);
   });
   it("works without a session or secrets (no bknd boot)", async () => {
      const res = await api("/home?locale=en");
      expect(res.headers.get("set-cookie")).toBeNull();
   });
});
