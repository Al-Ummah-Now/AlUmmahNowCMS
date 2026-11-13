/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON responses in assertions */
/** Page blocks and card posts through the staff API, the picker snapshot endpoint and the public API. */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { backoffMs, deadSnapshots, MAX_ATTEMPTS, retryDead, runSnapshotQueue } from "../../src/lib/video-snapshots.ts";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

const ORIGIN = "https://cms.test";
import { PNG_16X9 as PNG } from "../fixtures/png-16x9.ts";
import { SUMMARY_SLIDES_MAX } from "../../src/routes/public-api.ts";
let videosUp = true;
const videosApi = (url: URL) => {
   if (!videosUp) return new Response("down", { status: 503 });
   if (url.pathname === "/api/videos/vid-1") return Response.json({ id: "vid-1", title: "Talk one", thumbnailUrl: "https://cdn.test/1.jpg", channelName: "Channel", isPublic: true, uploadStatus: "ready" });
   if (url.pathname === "/api/playlists/pl-1") return Response.json({ id: "pl-1", title: "Series", thumbnailUrl: null, channelName: "Channel", isPublic: true });
   if (url.pathname === "/api/videos/gone") return new Response("nf", { status: 404 });
   return new Response("nf", { status: 404 });
};

async function session(roles = ["Admin"]) {
   const { callback } = await signIn(roles, { id: `b-${roles[0]}`, email: `${roles[0].toLowerCase()}@example.com` });
   const cookie = cookiesOf(callback);
   const f = makeWorker((url) => videosApi(url));
   const send = async (method: string, path: string, body?: unknown, expectOk = true) => {
      const res = await f(path, {
         method,
         headers: { cookie, origin: ORIGIN, ...(body instanceof FormData ? {} : { "content-type": "application/json" }) },
         body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
      });
      if (expectOk) expect(res.status, `${method} ${path}: ${await res.clone().text()}`).toBeLessThan(300);
      return res;
   };
   const upload = async (name: string) => {
      const fd = new FormData();
      fd.append("file", new File([PNG], name, { type: "image/png" }));
      const { name: path } = (await (await send("POST", "/api/media/upload", fd)).json()) as { name: string };
      const row = await env.DB.prepare("SELECT id FROM media WHERE path = ?1").bind(path).first<{ id: number }>();
      return row!.id;
   };
   return { f, send, upload };
}
const json = async (res: Response) => (await res.json()) as Record<string, any>;

