/** Draft preview (src/routes/preview.ts): minting needs a staff session; the API needs a token for that one row. */
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { mintPreviewToken } from "../../src/lib/preview.ts";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

const SECRET = "test-secret-0123456789abcdef0123456789abcdef";
const DRAFT = "PREVIEW-ONLY-DRAFT";
const now = "2026-11-08T10:00:00.000Z";

beforeAll(async () => {
   const db = env.DB;
   await db.batch([
      db.prepare("DELETE FROM pages WHERE id IN (901, 902, 903, 904)"),
      db.prepare("DELETE FROM posts WHERE id IN (901, 902)"),
      db.prepare(
         `INSERT INTO pages (id, slug, locale, translation_key, title, summary, body, status, published_at, show_in_sitemap, created_at, updated_at) VALUES
          (901, 'pv-draft', 'en', 'pv', '${DRAFT}', 'Sum', '# Draft body', 'draft', NULL, 1, '${now}', '${now}'),
          (902, 'pv-ar', 'ar', 'pv', 'مسودة', NULL, 'نص', 'published', '${now}', 1, '${now}', '${now}')`,
      ),
      db.prepare(
         `INSERT INTO pages (id, slug, locale, title, body, status, publish_at, published_at, show_in_sitemap, created_at, updated_at) VALUES
          (904, 'pv-later', 'en', 'Later', 'Soon', 'published', '2999-01-01T00:00:00.000Z', '2999-01-01T00:00:00.000Z', 1, '${now}', '${now}')`,
      ),
      db.prepare(
         `INSERT INTO posts (id, slug, locale, translation_key, title, excerpt, body, status, published_at, tags, author_name, created_at, updated_at) VALUES
          (901, 'pv-post', 'ar', NULL, 'خبر ${DRAFT}', NULL, 'متن', 'draft', NULL, '["أخبار"]', 'كاتب', '${now}', '${now}'),
          (902, 'pv-live', 'en', NULL, 'Live', NULL, 'B', 'published', '${now}', '[]', NULL, '${now}', '${now}')`,
      ),
   ]);
});

const tokenFor = async (kind: "pages" | "posts", id: number, at?: number) => (await mintPreviewToken(SECRET, kind, id, at)).token;
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

describe("minting (GET /preview/:kind/:id)", () => {
   it("sends a signed-out browser to sign in, and back here afterwards", async () => {
      const res = await makeWorker()("/preview/pages/901");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/sso/login?return=%2Fpreview%2Fpages%2F901");
   });

   it("an editor gets a 303 to www/preview with a token for that row only", async () => {
      const { callback } = await signIn(["Moderator"], { id: "pv-ed", email: "pv-ed@example.com" });
      const f = makeWorker();
      const res = await f("/preview/pages/901", { headers: { cookie: cookiesOf(callback) } });
      expect(res.status).toBe(303);
      const to = new URL(res.headers.get("location")!);
      expect(to.origin + to.pathname).toBe("https://www.test/preview");
      expect([...to.searchParams.keys()]).toEqual(["token"]);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      const token = to.searchParams.get("token")!;
      expect((await f("/api/preview/v1/pages/901", auth(token))).status).toBe(200);
      expect((await f("/api/preview/v1/pages/902", auth(token))).status).toBe(401);
   });

   it("the editor offers Preview on site for a saved draft, View on site for a published row", async () => {
      const { callback } = await signIn(["Moderator"], { id: "pv-ed2", email: "pv-ed2@example.com" });
      const f = makeWorker();
      const cookie = cookiesOf(callback);
      const draft = await (await f("/pages/901", { headers: { cookie } })).text();
      expect(draft).toContain('href="/preview/pages/901"');
      expect(draft).toContain("Preview on site");
      const published = await (await f("/pages/902", { headers: { cookie } })).text();
      expect(published).not.toContain("/preview/pages/902");
      expect(published).toContain("View on site");
      // www serves posts under /news/ (not /posts/).
      const post = await (await f("/posts/902", { headers: { cookie } })).text();
      expect(post).toContain('href="https://www.test/en/news/pv-live"');
      const fresh = await (await f("/pages/new", { headers: { cookie } })).text();
      expect(fresh).not.toContain("data-preview");
   });

   it("a missing row or kind is the friendly not-found page", async () => {
      const { callback } = await signIn(["Admin"], { id: "pv-ad", email: "pv-ad@example.com" });
      const f = makeWorker();
      const cookie = cookiesOf(callback);
      for (const path of ["/preview/pages/999999", "/preview/media/1", "/preview/pages/abc"]) {
         const res = await f(path, { headers: { cookie } });
         expect(res.status, path).toBe(404);
         expect(res.headers.get("content-type")).toContain("text/html");
      }
   });

   it("someone without a CMS role never gets a session, so never a token", async () => {
      const { callback } = await signIn(["User"], { id: "pv-viewer", email: "pv-viewer@example.com" });
      const res = await makeWorker()("/preview/pages/901", { headers: { cookie: cookiesOf(callback) } });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toMatch(/^\/sso\/login/);
   });
});

