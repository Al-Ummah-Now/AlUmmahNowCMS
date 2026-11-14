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

/**
 * A scholar post written in the CMS before scholars moved to Studio (docs/SCHOLARS.md §8): created by
 * staff, then given its author the way the old writer screens did.
 */
async function legacyPost(call: ReturnType<typeof client>["call"], sub: string, slug: string, extra: Record<string, unknown> = {}): Promise<number> {
   const id = await post(call, slug, extra);
   await env.DB.prepare("UPDATE posts SET author_sub = ?2 WHERE id = ?1").bind(id, sub).run();
   return id;
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
      // The account menu's name (shared nav contract): the name, the email under it
      expect(page).toContain('<span class="aun-menu-who-name" dir="auto" title="sch-named@example.com">Mahmoud Darwish</span>');
      expect(page).toContain('<span class="aun-acct-name" dir="auto">Mahmoud Darwish</span>');
      expect(page).toContain('<span class="vh">Account: </span><span class="aun-acct-name" dir="auto">Mahmoud Darwish</span>');
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
      expect(page).toContain('title="sch-hint@example.com">sch-hint@example.com</span>');
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
      // Their home is "Write in Studio" (docs/SCHOLARS.md §7, SS18); the profile screen is theirs.
      const { f } = client(v, cookie);
      expect((await f("/", { headers: { cookie } })).headers.get("location")).toBe("/write");
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

describe("the writer role: Write in Studio (SS18)", () => {
   it("gets Write in Studio and their profile; never writes posts; staff screens stay staff's", async () => {
      const v = fresh();
      v.channels["sch-own-a"] = [{ id: "ch-own-a", name: "Own A" }];
      const cookie = await session(v, ["Scholar"], "sch-own-a");
      const a = client(v, cookie);
      const ed = client(v, await session(v, ["Admin"], "ad-own"));
      const mine = await legacyPost(ed.call, "sch-own-a", `own-a-${Date.now()}`);
      const theirs = await legacyPost(ed.call, "sch-own-b", `own-b-${Date.now()}`);

      // Write in Studio: a link to their channel's composer on the videos site.
      const write = await a.f("/write", { headers: { cookie } });
      expect(write.status).toBe(200);
      const html = await write.text();
      expect(html).toContain("data-write-in-studio");
      expect(html).toContain("https://videos.test/en/settings/channel/ch-own-a/community/new");
      // The old post screens lead there.
      for (const path of ["/posts", "/posts/new", `/posts/${mine}`]) expect((await a.f(path, { headers: { cookie } })).headers.get("location"), path).toBe("/write");

      // No writes through the data API, even to their own posts; reads stay scoped.
      expect((await a.call("POST", "/api/data/entity/posts", { slug: "x", locale: "en", title: "x" })).status).toBe(403);
      expect((await a.call("PATCH", `/api/data/entity/posts/${mine}`, { title: "edited" })).status).toBe(403);
      expect((await a.call("DELETE", `/api/data/entity/posts/${mine}`)).status).toBe(403);
      expect((await a.call("GET", `/api/data/entity/posts/${theirs}`)).status).toBe(404);
      const list = (await (await a.call("GET", "/api/data/entity/posts?limit=50")).json()) as { data: { id: number }[] };
      expect(list.data.map((r) => r.id)).toEqual([mine]);

      // Everything else is staff's.
      expect((await a.call("POST", "/api/data/entity/pages", { slug: "x", locale: "en", title: "x" })).status).toBe(403);
      expect((await a.call("POST", `/admin/api/featuring/posts/${mine}`, { on: true })).status).toBe(403);
      for (const path of ["/pages", "/timeline", "/navigation", "/site", "/featuring", "/scholars/1"]) {
         expect((await a.call("GET", path)).status, path).toBe(403);
      }
   });
});

describe("the main site and featuring", () => {
   it("a scholar post is on their page, not on the main lists, until an editor features it (audit-logged)", async () => {
      const v = fresh();
      await session(v, ["Scholar"], "sch-feat", "Feat Scholar");
      const staffer = client(v, await session(v, ["Admin"], "ad-feat"));
      const slug = `feat-${Date.now()}`;
      const id = await legacyPost(staffer.call, "sch-feat", slug);
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
      await session(v, ["Scholar"], "sch-tr");
      const ed = client(v, await session(v, ["Admin"], "ad-tr"));
      const key = `tk-${Date.now()}`;
      const en = await legacyPost(ed.call, "sch-tr", `tr-en-${Date.now()}`, { translation_key: key });
      const ar = await legacyPost(ed.call, "sch-tr", `tr-ar-${Date.now()}`, { translation_key: key, locale: "ar" });
      const res = (await (await ed.call("POST", `/admin/api/featuring/posts/${en}`, { on: true })).json()) as { data: { changed: number[] } };
      expect(res.data.changed.sort()).toEqual([en, ar].sort());
   });
});

describe("community posts follow the article (legacy CMS scholar posts, until converted)", () => {
   const fetchOf = (v: Videos) => (async (u: RequestInfo | URL, i?: RequestInit) => videosApi(v)(new URL(String(u)), i)) as typeof fetch;

   it("publish → posted to the first channel; edit → updated (same post); unpublish and delete → hidden", async () => {
      const v = fresh();
      v.channels["sch-com"] = [{ id: "ch-com", name: "Com" }];
      await session(v, ["Scholar"], "sch-com", "Com Scholar");
      const w = client(v, await session(v, ["Admin"], "ad-com"));
      const slug = `com-${Date.now()}`;
      const id = await legacyPost(w.call, "sch-com", slug);
      await noteCommunityChange(E, [id]);
      await syncCommunity(E, { fetch: fetchOf(v) });
      expect(v.puts).toHaveLength(1);
      expect(v.puts[0]).toMatchObject({ userId: "sch-com", externalId: `cms-${id}`, body: { channelId: "ch-com", title: `Title ${slug}`, excerpt: "An excerpt", url: `https://www.test/en/articles/${slug}/`, locale: "en" } });
      expect(await row(id)).toMatchObject({ community_post_id: `post-cms-${id}` });

      // A save syncs at once (waitUntil after the write).
      await w.call("PATCH", `/api/data/entity/posts/${id}`, { title: "Edited" });
      expect(v.puts).toHaveLength(2);
      expect(v.puts[1].externalId).toBe(`cms-${id}`);

      await w.call("PATCH", `/api/data/entity/posts/${id}`, { status: "draft" });
      expect(v.deletes).toEqual([{ userId: "sch-com", externalId: `cms-${id}` }]);

      await w.call("PATCH", `/api/data/entity/posts/${id}`, { status: "published" });
      expect(v.puts).toHaveLength(3);
      await w.call("DELETE", `/api/data/entity/posts/${id}`);
      await syncCommunity(E, { fetch: fetchOf(v) });
      expect(v.deletes).toHaveLength(2);
   });

   it("a draft never posts; a failure backs off and is retried; no channel waits; a reference is never synced", async () => {
      const v = fresh();
      v.channels["sch-retry"] = [{ id: "ch-r", name: "R" }];
      await session(v, ["Scholar"], "sch-retry");
      const w = client(v, await session(v, ["Admin"], "ad-retry"));
      const draft = await legacyPost(w.call, "sch-retry", `draft-${Date.now()}`, { status: "draft" });
      await noteCommunityChange(E, [draft]);
      expect(v.puts).toHaveLength(0);
      expect(await env.DB.prepare("SELECT 1 FROM community_links WHERE post_id = ?1").bind(draft).first()).toBeNull();

      v.down = true;
      const id = await legacyPost(w.call, "sch-retry", `retry-${Date.now()}`);
      await noteCommunityChange(E, [id]);
      await syncCommunity(E, { fetch: fetchOf(v) });
      const link = await env.DB.prepare("SELECT state, attempts, next_attempt_at, last_error FROM community_links WHERE post_id = ?1").bind(id).first<Record<string, unknown>>();
      expect(link).toMatchObject({ state: "pending", attempts: 1, last_error: "busy" });
      v.down = false;
      const later = Date.parse(String(link!.next_attempt_at)) + 1000;
      expect(await syncCommunity(E, { now: later, fetch: fetchOf(v) })).toMatchObject({ shown: 1 });
      expect(await env.DB.prepare("SELECT state FROM community_links WHERE post_id = ?1").bind(id).first()).toMatchObject({ state: "ok" });

      // Once the post is a reference (converted), the old sync is retired for it: no hide, no re-post.
      await env.DB.prepare("UPDATE posts SET ref_post_id = 'cp-ret', ref_channel_id = 'ch-r', status = 'draft' WHERE id = ?1").bind(id).run();
      await noteCommunityChange(E, [id]);
      expect(await env.DB.prepare("SELECT state FROM community_links WHERE post_id = ?1").bind(id).first()).toMatchObject({ state: "retired" });
      await syncCommunity(E, { now: later + 60_000, fetch: fetchOf(v) });
      expect(v.deletes).toHaveLength(0);

      // A scholar without a channel: nothing is posted until they link one.
      await session(v, ["Scholar"], "sch-nochan");
      const lone = await legacyPost(w.call, "sch-nochan", `lone-${Date.now()}`);
      await noteCommunityChange(E, [lone]);
      await syncCommunity(E, { now: later + 120_000, fetch: fetchOf(v) });
      expect(await env.DB.prepare("SELECT state FROM community_links WHERE post_id = ?1").bind(lone).first()).toMatchObject({ state: "no_channel" });
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
      // The primary channel (stored, else the first linked one) on the page and in the sitemap (AlUmmahNow#1215)
      const stored = await env.DB.prepare("SELECT primary_channel_id FROM scholars WHERE slug = 'prof-scholar'").first<{ primary_channel_id: string | null }>();
      const primary = stored?.primary_channel_id ?? "ch-p2";
      expect(await (await pub("/api/public/v1/scholars/prof-scholar?locale=en")).json()).toMatchObject({ scholar: { primary_channel_id: primary } });
      const listed = ((await (await pub("/api/public/v1/sitemap")).json()) as { scholars: { slug: string; primary_channel_id: string | null }[] }).scholars.find((s) => s.slug === "prof-scholar");
      expect(listed?.primary_channel_id).toBe(primary);
      await env.DB.prepare("UPDATE scholars SET primary_channel_id = NULL WHERE slug = 'prof-scholar'").run();
      expect(await (await pub("/api/public/v1/scholars/prof-scholar?locale=en")).json()).toMatchObject({ scholar: { primary_channel_id: "ch-p2" } });

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
