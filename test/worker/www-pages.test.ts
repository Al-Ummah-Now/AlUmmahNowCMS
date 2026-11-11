/**
 * www pages (docs/specs/WWW-PAGES.md): filter pages list everything published of their kinds (posts:
 * live main-site posts; videos: the CMS video library), curated pages list what editors added with
 * home's mechanics, channels are timeline items with their latest videos, and every removal is a
 * soft delete. No AI provider is involved anywhere here.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";
import { insertPost, resetFeed } from "./feed-helpers.ts";

const ORIGIN = "https://cms.test";
const AT = "2026-11-01T10:00:00.000Z";

async function session(roles: string[], id: string) {
   const { callback } = await signIn(roles, { id, email: `${id}@example.com` });
   return cookiesOf(callback);
}

const videosApi = (url: URL) => {
   const v = /^\/api\/videos\/([\w-]+)$/.exec(url.pathname);
   if (v) return Response.json({ id: v[1], title: `Talk ${v[1]}`, thumbnailUrl: `https://img.test/${v[1]}.jpg`, channelName: "Ch", isPublic: true, uploadStatus: "ready", dateCreated: "2026-09-01T10:00:00.000Z" });
   if (url.pathname === "/api/channels/ch1") return Response.json({ id: "ch1", name: "Lectures", avatarUrl: "https://img.test/ch1.jpg", handle: "lectures", isPublic: true });
   if (url.pathname === "/api/channels/ch1/videos")
      return Response.json({
         data: [1, 2, 3, 4].map((n) => ({ id: `cv${n}`, title: `Latest ${n}`, thumbnailUrl: `https://img.test/cv${n}.jpg`, isPublic: true, uploadStatus: "ready", duration: 60 })),
         cursor: "",
      });
   return new Response("nf", { status: 404 });
};

function client(cookie: string) {
   const f = makeWorker(videosApi);
   const call = (method: string, path: string, body?: unknown) =>
      f(path, { method, headers: { cookie, origin: ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
   return { f, call };
}

async function createPage(call: ReturnType<typeof client>["call"], body: Record<string, unknown>) {
   const res = await call("POST", "/api/data/entity/pages", { status: "published", ...body });
   expect(res.status, await res.clone().text()).toBe(201);
   return ((await res.json()) as { data: { id: number } }).data.id;
}

/** A library video with a stored snapshot (what the picker writes), added at `at`. */
async function libraryVideo(ref: string, at: string, opts: { kind?: string; locale?: string; public?: boolean } = {}) {
   const kind = opts.kind ?? "video";
   await env.DB.prepare("INSERT INTO video_snapshots (kind, ref_id, snapshot, attempts, created_at, updated_at) VALUES (?1, ?2, ?3, 0, ?4, ?4)")
      .bind(kind, ref, JSON.stringify({ title: `Title ${ref}`, thumbnail_url: null, channel_name: "Ch", public: opts.public ?? true, refreshed_at: at }), at)
      .run();
   const row = await env.DB.prepare("INSERT INTO cms_videos (kind, ref_id, locale, added_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4, ?4) RETURNING id")
      .bind(kind, ref, opts.locale ?? "all", at)
      .first<{ id: number }>();
   return row!.id;
}

type ListBody = { page: { slug: string; list_kind: string; list_filter: unknown; title: string }; pinned: { key: string }[]; items: { key: string; type: string; video?: { kind: string; snapshot: Record<string, unknown> } }[]; page_number: number; pages: number; total: number };
const list = async (f: ReturnType<typeof makeWorker>, path: string) => {
   const res = await f(`/api/public/v1/lists/${path}`);
   return { status: res.status, body: (res.status === 200 ? await res.json() : null) as ListBody };
};

