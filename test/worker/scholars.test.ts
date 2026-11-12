/**
 * Scholars (docs/SCHOLARS.md): the writer role (own posts only), the profile made at first sign-in,
 * the main-site rule (a scholar post is on the home timeline and the Articles list only once
 * featured), featuring with its audit log, the community post sync, and the public scholar API.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../src/env.ts";
import { feedItems } from "../../src/lib/feed/source.ts";
import { noteCommunityChange, syncCommunity } from "../../src/lib/scholars/community.ts";
import { accessToken, cookiesOf, ISSUER, makeWorker, type Upstream } from "./helpers.ts";

const ORIGIN = "https://cms.test";
const KEY = "internal-test-key";
/** The Worker env with the internal key as a plain string (the Secrets Store binding is empty in tests). */
const E = { ...(env as unknown as Env), VIDEOS_INTERNAL_API_KEY: KEY } as Env;

interface Videos {
   channels: Record<string, { id: string; name: string; handle?: string }[]>;
   puts: { userId: string; externalId: string; body: Record<string, unknown> }[];
   deletes: { userId: string; externalId: string }[];
   down?: boolean;
   /** Public profiles (`GET /api/profiles/:id`) by auth user id */
   profiles?: Record<string, Record<string, unknown>>;
}

/** The videos API (public + /internal/scholars/*) as the CMS sees it. */
function videosApi(v: Videos): Upstream {
   return async (url, init) => {
      const prof = /^\/api\/profiles\/([^/]+)$/.exec(url.pathname);
      if (prof) {
         const p = v.profiles?.[decodeURIComponent(prof[1])];
         return p ? Response.json({ success: true, result: { profile: p } }) : Response.json({ success: false }, { status: 404 });
      }
      if (!url.pathname.startsWith("/internal/")) return new Response("nf", { status: 404 });
      if ((init?.headers as Record<string, string> | undefined)?.["X-API-Key"] !== KEY) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (v.down) return Response.json({ error: "busy" }, { status: 503 });
      const m = /^\/internal\/scholars\/([^/]+)\/(channels|articles\/([^/]+))$/.exec(url.pathname);
      if (!m) return new Response("nf", { status: 404 });
      const userId = decodeURIComponent(m[1]);
      if (m[2] === "channels") return Response.json({ channels: v.channels[userId] ?? [] });
      const externalId = decodeURIComponent(m[3]);
      if (init?.method === "PUT") {
         const body = JSON.parse(String(init.body)) as Record<string, unknown>;
         if (!(v.channels[userId] ?? []).some((c) => c.id === body.channelId)) return Response.json({ error: "not_owner" }, { status: 403 });
         v.puts.push({ userId, externalId, body });
         return Response.json({ postId: `post-${externalId}`, channelId: body.channelId });
      }
      if (init?.method === "DELETE") {
         v.deletes.push({ userId, externalId });
         return Response.json({ hidden: true });
      }
      return new Response("nf", { status: 404 });
   };
}

/** A Worker whose network is the videos mock (+ auth /token for sign-in), with the internal key set. */
function worker(v: Videos, token?: string) {
   const videos = videosApi(v);
   return makeWorker(
      (url, init) => {
         if (token && url.toString() === `${ISSUER}/token`) return Response.json({ access_token: token, refresh_token: "r", expires_in: 600 });
         return videos(url, init);
      },
      { VIDEOS_INTERNAL_API_KEY: KEY } as never,
   );
}

async function session(v: Videos, roles: string[], id: string, name?: string): Promise<string> {
   const token = await accessToken({ id, email: `${id}@example.com`, roles, ...(name ? { name } : {}) } as never);
   const f = worker(v, token);
   const login = await f("/sso/login?return=%2F");
   const state = new URL(login.headers.get("location")!).searchParams.get("state");
   const cb = await f(`/sso/callback?code=c&state=${state}`, { headers: { cookie: cookiesOf(login) } });
   expect(cb.status).toBe(302);
   return cookiesOf(cb);
}

