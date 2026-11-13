/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles read loose JSON */
/**
 * Scholar post references (docs/SCHOLARS.md §7–§8): api-videos' outbox writes a hidden ref per public
 * post on a scholar's primary channel; www lists them from the summary and reads the post itself; the
 * conversion turns existing CMS scholar posts into community posts and refs with the same slugs.
 */
import { env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Env } from "../../src/env.ts";
import { POST_FIXTURES } from "../../src/lib/post-schema.generated.ts";
import { checkConversion, planConversion, runConversion } from "../../src/lib/scholars/convert.ts";
import { feedItems } from "../../src/lib/feed/source.ts";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

const KEY = "internal-test-key";
const E = { ...(env as unknown as Env), VIDEOS_INTERNAL_API_KEY: KEY } as Env;
const ORIGIN = "https://cms.test";

/** api-videos as the CMS sees it: community posts by channel/id, and the conversion endpoints. */
function videos(store: Map<string, Record<string, unknown>>) {
   const conv = new Map<string, { postId: string; channelId: string; post: Record<string, unknown> }>();
   const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if ((init?.headers as Record<string, string> | undefined)?.["X-API-Key"] !== KEY) return Response.json({ error: "unauthorized" }, { status: 401 });
      const read = /^\/internal\/posts\/([^/]+)\/([^/]+)$/.exec(url.pathname);
      if (read) {
         const p = store.get(`${read[1]}/${read[2]}`);
         return p ? Response.json({ post: p }) : Response.json({ error: "not_found" }, { status: 404 });
      }
      const c = /^\/internal\/scholars\/([^/]+)\/posts\/([^/]+)$/.exec(url.pathname);
      if (c && init?.method === "PUT") {
         const b = JSON.parse(String(init.body)) as Record<string, any>;
         const prev = conv.get(c[2]);
         const postId = prev?.postId ?? `cp-${c[2]}`;
         const post = { id: postId, channelId: b.channelId, type: b.kind, status: b.status, visibility: "public", locale: b.locale, title: b.title, slides: b.slides, article: b.article ? { ...b.article, coverUrl: b.article.cover?.url ?? null, url: b.www.url, locale: b.locale, externalId: c[2] } : undefined, www: b.www, createdAt: b.publishedAt };
         conv.set(c[2], { postId, channelId: b.channelId, post });
         store.set(`${b.channelId}/${postId}`, post);
         return Response.json({ postId, channelId: b.channelId, created: !prev, upgraded: false, post });
      }
      if (c) {
         const got = conv.get(c[2]);
         return got ? Response.json(got) : Response.json({ error: "not_found" }, { status: 404 });
      }
      return new Response("nf", { status: 404 });
   }) as typeof fetch;
   return { fetchImpl, conv };
}

async function scholar(sub: string, slug: string, channel: string | null) {
   const at = new Date().toISOString();
   await env.DB.prepare(
      "INSERT INTO scholars (sso_sub, slug, name_en, channel_ids, primary_channel_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) ON CONFLICT (sso_sub) DO UPDATE SET primary_channel_id = excluded.primary_channel_id",
   )
      .bind(sub, slug, `Name ${slug}`, JSON.stringify(channel ? [channel] : []), channel, at)
      .run();
}

const refs = (store: Map<string, Record<string, unknown>>) =>
   makeWorker((url, init) => videos(store).fetchImpl(url, init), { VIDEOS_INTERNAL_API_KEY: KEY } as never);

async function put(f: ReturnType<typeof makeWorker>, post: Record<string, unknown>, key = KEY) {
   return f(`/internal/refs/${String(post.id)}`, { method: "PUT", headers: { "X-API-Key": key, "content-type": "application/json" }, body: JSON.stringify({ channelId: post.channelId, post }) });
}

afterEach(() => {
   vi.unstubAllGlobals();
});