beforeEach(async () => {
   await resetFeed();
   await env.DB.batch(["cms_videos", "page_entries", "trash", "trash_events"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
   await env.DB.prepare("DELETE FROM pages WHERE translation_key IS NULL OR translation_key NOT IN ('www-videos', 'www-articles')").run();
});

describe("filter pages", () => {
   it("/articles: every live main-site post (also those off home), not drafts, scheduled or unfeatured scholar posts; by page", async () => {
      const { f } = client("");
      const a = await insertPost({ date: "2026-11-01T10:00:00.000Z", title: "On home" });
      const b = await insertPost({ date: "2026-11-02T10:00:00.000Z", title: "Off home", show: 0 });
      await insertPost({ date: "2026-11-03T10:00:00.000Z", title: "Draft", status: "draft" });
      await insertPost({ date: "2099-01-01T00:00:00.000Z", title: "Later", publishAt: "2099-01-01T00:00:00.000Z" });
      const sch = await insertPost({ date: "2026-11-04T10:00:00.000Z", title: "Scholar" });
      await env.DB.prepare("UPDATE posts SET author_sub = 'sub-1' WHERE id = ?1").bind(sch).run();
      const c = await insertPost({ date: "2026-11-05T10:00:00.000Z", title: "Cards", kind: "cards" });
      const { status, body } = await list(f, "articles?locale=en");
      expect(status).toBe(200);
      expect(body.page).toMatchObject({ slug: "articles", list_kind: "filter", list_filter: { kinds: ["article", "cards"], tag: null }, title: "Articles" });
      expect(body.items.map((i) => i.key)).toEqual([`p${c}`, `p${b}`, `p${a}`]);
      expect(body).toMatchObject({ page_number: 1, pages: 1, total: 3 });
      // Featuring the scholar post brings it in; trashing a post takes it out.
      await env.DB.prepare("UPDATE posts SET featured_at = ?2 WHERE id = ?1").bind(sch, AT).run();
      expect((await list(f, "articles?locale=en")).body.total).toBe(4);
      const admin = client(await session(["Admin"], "wp-admin"));
      expect((await admin.call("DELETE", `/api/data/entity/posts/${b}`)).status).toBe(200);
      expect((await list(f, "articles?locale=en")).body.items.map((i) => i.key)).not.toContain(`p${b}`);
   });

   it("/videos: the library newest added first, public only, per language, channels with their latest videos", async () => {
      const { f } = client("");
      const v1 = await libraryVideo("v1", "2026-11-01T10:00:00.000Z");
      const v2 = await libraryVideo("v2", "2026-11-03T10:00:00.000Z", { locale: "ar" });
      await libraryVideo("gone", "2026-11-04T10:00:00.000Z", { public: false });
      const ch = await libraryVideo("ch1", "2026-11-02T10:00:00.000Z", { kind: "channel" });
      await env.DB.prepare("UPDATE video_snapshots SET snapshot = json_set(snapshot, '$.latest', json(?1)) WHERE ref_id = 'ch1'")
         .bind(JSON.stringify([{ id: "cv1", title: "Latest 1", thumbnail_url: "https://img.test/cv1.jpg", duration_seconds: 60 }]))
         .run();
      const en = await list(f, "videos?locale=en");
      expect(en.body.items.map((i) => i.key)).toEqual([`v${ch}`, `v${v1}`]);
      expect(en.body.items[0].video).toMatchObject({ kind: "channel", snapshot: { title: "Title ch1", latest: [{ id: "cv1", title: "Latest 1", thumbnail_url: "https://img.test/cv1.jpg", duration_seconds: 60 }] } });
      expect((await list(f, "videos?locale=ar")).body.items.map((i) => i.key)).toEqual([`v${v2}`, `v${ch}`, `v${v1}`]);
      // A tag matches posts only: a tag filter lists no videos.
      expect((await f("/api/public/v1/pages/videos?locale=en").then((r) => r.json())) as { list_kind: string }).toMatchObject({ list_kind: "filter" });
   });

   it("content pages and unknown slugs are not lists; a filter page's filter is validated on save", async () => {
      const { call, f } = client(await session(["Admin"], "wp-rules"));
      await createPage(call, { slug: "about-us", locale: "en", title: "About" });
      expect((await list(f, "about-us?locale=en")).status).toBe(404);
      expect((await list(f, "nope?locale=en")).status).toBe(404);
      expect((await call("POST", "/api/data/entity/pages", { slug: "bad-kind", locale: "en", title: "X", list_kind: "shelf" })).status).toBe(400);
      expect((await call("POST", "/api/data/entity/pages", { slug: "no-kinds", locale: "en", title: "X", list_kind: "filter", list_filter: { kinds: [] } })).status).toBe(400);
      expect((await call("POST", "/api/data/entity/pages", { slug: "no-filter", locale: "en", title: "X", list_kind: "filter" })).status).toBe(400);
      const id = await createPage(call, { slug: "seerah", locale: "en", title: "Seerah", list_kind: "filter", list_filter: { kinds: ["cards", "article", "article"], tag: " seerah " } });
      const row = await env.DB.prepare("SELECT list_filter FROM pages WHERE id = ?1").bind(id).first<{ list_filter: string }>();
      expect(JSON.parse(row!.list_filter)).toEqual({ kinds: ["article", "cards"], tag: "seerah" });
      const tagged = await insertPost({ date: AT, title: "Tagged" });
      await env.DB.prepare(`UPDATE posts SET tags = '["seerah"]' WHERE id = ?1`).bind(tagged).run();
      await insertPost({ date: AT, title: "Untagged" });
      expect((await list(f, "seerah?locale=en")).body.items.map((i) => i.key)).toEqual([`p${tagged}`]);
   });

   it("staff preview and tag suggestions (the tag field opens with the most used tags)", async () => {
      const { call } = client(await session(["Moderator"], "wp-prev"));
      for (const tags of [["a", "b"], ["a"], ["c"]]) {
         const id = await insertPost({ date: AT });
         await env.DB.prepare("UPDATE posts SET tags = ?2 WHERE id = ?1").bind(id, JSON.stringify(tags)).run();
      }
      const prev = (await (await call("GET", "/admin/api/lists/preview?locale=en&kinds=article")).json()) as { data: { items: unknown[]; total: number } };
      expect(prev.data.total).toBe(3);
      expect((await call("GET", "/admin/api/lists/preview?locale=en&kinds=")).status).toBe(400);
      const tags = (await (await call("GET", "/admin/api/suggest?kind=tags&q=&locale=en")).json()) as { items: { label: string; secondary: string }[] };
      expect(tags.items.map((t) => t.label)).toEqual(["a", "b", "c"]);
      expect(tags.items[0].secondary).toBe("2 posts");
   });
});

describe("home, channels and the library", () => {
   it("a channel added on home is a timeline item with its 3 latest videos, and joins the library; taking it off home keeps it there", async () => {
      const { call } = client(await session(["Moderator"], "wp-home"));
      const res = await call("POST", "/admin/api/timeline/videos", { kind: "channel", ref_id: "ch1", locale: "all" });
      expect(res.status, await res.clone().text()).toBe(201);
      const key = ((await res.json()) as { data: { key: string } }).data.key;
      const snap = await env.DB.prepare("SELECT snapshot FROM video_snapshots WHERE kind = 'channel' AND ref_id = 'ch1'").first<{ snapshot: string }>();
      expect(JSON.parse(snap!.snapshot).latest.map((x: { id: string }) => x.id)).toEqual(["cv1", "cv2", "cv3"]);
      expect(await env.DB.prepare("SELECT kind, ref_id, added_from FROM cms_videos").all().then((r) => r.results)).toEqual([{ kind: "channel", ref_id: "ch1", added_from: "home" }]);
      const tl = (await (await call("GET", "/api/public/v1/timeline?locale=en")).json()) as { items: { key: string; video?: { kind: string } }[] };
      expect(tl.items.find((i) => i.key === key)?.video?.kind).toBe("channel");
      expect((await call("DELETE", `/admin/api/timeline/entries/${key}`)).status).toBe(200);
      expect(await env.DB.prepare("SELECT count(*) AS n FROM cms_videos").first()).toEqual({ n: 1 });
   });

   it("the Videos screen lists the library with where each video is used; delete is soft and only takes it off /videos", async () => {
      const editor = client(await session(["Moderator"], "wp-lib"));
      expect((await editor.call("POST", "/admin/api/library", { kind: "video", ref_id: "v9", locale: "en" })).status).toBe(201);
      expect((await editor.call("POST", "/admin/api/library", { kind: "video", ref_id: "v9", locale: "ar" })).status).toBe(200);
      const row = await env.DB.prepare("SELECT id, locale, added_from FROM cms_videos WHERE ref_id = 'v9'").first<{ id: number; locale: string; added_from: string }>();
      expect(row).toMatchObject({ locale: "all", added_from: "library" }); // a second language makes it "all"
      const html = await (await editor.f("/videos", { headers: { cookie: (await session(["Moderator"], "wp-lib")) } })).text();
      expect(html).toContain("Talk v9");
      expect(html).toContain("data-library-add");
      expect(html).toContain('data-picker-added="video:v9"');
      expect(html).toContain("only the Videos page");
      expect((await editor.call("PATCH", `/admin/api/library/${row!.id}`, { locale: "ar" })).status).toBe(200);
      expect((await list(editor.f, "videos?locale=ar")).body.total).toBe(1);
      expect((await editor.call("DELETE", `/admin/api/library/${row!.id}`, { reason: "duplicate" })).status).toBe(200);
      expect((await list(editor.f, "videos?locale=ar")).body.total).toBe(0);
      const trash = await env.DB.prepare("SELECT id, kind, label, reason FROM trash WHERE kind = 'cms_videos'").first<{ id: number; label: string; reason: string }>();
      expect(trash).toMatchObject({ label: "Talk v9", reason: "duplicate" });
      const admin = client(await session(["Admin"], "wp-lib-admin"));
      expect((await admin.call("POST", `/admin/api/trash/${trash!.id}/restore`)).status).toBe(200);
      expect((await list(editor.f, "videos?locale=ar")).body.total).toBe(1);
   });
});

describe("curated pages", () => {
   it("its own list with home's mechanics: add, pin, hide, reorder, remove (soft) and restore; the editor screen reuses the Timeline client", async () => {
      const { call, f } = client(await session(["Admin"], "wp-cur"));
      const id = await createPage(call, { slug: "ramadan", locale: "en", title: "Ramadan", list_kind: "curated" });
      const p1 = await insertPost({ date: "2026-11-01T10:00:00.000Z", title: "First" });
      const p2 = await insertPost({ date: "2026-11-02T10:00:00.000Z", title: "Second" });
      await insertPost({ date: "2026-11-03T10:00:00.000Z", title: "Not added" });
      const ar = await insertPost({ date: AT, title: "عربي", locale: "ar" });
      const api = `/admin/api/lists/${id}`;
      // The chooser opens with the newest posts of the page's language that are not on it.
      const cands = (await (await call("GET", `${api}/candidates?q=`)).json()) as { items: { id: number }[]; published: number; off: number };
      expect(cands.items.length).toBe(3);
      expect(cands).toMatchObject({ published: 3, off: 3 });
      expect((await call("POST", `${api}/posts/${p1}`, { on: true })).status).toBe(200);
      expect((await call("POST", `${api}/posts/${p2}`, { on: true })).status).toBe(200);
      expect((await call("POST", `${api}/posts/${ar}`, { on: true })).status).toBe(400); // other language
      const v = await call("POST", `${api}/videos`, { kind: "video", ref_id: "v7" });
      expect(v.status).toBe(201);
      const vkey = ((await v.json()) as { data: { key: string } }).data.key;
      expect(await env.DB.prepare("SELECT added_from FROM cms_videos WHERE ref_id = 'v7'").first()).toEqual({ added_from: `page:${id}` });
      expect((await call("PATCH", `${api}/entries/p${p1}`, { pinned: true })).status).toBe(200);
      expect((await call("PATCH", `${api}/entries/p${p2}`, { hidden: true })).status).toBe(200);
      let pub = await list(f, "ramadan?locale=en");
      expect(pub.body.page.list_kind).toBe("curated");
      expect(pub.body.pinned.map((i) => i.key)).toEqual([`p${p1}`]);
      expect(pub.body.items.map((i) => i.key)).toEqual([vkey]); // p2 hidden; "Not added" never on it
      // Pins reorder; a stale set is a conflict.
      expect((await call("PATCH", `${api}/entries/${vkey}`, { pinned: true })).status).toBe(200);
      expect((await call("PUT", `${api}/pins`, { keys: [vkey, `p${p1}`] })).status).toBe(200);
      expect((await call("PUT", `${api}/pins`, { keys: [vkey] })).status).toBe(409);
      expect((await list(f, "ramadan?locale=en")).body.pinned.map((i) => i.key)).toEqual([vkey, `p${p1}`]);
      // Remove the video: soft, the library keeps it; restore brings it back.
      expect((await call("DELETE", `${api}/entries/${vkey}`)).status).toBe(200);
      expect(await env.DB.prepare("SELECT count(*) AS n FROM cms_videos WHERE ref_id = 'v7'").first()).toEqual({ n: 1 });
      const t = await env.DB.prepare("SELECT id, label FROM trash WHERE kind = 'page_entries'").first<{ id: number; label: string }>();
      expect(t?.label).toBe("Talk v7");
      expect((await call("POST", `/admin/api/trash/${t!.id}/restore`)).status).toBe(200);
      pub = await list(f, "ramadan?locale=en");
      expect(pub.body.pinned.map((i) => i.key)).toEqual([vkey, `p${p1}`]);
      // Removing a post is soft too.
      expect((await call("POST", `${api}/posts/${p1}`, { on: false })).status).toBe(200);
      expect(await env.DB.prepare("SELECT count(*) AS n FROM trash WHERE kind = 'page_entries'").first()).toEqual({ n: 1 });
      // The editor: the Timeline screen scoped to the page, with its own API base and change log.
      const html = await (await f(`/pages/${id}/list`, { headers: { cookie: (await session(["Admin"], "wp-cur")) } })).text();
      expect(html).toContain(`data-api="/admin/api/lists/${id}"`);
      expect(html).toContain("List: Ramadan");
      expect(html).toContain('value="channel"');
      expect(html).not.toContain("data-feed-status"); // no KV publishing state for a page
      expect(html).toMatch(/pinned <bdi dir="auto">First<\/bdi>/);
      const home = await (await f("/timeline?locale=en", { headers: { cookie: (await session(["Admin"], "wp-cur")) } })).text();
      expect(home).not.toMatch(/pinned <bdi dir="auto">First<\/bdi>/); // page changes stay out of home's log
   });

   it("a page that is not a curated list has no list screen or list API", async () => {
      const { call, f } = client(await session(["Admin"], "wp-nolist"));
      const id = await createPage(call, { slug: "plain", locale: "en", title: "Plain" });
      expect((await f(`/pages/${id}/list`, { headers: { cookie: (await session(["Admin"], "wp-nolist")) } })).status).toBe(404);
      expect((await call("GET", `/admin/api/lists/${id}/candidates?q=`)).status).toBe(404);
      const writer = client(await session(["Scholar"], "wp-writer"));
      expect((await writer.call("GET", `/admin/api/lists/${id}/candidates?q=`)).status).toBe(403);
   });

   it("the page editor offers the three page types and the filter fields", async () => {
      const cookie = await session(["Admin"], "wp-editor");
      const { call, f } = client(cookie);
      const id = await createPage(call, { slug: "talks", locale: "en", title: "Talks", list_kind: "filter", list_filter: { kinds: ["video"], tag: null } });
      const html = await (await f(`/pages/${id}`, { headers: { cookie } })).text();
      expect(html).toContain('name="list_kind" value="filter" checked');
      expect(html).toMatch(/data-page-panel="" hidden/);
      expect(html).toContain('name="list_kinds" value="video" checked');
      expect(html).toContain('data-ac="tags"');
      expect(html).toContain('data-ac-initial="1"');
      const pages = await (await f("/pages", { headers: { cookie } })).text();
      expect(pages).toContain(">Filter</span>");
   });
});
