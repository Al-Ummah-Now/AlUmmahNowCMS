/**
 * Scheduled publishing (#7) through the real write path: content saved via bknd's data API (as
 * the staff screens do), read back through the public API. A scheduled row is invisible
 * everywhere www looks until its time, then appears with published_at = the scheduled time.
 */
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { CMS, cookiesOf, makeWorker, signIn } from "./helpers.ts";

let cookie = "";
let f: ReturnType<typeof makeWorker>;
const json = { "content-type": "application/json" };
const iso = (ms: number) => new Date(ms).toISOString();

async function send(method: string, path: string, body?: unknown) {
   const res = await f(path, { method, headers: { cookie, origin: CMS, ...json }, body: body === undefined ? undefined : JSON.stringify(body) });
   expect(res.status, `${method} ${path}: ${await res.clone().text()}`).toBeLessThan(300);
   return ((await res.json()) as { data: Record<string, unknown> & { id: number } }).data;
}
const pub = async (path: string) => {
   const res = await f(`/api/public/v1${path}`);
   return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const slugsOf = (items: unknown) => (items as { slug: string }[]).map((x) => x.slug);

describe("scheduled publishing in the public API", () => {
   beforeAll(async () => {
      const { callback } = await signIn(["Moderator"], { id: "sched-ed", email: "sched@example.com" });
      cookie = cookiesOf(callback);
      f = makeWorker();
   });

   it("a scheduled post and page are hidden from every endpoint until their time", async () => {
      const at = iso(Date.now() + 24 * 3600_000);
      const post = await send("POST", "/api/data/entity/posts", { slug: "sched-post", locale: "en", title: "Tomorrow", body: "x", status: "published", publish_at: at, translation_key: "k-sched" });
      expect(post.published_at).toBe(at);
      await send("POST", "/api/data/entity/posts", { slug: "sched-post-ar", locale: "ar", title: "غدا", body: "x", status: "published", translation_key: "k-sched" });
      await send("POST", "/api/data/entity/pages", { slug: "sched-page", locale: "en", title: "Soon", body: "x", status: "published", publish_at: at, show_in_sitemap: true });

      expect((await pub("/posts/sched-post?locale=en")).status).toBe(404);
      expect((await pub("/pages/sched-page?locale=en")).status).toBe(404);
      const list = await pub("/posts?locale=en&limit=20");
      expect(slugsOf(list.body.items)).not.toContain("sched-post");
      const all = await env.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE locale = 'en' AND status = 'published' AND (publish_at IS NULL OR publish_at <= ?1)").bind(iso(Date.now())).first<{ n: number }>();
      expect(list.body.total).toBe(all?.n);
      expect(slugsOf((await pub("/home?locale=en")).body.posts)).not.toContain("sched-post");
      const sitemap = slugsOf((await pub("/sitemap")).body.items);
      expect(sitemap).not.toContain("sched-post");
      expect(sitemap).not.toContain("sched-page");
      // The live Arabic translation must not link to the English one before it is out.
      expect((await pub("/posts/sched-post-ar?locale=ar")).body.alternates).toEqual([]);
   });

   it("once the time passes the row is served, published_at = the scheduled time", async () => {
      const post = await send("POST", "/api/data/entity/posts", { slug: "sched-soon", locale: "en", title: "Soon", body: "x", status: "published", publish_at: iso(Date.now() + 3600_000) });
      expect((await pub("/posts/sched-soon?locale=en")).status).toBe(404);
      // Time passes (the stored schedule moves into the past: no job runs, the read decides).
      const past = iso(Date.now() - 1000);
      await env.DB.prepare("UPDATE posts SET publish_at = ?1, published_at = ?1 WHERE id = ?2").bind(past, post.id).run();
      const live = await pub("/posts/sched-soon?locale=en");
      expect(live.status).toBe(200);
      expect(live.body.published_at).toBe(past);
      expect(slugsOf((await pub("/sitemap")).body.items)).toContain("sched-soon");
   });

   it("publish now and unschedule go through the same lock; the row follows", async () => {
      const at = iso(Date.now() + 3600_000);
      let post = await send("POST", "/api/data/entity/posts", { slug: "sched-now", locale: "en", title: "Now", body: "x", status: "published", publish_at: at });
      post = await send("PATCH", `/api/data/entity/posts/${post.id}`, { status: "published", publish_at: null, updated_at: post.updated_at });
      expect(post.publish_at).toBeNull();
      expect(Date.parse(String(post.published_at))).toBeLessThanOrEqual(Date.now());
      expect((await pub("/posts/sched-now?locale=en")).status).toBe(200);

      let page = await send("POST", "/api/data/entity/pages", { slug: "sched-off", locale: "en", title: "Off", body: "x", status: "published", publish_at: at });
      page = await send("PATCH", `/api/data/entity/pages/${page.id}`, { status: "draft", updated_at: page.updated_at });
      expect(page).toMatchObject({ status: "draft", publish_at: null, published_at: null });
      // A stale schedule change (someone else saved first) is refused.
      const stale = await f(`/api/data/entity/pages/${page.id}`, {
         method: "PATCH",
         headers: { cookie, origin: CMS, ...json },
         body: JSON.stringify({ status: "published", publish_at: at, updated_at: "2026-01-01T00:00:00.000Z" }),
      });
      expect(stale.status).toBe(409);
   });

   it("refuses a schedule that is not a date", async () => {
      const res = await f("/api/data/entity/posts", {
         method: "POST",
         headers: { cookie, origin: CMS, ...json },
         body: JSON.stringify({ slug: "sched-bad", locale: "en", title: "Bad", status: "published", publish_at: "soon" }),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
   });
});