describe("preview API (GET /api/preview/v1/:kind/:id)", () => {
   it("serves the draft in the public Page shape, never cached, no CORS", async () => {
      const res = await makeWorker()("/api/preview/v1/pages/901", { headers: { Authorization: `Bearer ${await tokenFor("pages", 901)}`, Origin: "https://www.test" } });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      const body = (await res.json()) as Record<string, unknown> & { content: Record<string, unknown> };
      expect(body).toMatchObject({ kind: "page", id: 901, status: "draft", edit_url: "https://cms.test/pages/901" });
      expect(Date.parse(String(body.expires_at))).toBeGreaterThan(Date.now());
      expect(body.content).toMatchObject({ slug: "pv-draft", locale: "en", title: DRAFT, summary: "Sum", body: "# Draft body", cover: null });
      // Alternates stay published-only (the Arabic translation is published).
      expect(body.content.alternates).toEqual([{ locale: "ar", slug: "pv-ar" }]);
      expect(Object.keys(body.content).sort()).toEqual(
         ["alternates", "body", "cover", "images", "locale", "published_at", "seo_description", "seo_title", "slug", "summary", "title", "updated_at"].sort(),
      );
   });

   it("a scheduled row previews as scheduled while the public API still hides it", async () => {
      const f = makeWorker();
      const res = await f("/api/preview/v1/pages/904", auth(await tokenFor("pages", 904)));
      expect(res.status).toBe(200);
      expect(((await res.json()) as { status: string }).status).toBe("scheduled");
      expect((await f("/api/public/v1/pages/pv-later?locale=en")).status).toBe(404);
   });

   it("serves an Arabic draft post in the public Post shape", async () => {
      const res = await makeWorker()("/api/preview/v1/posts/901", auth(await tokenFor("posts", 901)));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { kind: string; content: Record<string, unknown> };
      expect(body.kind).toBe("post");
      expect(body.content).toMatchObject({ slug: "pv-post", locale: "ar", tags: ["أخبار"], author_name: "كاتب", alternates: [] });
   });

   it("401 without a token, with junk, for another row or kind, or once expired", async () => {
      const f = makeWorker();
      const read = async (path: string, init?: RequestInit) => {
         const res = await f(path, init);
         return { status: res.status, error: ((await res.json()) as { error: string }).error, cache: res.headers.get("cache-control") };
      };
      expect(await read("/api/preview/v1/pages/901")).toEqual({ status: 401, error: "invalid_token", cache: "private, no-store" });
      expect((await read("/api/preview/v1/pages/901", auth("v1.junk.junk"))).status).toBe(401);
      expect((await read("/api/preview/v1/pages/902", auth(await tokenFor("pages", 901)))).error).toBe("invalid_token");
      expect((await read("/api/preview/v1/posts/901", auth(await tokenFor("pages", 901)))).error).toBe("invalid_token");
      const old = await tokenFor("pages", 901, Math.floor(Date.now() / 1000) - 31 * 60);
      expect(await read("/api/preview/v1/pages/901", auth(old))).toEqual({ status: 401, error: "expired_token", cache: "private, no-store" });
      // A token from another environment (another secret) is just invalid.
      const foreign = (await mintPreviewToken("other-env-secret-0123456789abcdef01234567", "pages", 901)).token;
      expect((await read("/api/preview/v1/pages/901", auth(foreign))).error).toBe("invalid_token");
   });

   it("404 when the row was deleted after the link was made", async () => {
      const token = await tokenFor("pages", 903);
      const res = await makeWorker()("/api/preview/v1/pages/903", auth(token));
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
   });

   it("the public API still never serves the draft, token or not", async () => {
      const f = makeWorker();
      const token = await tokenFor("pages", 901);
      const page = await f("/api/public/v1/pages/pv-draft?locale=en", auth(token));
      expect(page.status).toBe(404);
      const post = await f("/api/public/v1/posts/pv-post?locale=ar", auth(await tokenFor("posts", 901)));
      expect(post.status).toBe(404);
      const sitemap = await (await f("/api/public/v1/sitemap")).text();
      expect(sitemap).not.toContain("pv-draft");
      expect(sitemap).not.toContain("pv-post");
   });
});