function client(v: Videos, cookie: string) {
   const f = worker(v);
   const call = (method: string, path: string, body?: unknown) =>
      f(path, { method, headers: { cookie, origin: ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
   return { f, call };
}

const fresh = (): Videos => ({ channels: {}, puts: [], deletes: [] });

async function post(call: ReturnType<typeof client>["call"], slug: string, extra: Record<string, unknown> = {}): Promise<number> {
   const r = await call("POST", "/api/data/entity/posts", { slug, locale: "en", title: `Title ${slug}`, status: "published", tags: [], excerpt: "An excerpt", ...extra });
   expect(r.status).toBe(201);
   return ((await r.json()) as { data: { id: number } }).data.id;
}

const row = (id: number) => env.DB.prepare("SELECT * FROM posts WHERE id = ?1").bind(id).first<Record<string, unknown>>();

beforeEach(async () => {
   await env.DB.batch(["community_links", "timeline_changes", "feed_dirty", "trash", "trash_events"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

describe("a scholar signs in", () => {
   it("is named by the account's display name, else first + last (never the email)", async () => {
      const v = fresh();
      // The owner's prod profile shape: empty display name, first + last, no handle.
      v.profiles = { "sch-named": { id: "sch-named", displayName: "", firstName: "Mahmoud", lastName: "Darwish", userName: null } };
      const cookie = await session(v, ["Scholar"], "sch-named");
      const s = await env.DB.prepare("SELECT slug, name_en, name_ar FROM scholars WHERE sso_sub = 'sch-named'").first<Record<string, unknown>>();
      expect(s).toMatchObject({ slug: "mahmoud-darwish", name_en: "Mahmoud Darwish", name_ar: null });
      const page = await (await client(v, cookie).f("/scholars/me", { headers: { cookie } })).text();
      expect(page).toContain('<strong title="sch-named@example.com">Mahmoud Darwish</strong>');
      expect(page).toContain('aria-label="Account: Mahmoud Darwish"');
   });

   it("an empty name field hints the account's first + last; no name → the email in the menu, never the handle", async () => {
      const v = fresh();
      // A handle is not a user's name (handles belong to channels).
      v.profiles = { "sch-hint": { id: "sch-hint", displayName: "", userName: "hinthandle" } };
      const cookie = await session(v, ["Scholar"], "sch-hint");
      const s = await env.DB.prepare("SELECT name_en, name_ar FROM scholars WHERE sso_sub = 'sch-hint'").first<Record<string, unknown>>();
      expect(s).toMatchObject({ name_en: null, name_ar: null });
      v.profiles = { "sch-hint": { id: "sch-hint", displayName: "  ", firstName: "Hint", lastName: "Person" } };
      const page = await (await client(v, cookie).f("/scholars/me", { headers: { cookie } })).text();
      expect(page).toContain('placeholder="Hint Person"');
      expect(page).toContain("Name on the account: Hint Person");
      expect(page).toContain(">sch-hint@example.com</strong>");
      expect(page).not.toContain("@hinthandle");
      const ar = await (await client(v, cookie).f("/scholars/me?lang=ar", { headers: { cookie } })).text();
      expect(ar).toContain("الاسم في الحساب: Hint Person");
   });

   it("gets the writer role and a profile linked to the channels they own", async () => {
      const v = fresh();
      v.channels["sch-a"] = [{ id: "ch-a1", name: "Aisha's lessons", handle: "aisha" }];
      const cookie = await session(v, ["Scholar", "Member"], "sch-a", "Aisha Rahman");
      const user = await env.DB.prepare("SELECT role FROM users WHERE sso_sub = 'sch-a'").first<{ role: string }>();
      expect(user?.role).toBe("writer");
      const s = await env.DB.prepare("SELECT * FROM scholars WHERE sso_sub = 'sch-a'").first<Record<string, unknown>>();
      expect(s).toMatchObject({ slug: "aisha-rahman", name_en: "Aisha Rahman", channel_ids: '["ch-a1"]' });
      // Their home is their articles; the profile screen is theirs.
      const { f } = client(v, cookie);
      expect((await f("/", { headers: { cookie } })).headers.get("location")).toBe("/posts");
      const me = await f("/scholars/me", { headers: { cookie } });
      expect(me.status).toBe(200);
      expect(await me.text()).toContain("Aisha&#39;s lessons");
      // Signing in again never makes a second profile.
      await session(v, ["Scholar"], "sch-a", "Aisha Rahman");
      expect((await env.DB.prepare("SELECT count(*) AS n FROM scholars WHERE sso_sub = 'sch-a'").first<{ n: number }>())!.n).toBe(1);
   });

   it("still signs in (profile without channels) when the videos API is down", async () => {
      const v = { ...fresh(), down: true };
      await session(v, ["Scholar"], "sch-down");
      expect(await env.DB.prepare("SELECT channel_ids FROM scholars WHERE sso_sub = 'sch-down'").first()).toMatchObject({ channel_ids: "[]" });
   });
});

describe("the writer role: their own posts only", () => {
   it("stamps the author, refuses protected fields, scopes lists, hides others' posts", async () => {
      const v = fresh();
      const a = client(v, await session(v, ["Scholar"], "sch-own-a"));
      const b = client(v, await session(v, ["Scholar"], "sch-own-b"));
      const mine = await post(a.call, `own-a-${Date.now()}`, { featured_at: new Date().toISOString(), author_sub: "someone-else", show_on_timeline: true });
      const theirs = await post(b.call, `own-b-${Date.now()}`);
      expect(await row(mine)).toMatchObject({ author_sub: "sch-own-a", featured_at: null });

      // Lists and counts: only their own rows, whatever filter they send.
      const list = (await (await a.call("GET", `/api/data/entity/posts?where=${encodeURIComponent(JSON.stringify({ author_sub: "sch-own-b" }))}&limit=50`)).json()) as { data: { id: number }[] };
      expect(list.data.map((r) => r.id)).toEqual([mine]);
      const or = (await (await a.call("GET", `/api/data/entity/posts?where=${encodeURIComponent(JSON.stringify({ $or: [{ id: theirs }, { id: mine }] }))}`)).json()) as { data: { id: number }[] };
      expect(or.data.map((r) => r.id)).toEqual([mine]);
      const count = (await (await a.call("POST", "/api/data/entity/posts/fn/count", {})).json()) as { count: number };
      expect(count.count).toBe(1);

      // Someone else's post: not found, for reads, edits and deletes.
      expect((await a.call("GET", `/api/data/entity/posts/${theirs}`)).status).toBe(404);
      expect((await a.call("PATCH", `/api/data/entity/posts/${theirs}`, { title: "hijack" })).status).toBe(404);
      expect((await a.call("DELETE", `/api/data/entity/posts/${theirs}`)).status).toBe(404);
      expect((await a.f(`/posts/${theirs}`, { headers: { cookie: (await session(v, ["Scholar"], "sch-own-a")) } })).status).toBe(404);
      expect((await row(theirs))!.title).toBe(`Title ${(await row(theirs))!.slug}`);

      // Their own post's editor: no timeline switch, no free-text author, a "Main site" card without the feature button.
      const page = await (await a.call("GET", `/posts/${mine}`)).text();
      expect(page).toContain("data-main-site");
      expect(page).not.toContain('name="show_on_timeline"');
      expect(page).not.toContain('name="author_name"');
      expect(page).not.toContain("data-feature-post");
      expect((await a.call("GET", "/posts")).status).toBe(200);

      // Their own: edit, unpublish, featuring fields still refused.
      expect((await a.call("PATCH", `/api/data/entity/posts/${mine}`, { title: "Mine, edited", featured_at: new Date().toISOString() })).status).toBe(200);
      expect(await row(mine)).toMatchObject({ title: "Mine, edited", featured_at: null });

      // Everything else is staff's.
      expect((await a.call("POST", "/api/data/entity/pages", { slug: "x", locale: "en", title: "x" })).status).toBe(403);
      expect((await a.call("GET", "/api/data/entity/nav_items")).status).toBe(403);
      expect((await a.call("POST", `/admin/api/featuring/posts/${mine}`, { on: true })).status).toBe(403);
      expect((await a.call("POST", "/admin/api/timeline/videos", { kind: "video", ref_id: "v1", locale: "all" })).status).toBe(403);
      for (const path of ["/pages", "/timeline", "/navigation", "/site", "/featuring", "/scholars/1"]) {
         expect((await a.call("GET", path)).status, path).toBe(403);
      }
      // Search suggestions only find their own posts.
      const sug = (await (await a.call("GET", "/admin/api/suggest?kind=content&q=Title")).json()) as { items: { id: string }[] };
      expect(sug.items.map((i) => Number(i.id))).not.toContain(theirs);

      // Delete their own: a soft delete, restorable by an admin.
      expect((await a.call("DELETE", `/api/data/entity/posts/${mine}`)).status).toBe(200);
      expect(await env.DB.prepare("SELECT kind FROM trash WHERE kind = 'posts' AND item_id = ?1").bind(mine).first()).toMatchObject({ kind: "posts" });
   });
});

describe("the main site and featuring", () => {
   it("a scholar post is on their page, not on the main lists, until an editor features it (audit-logged)", async () => {
      const v = fresh();
      const writer = client(v, await session(v, ["Scholar"], "sch-feat", "Feat Scholar"));
      const slug = `feat-${Date.now()}`;
      const id = await post(writer.call, slug);
      const pub = makeWorker();
      const listed = async (path: string) => JSON.stringify(await (await pub(path)).json()).includes(slug);

      expect((await pub(`/api/public/v1/posts/${slug}?locale=en`)).status).toBe(200);
      expect(await listed("/api/public/v1/posts?locale=en&limit=20")).toBe(false);
      expect(await listed("/api/public/v1/home?locale=en")).toBe(false);
      expect((await feedItems(E, "en", { pinned: false, limit: 50 })).some((i) => JSON.stringify(i).includes(slug))).toBe(false);
      expect(await listed("/api/public/v1/scholars/feat-scholar?locale=en")).toBe(true);
      // Its byline names the scholar's page.
      expect(await (await pub(`/api/public/v1/posts/${slug}?locale=en`)).json()).toMatchObject({ author: { slug: "feat-scholar", name: "Feat Scholar" }, author_name: "Feat Scholar" });

      const editor = client(v, await session(v, ["Moderator"], "ed-feat"));
      expect((await editor.call("POST", `/admin/api/featuring/posts/${id}`, { on: true })).status).toBe(200);
      expect(await row(id)).toMatchObject({ featured_by: "ed-feat@example.com" });
      expect(await listed("/api/public/v1/posts?locale=en&limit=20")).toBe(true);
      expect((await feedItems(E, "en", { pinned: false, limit: 50 })).some((i) => JSON.stringify(i).includes(slug))).toBe(true);
      // The featuring screen and the post's editor say so.
      expect(await (await editor.f("/featuring?state=featured", { headers: { cookie: (await session(v, ["Moderator"], "ed-feat")) } })).text()).toContain(`Title ${slug}`);

      expect((await editor.call("POST", `/admin/api/featuring/posts/${id}`, { on: false })).status).toBe(200);
      expect(await listed("/api/public/v1/posts?locale=en&limit=20")).toBe(false);
      const log = await env.DB.prepare("SELECT action, actor_email FROM timeline_changes WHERE entry_ref = ?1 ORDER BY id").bind(`p${id}`).all();
      expect(log.results).toEqual([
         { action: "feature", actor_email: "ed-feat@example.com" },
         { action: "unfeature", actor_email: "ed-feat@example.com" },
      ]);
      // A staff post can't be "featured": it is on the main site already.
      const staff = await post(editor.call, `staff-${Date.now()}`);
      expect((await editor.call("POST", `/admin/api/featuring/posts/${staff}`, { on: true })).status).toBe(400);
   });

   it("featuring an article features its translations by the same scholar", async () => {
      const v = fresh();
      const w = client(v, await session(v, ["Scholar"], "sch-tr"));
      const key = `tk-${Date.now()}`;
      const en = await post(w.call, `tr-en-${Date.now()}`, { translation_key: key });
      const ar = await post(w.call, `tr-ar-${Date.now()}`, { translation_key: key, locale: "ar" });
      const ed = client(v, await session(v, ["Admin"], "ad-tr"));
      const res = (await (await ed.call("POST", `/admin/api/featuring/posts/${en}`, { on: true })).json()) as { data: { changed: number[] } };
      expect(res.data.changed.sort()).toEqual([en, ar].sort());
   });
});

describe("community posts follow the article", () => {
   it("publish → posted to the first channel; edit → updated (same post); unpublish and delete → hidden", async () => {
      const v = fresh();
      v.channels["sch-com"] = [{ id: "ch-com", name: "Com" }];
      const w = client(v, await session(v, ["Scholar"], "sch-com", "Com Scholar"));
      const slug = `com-${Date.now()}`;
      const id = await post(w.call, slug);
      // The save already synced (waitUntil after the write).
      expect(v.puts).toHaveLength(1);
      expect(v.puts[0]).toMatchObject({ userId: "sch-com", externalId: `cms-${id}`, body: { channelId: "ch-com", title: `Title ${slug}`, excerpt: "An excerpt", url: `https://www.test/en/articles/${slug}/`, locale: "en" } });
      expect(await row(id)).toMatchObject({ community_post_id: `post-cms-${id}` });

      await w.call("PATCH", `/api/data/entity/posts/${id}`, { title: "Edited" });
      expect(v.puts).toHaveLength(2);
      expect(v.puts[1].externalId).toBe(`cms-${id}`);

      await w.call("PATCH", `/api/data/entity/posts/${id}`, { status: "draft" });
      expect(v.deletes).toEqual([{ userId: "sch-com", externalId: `cms-${id}` }]);

      await w.call("PATCH", `/api/data/entity/posts/${id}`, { status: "published" });
      expect(v.puts).toHaveLength(3);
      await w.call("DELETE", `/api/data/entity/posts/${id}`);
      await syncCommunity(E, { fetch: (async (u: RequestInfo | URL, i?: RequestInit) => videosApi(v)(new URL(String(u)), i)) as typeof fetch });
      expect(v.deletes).toHaveLength(2);
   });

   it("a draft never posts; a failure backs off and is retried; no channel waits", async () => {
      const v = fresh();
      v.channels["sch-retry"] = [{ id: "ch-r", name: "R" }];
      const w = client(v, await session(v, ["Scholar"], "sch-retry"));
      const draft = await post(w.call, `draft-${Date.now()}`, { status: "draft" });
      expect(v.puts).toHaveLength(0);
      expect(await env.DB.prepare("SELECT 1 FROM community_links WHERE post_id = ?1").bind(draft).first()).toBeNull();

      v.down = true;
      const id = await post(w.call, `retry-${Date.now()}`);
      const link = await env.DB.prepare("SELECT state, attempts, next_attempt_at, last_error FROM community_links WHERE post_id = ?1").bind(id).first<Record<string, unknown>>();
      expect(link).toMatchObject({ state: "pending", attempts: 1, last_error: "busy" });
      v.down = false;
      const later = Date.parse(String(link!.next_attempt_at)) + 1000;
      const fetchV = (async (u: RequestInfo | URL, i?: RequestInit) => videosApi(v)(new URL(String(u)), i)) as typeof fetch;
      expect(await syncCommunity(E, { now: later, fetch: fetchV })).toMatchObject({ shown: 1 });
      expect(await env.DB.prepare("SELECT state FROM community_links WHERE post_id = ?1").bind(id).first()).toMatchObject({ state: "ok" });

      // A scholar without a channel: nothing is posted until they link one.
      const n = client(v, await session(v, ["Scholar"], "sch-nochan"));
      const lone = await post(n.call, `lone-${Date.now()}`);
      expect(await env.DB.prepare("SELECT state FROM community_links WHERE post_id = ?1").bind(lone).first()).toMatchObject({ state: "no_channel" });
      await noteCommunityChange(E, [lone]);
   });
});

describe("profiles", () => {
   it("a scholar edits their profile; channels must be their own; slugs are unique", async () => {
      const v = fresh();
      v.channels["sch-prof"] = [
         { id: "ch-p1", name: "P1" },
         { id: "ch-p2", name: "P2" },
      ];
      const w = client(v, await session(v, ["Scholar"], "sch-prof"));
      const me = (await (await w.call("GET", "/admin/api/scholars/me")).json()) as { data: { updated_at: string; channel_ids: string[] } };
      expect(me.data.channel_ids).toEqual(["ch-p1", "ch-p2"]);
      const ok = await w.call("PUT", "/admin/api/scholars/me", { name_ar: "عالم", bio_en: "Teaches fiqh.", slug: "prof-scholar", channel_ids: ["ch-p2"], updated_at: me.data.updated_at });
      expect(ok.status).toBe(200);
      expect(await env.DB.prepare("SELECT slug, name_ar, channel_ids FROM scholars WHERE sso_sub = 'sch-prof'").first()).toMatchObject({ slug: "prof-scholar", name_ar: "عالم", channel_ids: '["ch-p2"]' });
      expect(await (await w.call("PUT", "/admin/api/scholars/me", { channel_ids: ["ch-someone-else"] })).json()).toEqual({ error: "not_your_channel" });
      expect((await w.call("PUT", "/admin/api/scholars/me", { slug: "Bad Slug" })).status).toBe(400);
      // A stale save is refused.
      expect((await w.call("PUT", "/admin/api/scholars/me", { bio_en: "x", updated_at: me.data.updated_at })).status).toBe(409);

      // Public: the page, the directory, by channel, search and the sitemap.
      const pub = makeWorker();
      expect(await (await pub("/api/public/v1/scholars/prof-scholar?locale=ar")).json()).toMatchObject({ scholar: { slug: "prof-scholar", name: "عالم", bio: "Teaches fiqh.", channel_ids: ["ch-p2"] } });
      expect(await (await pub("/api/public/v1/scholars/by-channel/ch-p2")).json()).toMatchObject({ slug: "prof-scholar" });
      expect((await pub("/api/public/v1/scholars/by-channel/ch-p1")).status).toBe(404);
      expect(JSON.stringify(await (await pub("/api/public/v1/scholars?locale=en&limit=48")).json())).toContain("prof-scholar");
      expect(await (await pub("/api/public/v1/search/scholars?locale=ar&q=prof")).json()).toEqual([expect.objectContaining({ type: "scholar", slug: "prof-scholar", href: "/ar/scholars/prof-scholar/" })]);
      expect(((await (await pub("/api/public/v1/sitemap")).json()) as { scholars: { slug: string }[] }).scholars.map((s) => s.slug)).toContain("prof-scholar");

      // An admin deletes it (soft): gone from www, restorable.
      const admin = client(v, await session(v, ["Admin"], "ad-prof"));
      const id = (await env.DB.prepare("SELECT id FROM scholars WHERE slug = 'prof-scholar'").first<{ id: number }>())!.id;
      expect((await client(v, await session(v, ["Moderator"], "ed-prof")).call("DELETE", `/admin/api/scholars/${id}`)).status).toBe(403);
      expect((await admin.call("DELETE", `/admin/api/scholars/${id}`, { reason: "test" })).status).toBe(200);
      expect((await pub("/api/public/v1/scholars/prof-scholar?locale=en")).status).toBe(404);
      const t = await env.DB.prepare("SELECT id FROM trash WHERE kind = 'scholars' AND item_id = ?1").bind(id).first<{ id: number }>();
      expect((await admin.call("POST", `/admin/api/trash/${t!.id}/restore`)).status).toBe(200);
      expect((await pub("/api/public/v1/scholars/prof-scholar?locale=en")).status).toBe(200);
   });
});