beforeEach(async () => {
   await env.DB.batch(["feed_dirty", "timeline_changes"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

describe("the reference outbox (/internal/refs)", () => {
   it("refuses a missing or wrong key", async () => {
      const f = refs(new Map());
      const post = { ...POST_FIXTURES.text, id: "p-auth", channelId: "ch-auth" };
      expect((await put(f, post, "")).status).toBe(401);
      expect((await put(f, post, "nope")).status).toBe(401);
   });

   it("ignores channels that are no scholar's primary channel", async () => {
      const f = refs(new Map());
      const res = await put(f, { ...POST_FIXTURES.text, id: "p-other", channelId: "ch-nobody" });
      expect(await res.json()).toEqual({ status: "ignored" });
      expect(await env.DB.prepare("SELECT 1 FROM posts WHERE ref_post_id = 'p-other'").first()).toBeNull();
   });

   it("creates one ref per post, keeps its slug, follows edits, drafts it on delete; www reads the post", async () => {
      await scholar("sch-ref", "ref-scholar", "ch-ref");
      const store = new Map<string, Record<string, unknown>>();
      const f = refs(store);
      const post = { ...POST_FIXTURES.article, id: "p-art", channelId: "ch-ref", article: { ...POST_FIXTURES.article.article!, title: "On Patience Today" } };
      store.set("ch-ref/p-art", post);
      const first = (await (await put(f, post)).json()) as Record<string, unknown>;
      expect(first).toMatchObject({ status: "ok", slug: "on-patience-today", locale: "en", url: "https://www.test/en/articles/on-patience-today/", created: true });
      const row = await env.DB.prepare("SELECT * FROM posts WHERE ref_post_id = 'p-art'").first<Record<string, unknown>>();
      expect(row).toMatchObject({ kind: "article", author_sub: "sch-ref", ref_channel_id: "ch-ref", body: "", status: "published", featured_at: null });

      // An edit in Studio: same ref, same slug, new title and summary.
      const edited = { ...post, article: { ...post.article, title: "Renamed" } };
      store.set("ch-ref/p-art", edited);
      expect(await (await put(f, edited)).json()).toMatchObject({ slug: "on-patience-today", created: false });
      expect(await env.DB.prepare("SELECT title, slug FROM posts WHERE ref_post_id = 'p-art'").first()).toEqual({ title: "Renamed", slug: "on-patience-today" });

      // www: the post page reads the community post (body, community fields); lists use the summary.
      // (The public API calls api-videos with the Worker's own fetch.)
      vi.stubGlobal("fetch", videos(store).fetchImpl);
      const pub = refs(store);
      const page = (await (await pub("/api/public/v1/posts/on-patience-today?locale=en")).json()) as Record<string, any>;
      expect(page).toMatchObject({ kind: "article", body: post.article.body, ref: { post_id: "p-art", channel_id: "ch-ref" }, community: { id: "p-art", type: "article" } });
      const scholarPage = JSON.stringify(await (await pub("/api/public/v1/scholars/ref-scholar?locale=en")).json());
      expect(scholarPage).toContain("on-patience-today");
      // Not on the main site until featured (SS8: editors decide).
      expect(JSON.stringify(await (await pub("/api/public/v1/posts?locale=en&limit=20")).json())).not.toContain("on-patience-today");

      // Gone from the channel (deleted or no longer public): drafted; the address answers 404.
      const del = await f("/internal/refs/p-art?channelId=ch-ref", { method: "DELETE", headers: { "X-API-Key": KEY } });
      expect(await del.json()).toEqual({ status: "ok" });
      expect((await pub("/api/public/v1/posts/on-patience-today?locale=en")).status).toBe(404);
      // Published again: the same address comes back.
      expect(await (await put(f, edited)).json()).toMatchObject({ slug: "on-patience-today", created: false });
   });

   it("every kind gets a summary; a featured poll is on the home timeline with its options", async () => {
      await scholar("sch-poll", "poll-scholar", "ch-poll");
      const store = new Map<string, Record<string, unknown>>();
      const f = refs(store);
      for (const kind of Object.keys(POST_FIXTURES) as (keyof typeof POST_FIXTURES)[]) {
         const p = { ...POST_FIXTURES[kind], id: `p-${kind}`, channelId: "ch-poll" };
         expect(((await (await put(f, p)).json()) as { status: string }).status, kind).toBe("ok");
      }
      const poll = await env.DB.prepare("SELECT id, kind, title FROM posts WHERE ref_post_id = 'p-poll'").first<Record<string, unknown>>();
      expect(poll).toMatchObject({ kind: "poll", title: "Which day suits you?" });
      const gif = await env.DB.prepare("SELECT title FROM posts WHERE ref_post_id = 'p-gif'").first<{ title: string }>();
      expect(gif!.title).toContain("Name poll-scholar");
      const { callback } = await signIn(["Admin"], { id: "ad-poll", email: "ad-poll@example.com" });
      const ed = makeWorker();
      const r = await ed(`/admin/api/featuring/posts/${poll!.id}`, { method: "POST", headers: { cookie: cookiesOf(callback), origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ on: true }) });
      expect(r.status).toBe(200);
      const items = await feedItems(E, "en", { pinned: false, limit: 50 });
      const item = items.find((i) => JSON.stringify(i).includes("p-poll")) as Record<string, any> | undefined;
      expect(item?.post).toMatchObject({ kind: "poll", v2: { poll: { question: "Which day suits you?", options: [{ id: "option-0", text: "Friday" }, { id: "option-1", text: "Saturday" }] } } });
   });

   it("leaves a not-yet-converted CMS article mirror alone", async () => {
      await scholar("sch-mir", "mir-scholar", "ch-mir");
      const at = new Date().toISOString();
      const row = await env.DB.prepare("INSERT INTO posts (slug, locale, title, body, status, kind, author_sub, community_post_id, created_at, updated_at) VALUES ('mirror-a', 'en', 'Mirror', 'Body', 'published', 'article', 'sch-mir', 'cp-m', ?1, ?1) RETURNING id").bind(at).first<{ id: number }>();
      const f = refs(new Map());
      const mirror = { ...POST_FIXTURES.article, id: "cp-m", channelId: "ch-mir", article: { title: "Mirror", excerpt: null, coverUrl: null, url: "https://www.test/en/articles/mirror-a/", locale: "en", externalId: `cms-${row!.id}` } };
      expect(await (await put(f, mirror)).json()).toEqual({ status: "ignored" });
      expect(await env.DB.prepare("SELECT ref_post_id, body FROM posts WHERE id = ?1").bind(row!.id).first()).toEqual({ ref_post_id: null, body: "Body" });
   });
});

describe("the conversion (docs/SCHOLARS.md §8)", () => {
   it("plans, converts with the same slugs, keeps featuring, and the check finds no difference", async () => {
      await scholar("sch-conv", "conv-scholar", "ch-conv");
      await scholar("sch-lone", "lone-scholar", null);
      const at = new Date().toISOString();
      const ins = (slug: string, sub: string, extra = "") =>
         env.DB.prepare(`INSERT INTO posts (slug, locale, title, excerpt, body, status, kind, author_sub, created_at, updated_at, published_at${extra ? ", featured_at, community_post_id" : ""}) VALUES (?1, 'en', ?2, 'Short', '## Hi\n\nThe body.', 'published', 'article', ?3, ?4, ?4, ?4${extra ? ", ?4, 'cp-old'" : ""}) RETURNING id`)
            .bind(slug, `Title ${slug}`, sub, at)
            .first<{ id: number }>();
      const art = (await ins("conv-article", "sch-conv", "featured"))!.id;
      const lone = (await ins("conv-lone", "sch-lone"))!.id;
      const plan = await planConversion(E);
      const mine = plan.items.filter((i) => i.id === art || i.id === lone);
      expect(mine.find((i) => i.id === art)).toMatchObject({ kind: "article", mirror: true, featured: true, channel_id: "ch-conv", skip: null });
      expect(mine.find((i) => i.id === lone)).toMatchObject({ skip: "no_channel" });

      const store = new Map<string, Record<string, unknown>>();
      const v = videos(store);
      const res = await runConversion(E, { ids: [art, lone], fetch: v.fetchImpl });
      expect(res.converted.map((c) => c.id)).toEqual([art]);
      expect(res.skipped).toEqual([{ id: lone, reason: "no_channel" }]);
      const row = await env.DB.prepare("SELECT slug, body, ref_post_id, ref_channel_id, kind, featured_at FROM posts WHERE id = ?1").bind(art).first<Record<string, unknown>>();
      expect(row).toMatchObject({ slug: "conv-article", body: "", ref_post_id: `cp-cms-${art}`, ref_channel_id: "ch-conv", kind: "article" });
      expect(row!.featured_at).not.toBeNull();
      const sent = v.conv.get(`cms-${art}`)!.post as Record<string, any>;
      expect(sent.article).toMatchObject({ title: "Title conv-article", body: "## Hi\n\nThe body.", excerpt: "Short" });
      expect(sent.www).toEqual({ url: "https://www.test/en/articles/conv-article/", slug: "conv-article", locale: "en" });
      // The rollback copy is in the history.
      expect(await env.DB.prepare("SELECT actor_email FROM content_revisions WHERE entity = 'posts' AND entity_id = ?1 ORDER BY version DESC LIMIT 1").bind(art).first()).toEqual({ actor_email: "system:scholar-conversion" });
      // Running again converts nothing new.
      expect((await runConversion(E, { ids: [art], fetch: v.fetchImpl })).converted).toEqual([]);

      const check = await checkConversion(E, { ids: [art], fetch: v.fetchImpl });
      expect(check.items).toEqual([{ id: art, post_id: `cp-cms-${art}`, ok: true, diffs: [] }]);
      // A body changed behind the conversion's back is reported.
      sent.article.body = "Something else";
      expect((await checkConversion(E, { ids: [art], fetch: v.fetchImpl })).items[0]!.diffs.join()).toContain("body hash");
   });
});

describe("staff screens", () => {
   it("the Posts list hides references; a ref's editor links to www and Studio instead", async () => {
      await scholar("sch-list", "list-scholar", "ch-list");
      const f = refs(new Map());
      await put(f, { ...POST_FIXTURES.text, id: "p-list", channelId: "ch-list", content: "Hidden from the posts list" });
      const id = (await env.DB.prepare("SELECT id FROM posts WHERE ref_post_id = 'p-list'").first<{ id: number }>())!.id;
      const { callback } = await signIn(["Admin"], { id: "ad-list", email: "ad-list@example.com" });
      const cookie = cookiesOf(callback);
      const w = makeWorker();
      const list = await (await w("/posts?q=Hidden", { headers: { cookie } })).text();
      expect(list).not.toContain("Hidden from the posts list");
      const editor = await (await w(`/posts/${id}`, { headers: { cookie } })).text();
      expect(editor).toContain('data-ref-post="p-list"');
      expect(editor).toContain("https://videos.test/en/settings/channel/ch-list/community");
   });
});
