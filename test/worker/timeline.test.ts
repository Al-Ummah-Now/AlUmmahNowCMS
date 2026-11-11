import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { runBuild } from "../../src/lib/feed/jobs.ts";
import { headKey, type HeadDoc } from "../../src/lib/feed/model.ts";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";
import { insertPost, insertVideoEntry, noSleep, resetFeed, testEnv } from "./feed-helpers.ts";

const ORIGIN = "https://cms.test";
const FEED = env.FEED as KVNamespace;

async function session(roles: string[], id: string) {
   const { callback } = await signIn(roles, { id, email: `${id}@example.com` });
   return cookiesOf(callback);
}

const videosApi = (url: URL) => {
   const m = /\/api\/videos\/([\w-]+)$/.exec(url.pathname);
   if (m) return Response.json({ id: m[1], title: `Picked ${m[1]}`, thumbnailUrl: "https://images.example/p.jpg", channelName: "Ch", isPublic: true, uploadStatus: "ready", dateCreated: "2026-09-01T10:00:00.000Z" });
   return new Response("no", { status: 404 });
};

function client(cookie: string, f = makeWorker(videosApi)) {
   const call = (method: string, path: string, body?: unknown) =>
      f(path, { method, headers: { cookie, origin: ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
   return { f, call };
}

const dirtyItems = async () => (await env.DB.prepare("SELECT item FROM feed_dirty ORDER BY id").all<{ item: string }>()).results.map((r) => r.item);

beforeEach(resetFeed);

describe("Timeline screen and API", () => {
   it("renders pinned and dated entries with hidden/scheduled marks, a who/when log, en/ar and RTL", async () => {
      const cookie = await session(["Admin"], "tl-admin");
      const { f, call } = client(cookie);
      const a = await insertPost({ date: "2026-11-01T10:00:00.000Z", title: "First post" });
      const b = await insertPost({ date: "2026-11-02T10:00:00.000Z", title: "Pinned post" });
      await insertPost({ date: "2099-01-01T00:00:00.000Z", title: "Later post", publishAt: "2099-01-01T00:00:00.000Z" });
      await insertPost({ date: "2026-11-03T10:00:00.000Z", title: "Draft post", status: "draft" });
      await insertPost({ date: "2026-11-03T10:00:00.000Z", title: "منشور", locale: "ar" });
      expect((await call("PATCH", `/admin/api/timeline/entries/p${b}`, { pinned: true })).status).toBe(200);
      expect((await call("PATCH", `/admin/api/timeline/entries/p${a}`, { hidden: true })).status).toBe(200);
      const html = await (await f("/timeline?locale=en", { headers: { cookie } })).text();
      expect(html).toContain('data-pins');
      const pinnedPart = html.slice(html.indexOf("data-pins"), html.indexOf("data-entries"));
      expect(pinnedPart).toContain("Pinned post");
      expect(html).toContain("First post");
      expect(html).toContain("data-hidden-badge");
      expect(html).toContain("Later post"); // scheduled: shown to staff with its go-live time
      expect(html).toContain("badge scheduled");
      expect(html).not.toContain("Draft post");
      expect(html).not.toContain("منشور");
      expect(html).toContain("tl-admin@example.com"); // the change log says who
      expect(html).toMatch(/pinned <bdi dir="auto">Pinned post<\/bdi>/);
      const ar = await (await f("/timeline?locale=ar&lang=ar", { headers: { cookie } })).text();
      expect(ar).toContain('dir="rtl"');
      expect(ar).toContain("منشور");
      expect(ar).toContain("الخط الزمني للرئيسية");
      // No plus icons; inputs follow the spellcheck rules (free text on, dates off by type).
      expect(html).not.toMatch(/M12 5v14|M5 12h14/);
      expect(html).toMatch(/data-entry-field="title_override"|data-pins/);
   });

   it("editors can add, hide, pin, reorder and remove; every change is logged and queues a build", async () => {
      const cookie = await session(["Moderator"], "tl-editor");
      const { call } = client(cookie);
      const p1 = await insertPost({ date: "2026-10-01T10:00:00.000Z" });
      const p2 = await insertPost({ date: "2026-10-02T10:00:00.000Z" });
      // Add a video through the picker endpoint: the snapshot is taken server-side, dated by the video.
      const added = await call("POST", "/admin/api/timeline/videos", { kind: "video", ref_id: "vid-new", locale: "all" });
      expect(added.status).toBe(201);
      const key = ((await added.json()) as { data: { key: string } }).data.key;
      const entry = await env.DB.prepare("SELECT * FROM timeline_entries WHERE id = ?1").bind(Number(key.slice(1))).first<Record<string, unknown>>();
      expect(entry).toMatchObject({ kind: "video", ref_id: "vid-new", entry_date: "2026-09-01T10:00:00.000Z", created_by: "tl-editor@example.com" });
      expect((await call("POST", "/admin/api/timeline/videos", { kind: "video", ref_id: "vid-new", locale: "all" })).status).toBe(200); // idempotent
      // Pin three, reorder.
      for (const k of [`p${p1}`, `p${p2}`, key]) expect((await call("PATCH", `/admin/api/timeline/entries/${k}`, { pinned: true })).status).toBe(200);
      expect((await call("PUT", "/admin/api/timeline/pins", { locale: "en", keys: [key, `p${p2}`, `p${p1}`] })).status).toBe(200);
      const ranks = (await env.DB.prepare("SELECT post_id, id, pin_rank FROM timeline_entries WHERE pin_rank IS NOT NULL ORDER BY pin_rank").all<{ post_id: number | null; id: number }>()).results;
      expect(ranks.map((r) => (r.post_id ? `p${r.post_id}` : `v${r.id}`))).toEqual([key, `p${p2}`, `p${p1}`]);
      // A stale order (someone else changed the pins) is refused.
      expect((await call("PUT", "/admin/api/timeline/pins", { locale: "en", keys: [key, `p${p1}`] })).status).toBe(409);
      // Hide, edit the video's date, remove a post (its toggle goes off, history records it), remove the video.
      expect((await call("PATCH", `/admin/api/timeline/entries/${key}`, { hidden: true, entry_date: "2026-08-01T12:00:00.000Z" })).status).toBe(200);
      expect((await call("POST", `/admin/api/timeline/posts/${p1}`, { on: false })).status).toBe(200);
      const post = await env.DB.prepare("SELECT show_on_timeline FROM posts WHERE id = ?1").bind(p1).first<{ show_on_timeline: number }>();
      expect(post!.show_on_timeline).toBe(0);
      const rev = await env.DB.prepare("SELECT actor_email, changed FROM content_revisions WHERE entity = 'posts' AND entity_id = ?1 ORDER BY version DESC").bind(p1).first<{ actor_email: string; changed: string }>();
      expect(rev).toMatchObject({ actor_email: "tl-editor@example.com" });
      expect(JSON.parse(rev!.changed)).toContain("show_on_timeline");
      expect((await call("DELETE", `/admin/api/timeline/entries/${key}`)).status).toBe(200);
      const log = (await env.DB.prepare("SELECT action, entry_ref, actor_email FROM timeline_changes ORDER BY id").all<{ action: string; entry_ref: string; actor_email: string }>()).results;
      expect(log.map((x) => x.action)).toEqual(["add", "pin", "pin", "pin", "reorder", "hide", "edit", "remove", "remove"]);
      expect(log.every((x) => x.actor_email === "tl-editor@example.com")).toBe(true);
      const dirty = await dirtyItems();
      expect(dirty).toEqual(expect.arrayContaining([key, `p${p1}`, `p${p2}`, "head:en"]));
      // Add the post back from the chooser.
      const cands = (await (await call("GET", "/admin/api/timeline/candidates?locale=en&q=")).json()) as { items: { id: number }[] };
      expect(cands.items.map((x) => x.id)).toEqual([p1]);
      expect((await call("POST", `/admin/api/timeline/posts/${p1}`, { on: true })).status).toBe(200);
      expect(((await (await call("GET", "/admin/api/timeline/candidates?locale=en&q=")).json()) as { items: unknown[] }).items).toEqual([]);
   });

   // Owner report 2026-11-11: production's English timeline showed "Nothing is on the timeline yet" next to
   // "Every live post is already on the timeline". Both were true (prod had no English posts at all), but they
   // read as a contradiction. Each empty state now says which case it is, from the same counts.
   type Cands = { items: { id: number }[]; published: number; off: number };
   /** The "On the timeline" section only (the strings script and the change log name items too). */
   const listPart = (html: string) => html.slice(html.indexOf('id="tl-items-h"'), html.indexOf("<aside"));
   const candidates = async (call: ReturnType<typeof client>["call"], l: string, q = "") => (await (await call("GET", `/admin/api/timeline/candidates?locale=${l}&q=${encodeURIComponent(q)}`)).json()) as Cands;

   it("a language with no published posts: the list and the chooser both say so (no 'already on the timeline')", async () => {
      const cookie = await session(["Admin"], "tl-empty");
      const { f, call } = client(cookie);
      await insertPost({ date: "2026-11-01T10:00:00.000Z", title: "منشور", locale: "ar" });
      await insertPost({ date: "2026-11-02T10:00:00.000Z", title: "Draft only", status: "draft" });
      const html = await (await f("/timeline?locale=en", { headers: { cookie } })).text();
      expect(html).toContain("Nothing is on the English timeline yet.");
      expect(html).toContain("There are no published English posts yet. Publish one, or add a video.");
      expect(listPart(html)).not.toContain("already on the timeline");
      expect(await candidates(call, "en")).toEqual({ items: [], published: 0, off: 0 });
      // The chooser's message for that case is the "no posts" one, in the screen's strings.
      expect(html).toContain("There are no published English posts yet. A post joins the timeline when it goes live.");
      // Arabic has its post: listed, and the chooser says it is already on.
      const ar = await (await f("/timeline?locale=ar&lang=ar", { headers: { cookie } })).text();
      expect(ar).toContain("منشور");
      expect(ar).not.toContain("لا شيء في الخط");
      expect(await candidates(call, "ar")).toEqual({ items: [], published: 1, off: 0 });
   });

   it("every published post on the timeline: the list shows them and the chooser counts them; switched-off posts are offered", async () => {
      const cookie = await session(["Admin"], "tl-full");
      const { f, call } = client(cookie);
      const a = await insertPost({ date: "2026-11-01T10:00:00.000Z", title: "On one" });
      await insertPost({ date: "2026-11-02T10:00:00.000Z", title: "On two" });
      let html = await (await f("/timeline?locale=en", { headers: { cookie } })).text();
      expect(html).toContain("On one");
      expect(html).toContain("On two");
      expect(html).not.toContain("Nothing is on the English timeline yet.");
      expect(html).toContain("All {0} published posts are already on the timeline.");
      expect(await candidates(call, "en")).toEqual({ items: [], published: 2, off: 0 });
      // Switch one off: the chooser offers exactly it; a search that misses it is a "no match", not "all on".
      expect((await call("POST", `/admin/api/timeline/posts/${a}`, { on: false })).status).toBe(200);
      const off = await candidates(call, "en");
      expect(off.items.map((x) => x.id)).toEqual([a]);
      expect(off).toMatchObject({ published: 2, off: 1 });
      expect(await candidates(call, "en", "nothing like this")).toEqual({ items: [], published: 2, off: 1 });
      html = await (await f("/timeline?locale=en", { headers: { cookie } })).text();
      expect(listPart(html)).not.toContain("On one");
      expect(listPart(html)).toContain("On two");
      expect(html).toContain("No post off the timeline matches that search.");
   });

   it("an empty dated list explains itself: everything pinned, or every post switched off", async () => {
      const cookie = await session(["Admin"], "tl-pinned");
      const { f, call } = client(cookie);
      const a = await insertPost({ date: "2026-11-01T10:00:00.000Z", title: "Only pinned" });
      expect((await call("PATCH", `/admin/api/timeline/entries/p${a}`, { pinned: true })).status).toBe(200);
      let html = await (await f("/timeline?locale=en", { headers: { cookie } })).text();
      expect(html).toContain("Everything on the timeline is pinned (above).");
      expect(html).not.toContain("Nothing is on the English timeline yet.");
      expect((await call("PATCH", `/admin/api/timeline/entries/p${a}`, { pinned: false })).status).toBe(200);
      expect((await call("POST", `/admin/api/timeline/posts/${a}`, { on: false })).status).toBe(200);
      html = await (await f("/timeline?locale=en", { headers: { cookie } })).text();
      expect(html).toContain("Nothing is on the English timeline yet.");
      expect(html).toContain("1 published post is switched off the timeline. Use Add a post to put it back.");
   });

   it("rejects bad input, cross-origin writes and non-staff; Rebuild is admin-only", async () => {
      const ed = await session(["Moderator"], "tl-ed2");
      const { f, call } = client(ed);
      expect((await call("PATCH", "/admin/api/timeline/entries/x1", { hidden: true })).status).toBe(404);
      expect((await call("PATCH", "/admin/api/timeline/entries/p999999", { hidden: true })).status).toBe(404);
      expect((await call("POST", "/admin/api/timeline/videos", { kind: "user", ref_id: "c" })).status).toBe(400);
      expect((await call("PUT", "/admin/api/timeline/pins", { locale: "fr", keys: [] })).status).toBe(400);
      expect((await call("POST", "/admin/api/timeline/rebuild")).status).toBe(403);
      const cross = await f("/admin/api/timeline/retry", { method: "POST", headers: { cookie: ed, origin: "https://evil.example" } });
      expect(cross.status).toBe(403);
      expect((await f("/admin/api/timeline/status")).status).toBe(401);
      const admin = await session(["Admin"], "tl-ad2");
      expect((await client(admin, f).call("POST", "/admin/api/timeline/rebuild")).status).toBe(202);
   });

   it("the post editor's toggle and every post save go through the feed plugin", async () => {
      const cookie = await session(["Admin"], "tl-ed3");
      const f = makeWorker();
      const created = await f("/api/data/entity/posts", {
         method: "POST",
         headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
         body: JSON.stringify({ slug: "plug", locale: "en", title: "Plug", status: "published", tags: [] }),
      });
      expect(created.status).toBe(201);
      const id = ((await created.json()) as { data: { id: number } }).data.id;
      expect(await dirtyItems()).toEqual([`p${id}`]);
      const editor = await (await f(`/posts/${id}`, { headers: { cookie } })).text();
      expect(editor).toContain('name="show_on_timeline"');
      expect(editor).toMatch(/name="show_on_timeline"[^>]*checked/);
      await env.DB.prepare("DELETE FROM feed_dirty").run();
      const off = await f(`/api/data/entity/posts/${id}`, { method: "PATCH", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ show_on_timeline: false }) });
      expect(off.status).toBe(200);
      expect(await dirtyItems()).toEqual([`p${id}`]);
      await env.DB.prepare("DELETE FROM feed_dirty").run();
      expect((await f(`/api/data/entity/posts/${id}`, { method: "DELETE", headers: { cookie, origin: ORIGIN } })).status).toBe(200);
      expect(await dirtyItems()).toEqual([`p${id}`]);
   });

   it("Overview flags a dead-lettered build with its reason and a Retry", async () => {
      const cookie = await session(["Moderator"], "tl-ov");
      const f = makeWorker();
      await env.DB.prepare("UPDATE feed_state SET dead_at = ?1, last_error = 'Error: KV unavailable' WHERE id = 1").bind(new Date().toISOString()).run();
      const html = await (await f("/", { headers: { cookie } })).text();
      expect(html).toContain("data-feed-flag");
      expect(html).toContain("KV unavailable");
      expect(html).toContain("data-feed-retry");
      expect((await client(cookie, f).call("POST", "/admin/api/timeline/retry")).status).toBe(200);
      expect((await env.DB.prepare("SELECT dead_at FROM feed_state WHERE id = 1").first<{ dead_at: string | null }>())!.dead_at).toBeNull();
   });
});

describe("public GET /api/public/v1/timeline", () => {
   it("serves pinned + live items newest first by cursor, published only, cached like the others", async () => {
      const f = makeWorker();
      const ids: number[] = [];
      for (let i = 0; i < 5; i++) ids.push(await insertPost({ date: new Date(Date.UTC(2026, 9, 1 + i)).toISOString() }));
      await insertPost({ date: "2026-10-09T00:00:00.000Z", status: "draft" });
      const v = await insertVideoEntry({ ref: "pub-v", date: "2026-10-03T12:00:00.000Z", pin: 1 });
      const r1 = await f("/api/public/v1/timeline?locale=en&limit=2");
      expect(r1.status).toBe(200);
      expect(r1.headers.get("cache-control")).toBe("public, s-maxage=60, stale-while-revalidate=600");
      const p1 = (await r1.json()) as { pinned: { key: string }[]; items: { key: string }[]; next: string };
      expect(p1.pinned.map((x) => x.key)).toEqual([`v${v}`]);
      expect(p1.items.map((x) => x.key)).toEqual([`p${ids[4]}`, `p${ids[3]}`]);
      const p2 = (await (await f(`/api/public/v1/timeline?locale=en&limit=2&before=${encodeURIComponent(p1.next)}`)).json()) as { pinned: unknown[]; items: { key: string }[]; next: string | null };
      expect(p2.pinned).toEqual([]);
      expect(p2.items.map((x) => x.key)).toEqual([`p${ids[2]}`, `p${ids[1]}`]);
      const p3 = (await (await f(`/api/public/v1/timeline?locale=en&limit=2&before=${encodeURIComponent(p2.next!)}`)).json()) as { items: { key: string }[]; next: string | null };
      expect(p3.items.map((x) => x.key)).toEqual([`p${ids[0]}`]);
      expect(p3.next).toBeNull();
      expect((await f("/api/public/v1/timeline?locale=en&before=junk")).status).toBe(400);
      expect((await f("/api/public/v1/timeline?locale=xx")).status).toBe(400);
   });

   it("matches what the KV build publishes", async () => {
      for (let i = 0; i < 3; i++) await insertPost({ date: new Date(Date.UTC(2026, 9, 1 + i)).toISOString() });
      await env.DB.prepare("INSERT INTO feed_dirty (item, created_at) VALUES ('all', ?1)").bind(new Date().toISOString()).run();
      await runBuild(testEnv(), { sleep: noSleep });
      const head = (await FEED.get(headKey("en"), "json")) as HeadDoc;
      const api = (await (await makeWorker()("/api/public/v1/timeline?locale=en")).json()) as { items: unknown[] };
      expect(api.items).toEqual(head.items);
   });
});