beforeEach(async () => {
   videosUp = true;
   // D1 persists across the tests in this file: start each from empty content tables.
   for (const t of ["pages", "posts", "video_snapshots", "media"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe("page blocks", () => {
   it("stores normalized blocks, derives the body, and serves resolved blocks additively", async () => {
      const { f, send, upload } = await session();
      const img = await upload("one.png");
      const img2 = await upload("two.png");
      await send("PATCH", `/admin/api/media/${img2}/alt`, { alt: "Library alt" });
      const post = await json(await send("POST", "/api/data/entity/posts", { slug: "picked", locale: "en", title: "Picked", body: "b", status: "published", translation_key: "kp", tags: ["seerah"] }));
      const postAr = await json(await send("POST", "/api/data/entity/posts", { slug: "picked", locale: "ar", title: "مختار", body: "b", status: "published", translation_key: "kp" }));
      await send("POST", "/api/data/entity/posts", { slug: "draft", locale: "en", title: "Draft", body: "b", status: "draft" });
      await send("POST", "/picker/api/snapshots", { kind: "video", ref_id: "vid-1" });
      await send("POST", "/picker/api/snapshots", { kind: "playlist", ref_id: "pl-1" });
      const blocks = [
         { id: "intro", type: "markdown", text: "Hello **world**" },
         { id: "img", type: "image", media_id: img, alt: "A lantern", caption: "Night", size: "wide" },
         { id: "empty-img", type: "image" },
         { id: "gal", type: "gallery", columns: 2, items: [{ media_id: img }, { media_id: img2, caption: "Two" }, { media_id: 99999 }] },
         { id: "latest", type: "posts", heading: "Latest", mode: "latest", limit: 5 },
         { id: "bytag", type: "posts", mode: "tag", tag: "seerah", limit: 5 },
         { id: "picked", type: "posts", mode: "picked", post_ids: [postAr.data.id] },
         { id: "shelf", type: "videos", heading: "Watch", items: [{ kind: "video", ref_id: "vid-1" }, { kind: "playlist", ref_id: "pl-1", title_override: "Our series" }] },
         { id: "embed", type: "video", kind: "video", ref_id: "vid-1", caption: "Talk" },
         { id: "cta", type: "cta", heading: "Join", label: "Sign up", url: "/join" },
         { id: "cta-empty", type: "cta", heading: "No link yet" },
         { id: "cols", type: "columns", text: "Side text", media_id: img, image_side: "start" },
         { id: "q", type: "quote", text: "Words", cite: "Someone" },
         { id: "d", type: "divider", style: "space", size: "l" },
         { id: "cards", type: "cards", heading: "Stories" },
      ];
      const page = await json(await send("POST", "/api/data/entity/pages", { slug: "built", locale: "en", title: "Built", status: "published", blocks }));
      const stored = await env.DB.prepare("SELECT body, blocks FROM pages WHERE id = ?1").bind(page.data.id).first<{ body: string; blocks: string }>();
      expect(stored!.body).toBe("Hello **world**\n\n## Latest\n\n## Watch\n\n::video[vid-1]\n\n**Join**\n\n[Sign up](/join)\n\nSide text\n\n> Words\n>\n> — Someone\n\n## Stories");
      expect(JSON.parse(stored!.blocks)[2]).toEqual({ id: "empty-img", type: "image", media_id: null, alt: "", caption: "", size: "content" });

      const res = await f("/api/public/v1/pages/built?locale=en");
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(typeof body.body).toBe("string");
      const b = Object.fromEntries((body.blocks as Record<string, any>[]).map((x) => [x.id, x]));
      expect(Object.keys(b)).toEqual(["intro", "img", "gal", "latest", "bytag", "picked", "shelf", "embed", "cta", "cols", "q", "d", "cards"]);
      expect(b.img).toMatchObject({ type: "image", caption: "Night", size: "wide", image: { alt: "A lantern", width: 16, height: 9 } });
      expect(b.img.image.url).toMatch(/^https:\/\/cms\.test\/api\/public\/v1\/media\//);
      expect(b.gal.items).toHaveLength(2);
      expect(b.gal.items[1]).toMatchObject({ caption: "Two", image: { alt: "Library alt" } });
      expect(b.latest.items.map((p: { slug: string }) => p.slug)).toEqual(["picked"]);
      expect(b.bytag.items.map((p: { slug: string }) => p.slug)).toEqual(["picked"]);
      // Picked on the Arabic side: the English page serves the English translation.
      expect(b.picked.items).toMatchObject([{ slug: "picked", locale: "en", title: "Picked", kind: "article", slide_count: 0, first_slide: null }]);
      expect(b.shelf.items).toMatchObject([
         { kind: "video", ref_id: "vid-1", title_override: null, snapshot: { title: "Talk one", thumbnail_url: "https://cdn.test/1.jpg" } },
         { kind: "playlist", ref_id: "pl-1", title_override: "Our series" },
      ]);
      expect(b.embed).toMatchObject({ kind: "video", ref_id: "vid-1", caption: "Talk", snapshot: { title: "Talk one" } });
      expect(b.cols).toMatchObject({ image_side: "start", image: { width: 16 } });
      expect(b.cards).toEqual({ id: "cards", type: "cards", heading: "Stories", tag: null, page_size: 12, filter: true });
      expect(post.data.id).toBeGreaterThan(0);
   });

   it("rejects invalid blocks with a 400 and keeps the stored row", async () => {
      const { send } = await session();
      const page = await json(await send("POST", "/api/data/entity/pages", { slug: "ok", locale: "en", title: "Ok", blocks: [{ id: "a", type: "markdown", text: "x" }] }));
      for (const bad of [[{ id: "a", type: "cta", label: "Go", url: "javascript:x" }], [{ id: "a", type: "nope" }], "{"]) {
         const res = await send("PATCH", `/api/data/entity/pages/${page.data.id}`, { blocks: bad }, false);
         expect(res.status).toBe(400);
      }
      const row = await env.DB.prepare("SELECT blocks, body FROM pages WHERE id = ?1").bind(page.data.id).first<{ blocks: string; body: string }>();
      expect(JSON.parse(row!.blocks)).toEqual([{ id: "a", type: "markdown", text: "x" }]);
      expect(row!.body).toBe("x");
   });

   it("serves a page saved before blocks existed as one rich-text block", async () => {
      const { f } = await session();
      await env.DB.prepare("INSERT INTO pages (slug, locale, title, body, status) VALUES ('legacy', 'en', 'Legacy', '# Old\n\nBody', 'published')").run();
      const body = await json(await f("/api/public/v1/pages/legacy?locale=en"));
      expect(body.body).toBe("# Old\n\nBody");
      expect(body.blocks).toEqual([{ id: "body", type: "markdown", text: "# Old\n\nBody" }]);
   });

   it("leaves out videos the refresh found not public", async () => {
      const { f, send } = await session();
      await send("POST", "/picker/api/snapshots", { kind: "video", ref_id: "vid-1" });
      await send("POST", "/api/data/entity/pages", { slug: "vids", locale: "en", title: "V", status: "published", blocks: [{ id: "e", type: "video", ref_id: "vid-1" }] });
      await env.DB.prepare("UPDATE video_snapshots SET snapshot = json_set(snapshot, '$.public', json('false'))").run();
      expect((await json(await f("/api/public/v1/pages/vids?locale=en"))).blocks).toEqual([]);
   });

   it("the snapshot endpoint is gated, validates and refuses non-public items", async () => {
      const anon = makeWorker(videosApi);
      expect((await anon("/picker/api/snapshots", { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" })).status).toBe(401);
      const { send } = await session(["Moderator"]);
      expect((await send("POST", "/picker/api/snapshots", { kind: "nope", ref_id: "x" }, false)).status).toBe(400);
      expect((await send("POST", "/picker/api/snapshots", { kind: "video", ref_id: "gone" }, false)).status).toBe(404);
      videosUp = false;
      expect((await send("POST", "/picker/api/snapshots", { kind: "video", ref_id: "vid-1" }, false)).status).toBe(502);
      videosUp = true;
      const ok = await json(await send("POST", "/picker/api/snapshots", { kind: "video", ref_id: "vid-1" }));
      await send("POST", "/picker/api/snapshots", { kind: "video", ref_id: "vid-1" });
      expect(ok.data).toMatchObject({ kind: "video", ref_id: "vid-1", snapshot: { title: "Talk one", public: true } });
      expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM video_snapshots").first()).toEqual({ n: 1 });
   });
});

describe("block video snapshot queue", () => {
   const fetchVideos = (async (input: RequestInfo | URL) => videosApi(new URL(String(input)))) as typeof fetch;

   async function seed() {
      const { send } = await session();
      await send("POST", "/picker/api/snapshots", { kind: "video", ref_id: "vid-1" });
      await send("POST", "/api/data/entity/pages", { slug: "q", locale: "en", title: "Q", blocks: [{ id: "e", type: "video", ref_id: "vid-1" }] });
      return send;
   }

   it("refreshes due rows a page uses and skips rows nobody uses", async () => {
      await seed();
      await env.DB.prepare("INSERT INTO video_snapshots (kind, ref_id, snapshot, created_at, updated_at) VALUES ('video', 'unused', '{}', 'x', 'x')").run();
      const later = new Date(Date.now() + 3 * 3600_000);
      expect(await runSnapshotQueue(env.DB, { apiUrl: "https://videos.api.test", webUrl: "https://videos.test" }, fetchVideos, { now: later })).toMatchObject({ due: 1, refreshed: 1 });
      expect(await runSnapshotQueue(env.DB, { apiUrl: "https://videos.api.test", webUrl: "https://videos.test" }, fetchVideos, { now: later })).toMatchObject({ due: 0 });
   });

   it("backs off on failure, dead-letters after MAX_ATTEMPTS, flags it and requeues on Retry", async () => {
      const send = await seed();
      videosUp = false;
      let now = Date.now() + 3 * 3600_000;
      for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
         expect(await runSnapshotQueue(env.DB, { apiUrl: "https://videos.api.test", webUrl: "https://videos.test" }, fetchVideos, { now: new Date(now) })).toMatchObject({ due: 1, retrying: 1 });
         const row = await env.DB.prepare("SELECT attempts, next_attempt_at, last_error FROM video_snapshots").first<{ attempts: number; next_attempt_at: string; last_error: string }>();
         expect(row!.attempts).toBe(attempt);
         expect(Date.parse(row!.next_attempt_at) - now).toBe(backoffMs(attempt));
         // not due again before the backoff ends
         expect((await runSnapshotQueue(env.DB, { apiUrl: "https://videos.api.test", webUrl: "https://videos.test" }, fetchVideos, { now: new Date(now + 1000) })).due).toBe(0);
         now += backoffMs(attempt);
      }
      expect(await runSnapshotQueue(env.DB, { apiUrl: "https://videos.api.test", webUrl: "https://videos.test" }, fetchVideos, { now: new Date(now) })).toMatchObject({ dead: 1 });
      expect(await deadSnapshots(env.DB)).toMatchObject({ total: 1, items: [{ ref_id: "vid-1", title: "Talk one" }] });
      // The last good snapshot is still served while dead.
      const page = await env.DB.prepare("SELECT snapshot FROM video_snapshots").first<{ snapshot: string }>();
      expect(JSON.parse(page!.snapshot).title).toBe("Talk one");

      // Overview flags it to staff, with the item's title and a Retry button.
      const { f } = await session();
      const { callback } = await signIn(["Admin"], { id: "b-flag", email: "flag@example.com" });
      const overview = await (await f("/", { headers: { cookie: cookiesOf(callback) } })).text();
      expect(overview).toContain("data-video-flag");
      expect(overview).toContain("1 video in page blocks couldn&#39;t be refreshed");
      expect(overview).toContain("Talk one");
      expect(overview).toContain("data-retry-videos");
      // Someone without a staff role can't requeue.
      const viewer = await session(["Viewer"]);
      expect((await viewer.send("POST", "/admin/api/video-snapshots/retry", undefined, false)).status).toBeGreaterThanOrEqual(400);
      expect((await deadSnapshots(env.DB)).total).toBe(1);
      // Retry requeues (as a staff action, idempotent).
      const res = await send("POST", "/admin/api/video-snapshots/retry");
      expect((await json(res)).data.requeued).toBe(1);
      expect((await json(await send("POST", "/admin/api/video-snapshots/retry"))).data.requeued).toBe(0);
      videosUp = true;
      expect(await runSnapshotQueue(env.DB, { apiUrl: "https://videos.api.test", webUrl: "https://videos.test" }, fetchVideos, { now: new Date(now) })).toMatchObject({ refreshed: 1 });
      expect((await deadSnapshots(env.DB)).total).toBe(0);
      expect(await retryDead(env.DB)).toBe(0);
   });
});

describe("block and slide editors (server render)", () => {
   it("pages render the block editor with its templates; posts the kind toggle and slides panel", async () => {
      const { f, send, upload } = await session();
      const { callback } = await signIn(["Admin"], { id: "b-render", email: "render@example.com" });
      const cookie = cookiesOf(callback);
      const img = await upload("r.png");
      const page = (await json(await send("POST", "/api/data/entity/pages", { slug: "render", locale: "ar", title: "ص", blocks: [{ id: "a", type: "image", media_id: img, alt: "بديل", caption: "", size: "wide" }] }))).data;
      const html = await (await f(`/pages/${page.id}`, { headers: { cookie } })).text();
      expect(html).toContain("data-blocks-editor");
      expect(html).toContain('data-locale="ar"');
      expect(html).not.toContain('id="f-body"');
      for (const type of ["markdown", "image", "gallery", "posts", "cards", "videos", "video", "cta", "columns", "quote", "divider"]) {
         expect(html, type).toContain(`data-seq-template="block:${type}"`);
         expect(html, type).toContain(`data-add-block="${type}"`);
      }
      // The stored block is rendered with its library image and alt; dialogs are on the page.
      expect(html).toMatch(/<img[^>]*src="[^"]*\/api\/public\/v1\/media\/[^"]+"[^>]*width="16"[^>]*height="9"/);
      expect(html).toContain('value="بديل"');
      for (const id of ["media-dlg", "posts-dlg"]) expect(html).toContain(`id="${id}"`);

      const article = await (await f("/posts/new?locale=en", { headers: { cookie } })).text();
      expect(article).toMatch(/<input[^>]*value="article"[^>]*checked[^>]*data-post-kind|<input[^>]*checked[^>]*value="article"/);
      expect(article).toMatch(/<section[^>]*data-slides-editor[^>]*data-kind-panel="cards"[^>]*hidden/);
      expect(article).toContain('id="f-body"');
      expect(article).toContain('data-seq-template="slide"');

      const cards = (await json(await send("POST", "/api/data/entity/posts", { slug: "render-cards", locale: "en", title: "C", kind: "cards", slides: [{ id: "s1", media_id: img, alt: "", heading: "Hello", body: "", position: "top" }] }))).data;
      const ch = await (await f(`/posts/${cards.id}`, { headers: { cookie } })).text();
      expect(ch).toMatch(/<section[^>]*data-slides-editor[^>]*data-kind-panel="cards"(?![^>]*hidden)[^>]*>/);
      expect(ch).toMatch(/data-kind-panel="article"[^>]*hidden/);
      expect(ch).toContain("ov-top");
      expect(ch).toContain("1 slide");
   });
});

describe("revisions (#8) keep blocks and slides", () => {
   it("restoring an earlier version brings its blocks back, and its slides and kind for a card post", async () => {
      const { f, send, upload } = await session();
      await env.DB.prepare("DELETE FROM content_revisions").run();
      const img = await upload("rv.png");
      const v1 = [{ id: "a", type: "markdown", text: "First" }];
      const page = (await json(await send("POST", "/api/data/entity/pages", { slug: "rv", locale: "en", title: "R", blocks: v1 }))).data;
      const edited = (await json(await send("PATCH", `/api/data/entity/pages/${page.id}`, { blocks: [{ id: "b", type: "quote", variant: "quote", text: "Second", cite: "" }], updated_at: page.updated_at }))).data;
      const rev = await env.DB.prepare("SELECT id, changed FROM content_revisions WHERE entity = 'pages' AND entity_id = ?1 ORDER BY version").bind(page.id).all<{ id: number; changed: string }>();
      expect(rev.results).toHaveLength(2);
      expect(JSON.parse(rev.results[1].changed)).toEqual(expect.arrayContaining(["blocks", "body"]));
      // The history screen shows the change readably, not as raw JSON.
      const { callback } = await signIn(["Admin"], { id: "b-rv", email: "rv@example.com" });
      const hist = await (await f(`/pages/${page.id}/history?rev=${rev.results[1].id}`, { headers: { cookie: cookiesOf(callback) } })).text();
      expect(hist).toContain("Quote or callout: Second");
      expect(hist).toContain("Text: First");
      expect(hist).not.toContain("[object Object]");
      await send("POST", `/admin/api/revisions/${rev.results[0].id}/restore`, { updated_at: edited.updated_at });
      const row = await env.DB.prepare("SELECT blocks, body FROM pages WHERE id = ?1").bind(page.id).first<{ blocks: string; body: string }>();
      expect(JSON.parse(row!.blocks)).toEqual(v1);
      expect(row!.body).toBe("First");

      const post = (await json(await send("POST", "/api/data/entity/posts", { slug: "rvc", locale: "en", title: "C", kind: "cards", slides: [{ id: "s1", media_id: img, alt: "", heading: "One", body: "", position: "top" }] }))).data;
      const changed = (await json(await send("PATCH", `/api/data/entity/posts/${post.id}`, { kind: "article", body: "Now text", updated_at: post.updated_at }))).data;
      const prev = await env.DB.prepare("SELECT id FROM content_revisions WHERE entity = 'posts' AND entity_id = ?1 ORDER BY version LIMIT 1").bind(post.id).first<{ id: number }>();
      await send("POST", `/admin/api/revisions/${prev!.id}/restore`, { updated_at: changed.updated_at });
      const back = await env.DB.prepare("SELECT kind, slides FROM posts WHERE id = ?1").bind(post.id).first<{ kind: string; slides: string }>();
      expect(back!.kind).toBe("cards");
      expect(JSON.parse(back!.slides)[0]).toMatchObject({ heading: "One", media_id: img });
   });
});

describe("card posts", () => {
   it("stores slides, derives the body, serves slides, summaries and the /cards grid", async () => {
      const { f, send, upload } = await session();
      const a = await upload("s1.png");
      const b = await upload("s2.png");
      const slides = [
         { id: "s1", media_id: a, alt: "First image", heading: "Day one", body: "It began", position: "top" },
         { id: "s2", media_id: null, heading: "No image yet" },
         { id: "s3", media_id: b, heading: "Day two", position: "middle" },
      ];
      const created = await json(await send("POST", "/api/data/entity/posts", { slug: "story", locale: "en", title: "Story", kind: "cards", slides, status: "published", tags: ["seerah", "kids"] }));
      await send("POST", "/api/data/entity/posts", { slug: "story-2", locale: "en", title: "Story 2", kind: "cards", slides: [{ id: "x", media_id: b }], status: "published", tags: ["kids"] });
      await send("POST", "/api/data/entity/posts", { slug: "story-draft", locale: "en", title: "Hidden", kind: "cards", slides: [{ id: "x", media_id: b }], status: "draft", tags: ["secret"] });
      await send("POST", "/api/data/entity/posts", { slug: "article", locale: "en", title: "Article", body: "Text", status: "published" });
      const row = await env.DB.prepare("SELECT body, kind FROM posts WHERE id = ?1").bind(created.data.id).first();
      expect(row).toEqual({ body: "## Day one\n\nIt began\n\n## Day two", kind: "cards" });
      expect((await send("POST", "/api/data/entity/posts", { slug: "bad", locale: "en", title: "Bad", kind: "reel" }, false)).status).toBe(400);
      expect((await send("POST", "/api/data/entity/posts", { slug: "bad", locale: "en", title: "Bad", kind: "cards", slides: [{ id: "s", position: "left" }] }, false)).status).toBe(400);

      const post = await json(await f("/api/public/v1/posts/story?locale=en"));
      expect(post).toMatchObject({ kind: "cards", slide_count: 2, first_slide: { id: "s1", heading: "Day one", body: "It began", position: "top", image: { alt: "First image", width: 16, height: 9 } } });
      expect(post.slides.map((s: { id: string }) => s.id)).toEqual(["s1", "s3"]);
      expect(post.slides[1]).toMatchObject({ heading: "Day two", body: null, position: "middle", image: { alt: null } });

      const article = await json(await f("/api/public/v1/posts/article?locale=en"));
      expect(article).toMatchObject({ kind: "article", slide_count: 0, first_slide: null, slides: [] });

      const grid = await json(await f("/api/public/v1/cards?locale=en&limit=1"));
      expect(grid).toMatchObject({ page: 1, limit: 1, total: 2, tags: ["kids", "seerah"] });
      expect(grid.items.map((p: { slug: string }) => p.slug)).toEqual(["story-2"]);
      const page2 = await json(await f("/api/public/v1/cards?locale=en&limit=1&page=2"));
      expect(page2.items.map((p: { slug: string }) => p.slug)).toEqual(["story"]);
      const tagged = await json(await f("/api/public/v1/cards?locale=en&tag=seerah"));
      expect(tagged).toMatchObject({ total: 1, items: [{ slug: "story", slide_count: 2 }] });
      expect((await f("/api/public/v1/cards?locale=fr")).status).toBe(400);
      expect((await f("/api/public/v1/cards?locale=en&limit=99")).status).toBe(400);
      expect((await json(await f("/api/public/v1/cards?locale=ar"))).items).toEqual([]);
      // The news list keeps every post, now with kind.
      const news = await json(await f("/api/public/v1/posts?locale=en"));
      expect(news.items.map((p: { kind: string }) => p.kind).sort()).toEqual(["article", "cards", "cards"]);
      // Summaries carry the served slides too, so www shows a card post whole inside a list.
      const listed = news.items.find((p: { slug: string }) => p.slug === "story");
      expect(listed.slides.map((s: { id: string }) => s.id)).toEqual(["s1", "s3"]);
      expect(listed.slides[0]).toEqual(post.slides[0]);
      expect(news.items.find((p: { slug: string }) => p.slug === "article")).toMatchObject({ slides: [] });
      expect(grid.items[0].slides.map((s: { id: string }) => s.id)).toEqual(["x"]);
      const home = await json(await f("/api/public/v1/home?locale=en"));
      expect(home.posts.find((p: { slug: string }) => p.slug === "story").slides).toHaveLength(2);
   });

   it("caps a summary's slides at SUMMARY_SLIDES_MAX; the post itself serves them all", async () => {
      const { f, send, upload } = await session();
      const img = await upload("long.png");
      const slides = Array.from({ length: SUMMARY_SLIDES_MAX + 3 }, (_, i) => ({ id: `l${i + 1}`, media_id: img, heading: `Card ${i + 1}` }));
      await send("POST", "/api/data/entity/posts", { slug: "long", locale: "en", title: "Long", kind: "cards", slides, status: "published" });
      const full = await json(await f("/api/public/v1/posts/long?locale=en"));
      expect(full.slides).toHaveLength(SUMMARY_SLIDES_MAX + 3);
      expect(full.slide_count).toBe(SUMMARY_SLIDES_MAX + 3);
      const list = await json(await f("/api/public/v1/posts?locale=en"));
      const item = list.items.find((p: { slug: string }) => p.slug === "long");
      expect(item.slide_count).toBe(SUMMARY_SLIDES_MAX + 3);
      expect(item.slides.map((s: { id: string }) => s.id)).toEqual(slides.slice(0, SUMMARY_SLIDES_MAX).map((s) => s.id));
      const cards = await json(await f("/api/public/v1/cards?locale=en"));
      expect(cards.items.find((p: { slug: string }) => p.slug === "long").slides).toHaveLength(SUMMARY_SLIDES_MAX);
   });
});
