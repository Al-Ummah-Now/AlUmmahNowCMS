/**
 * Public read API v1 (docs/PUBLIC_API.md, SPEC §6). The only unauthenticated surface besides
 * /healthz. Reads D1 directly (no bknd boot) and EVERY content query filters
 * `status = 'published'`: drafts are never serialized. Pages and posts must also be live
 * (`LIVE_SQL`: no `publish_at`, or one that has passed), so scheduled rows stay hidden (#7).
 */
import { Hono, type Context } from "hono";
import type { Env } from "../env.ts";
import { LIVE_SQL } from "../lib/schedule.ts";
import { bodyImagePaths } from "../lib/variants/body-images.ts";
import { enqueueVariants } from "../lib/variants/jobs.ts";
import { parseVariantQuery, VARIANT_TYPES, variantKey } from "../lib/variants/plan.ts";
import { MEDIA_COLS, mediaRefOf, mediaUrl, mediaVariants, type MediaRef, type MediaRow, type MediaVariants } from "../lib/media-ref.ts";
import { feedItems } from "../lib/feed/source.ts";
import { cursorOf, parseCursor } from "../lib/feed/model.ts";
import { mediaByIds, publicBlocks, publicSlides, rowSlides, slideMediaIds, type BlockDeps, type PublicSlide } from "../lib/blocks-public.ts";

type Locale = "en" | "ar";
type Row = Record<string, unknown>;

const CACHE = "public, s-maxage=60, stale-while-revalidate=600";
const MEDIA_CACHE = "public, max-age=31536000, immutable";
/** The original answering for a variant that isn't made yet: short, so the variant takes over soon. */
const PENDING_CACHE = "public, max-age=60, s-maxage=60";
const LOCAL_WWW = "http://localhost:4321";
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

class HttpError extends Error {
   readonly status: 400 | 404;
   readonly code: "bad_request" | "not_found";
   constructor(status: 400 | 404, message?: string) {
      super(message ?? (status === 404 ? "not_found" : "bad_request"));
      this.status = status;
      this.code = status === 404 ? "not_found" : "bad_request";
   }
}

function locale(c: Context): Locale {
   const l = c.req.query("locale");
   if (l === "en" || l === "ar") return l;
   throw new HttpError(400, "locale must be en or ar");
}

function intParam(raw: string | undefined, def: number, min: number, max: number, name: string): number {
   if (raw === undefined || raw === "") return def;
   if (!/^\d+$/.test(raw)) throw new HttpError(400, `${name} must be an integer`);
   const n = Number(raw);
   if (n < min || n > max) throw new HttpError(400, `${name} must be between ${min} and ${max}`);
   return n;
}

export function toIso(v: unknown): string | null {
   if (v === null || v === undefined || v === "") return null;
   const d = typeof v === "number" ? new Date(v) : new Date(String(v));
   return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Defence in depth for rows written before validation existed: only https URLs are served. */
function isHttps(v: unknown): boolean {
   if (typeof v !== "string") return false;
   try {
      return new URL(v).protocol === "https:";
   } catch {
      return false;
   }
}

const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

function parseJson<T>(v: unknown, fallback: T): T {
   if (v === null || v === undefined) return fallback;
   if (typeof v !== "string") return v as T;
   try {
      return JSON.parse(v) as T;
   } catch {
      return fallback;
   }
}

const truthy = (v: unknown, def: boolean) =>
   v === null || v === undefined ? def : v === true || v === 1 || v === "1" || v === "true";

export { mediaUrl, mediaVariants };
export type { MediaRef, MediaVariants };

async function covers(env: Env, entity: "pages" | "posts", ids: unknown[]): Promise<Map<string, MediaRef>> {
   const out = new Map<string, MediaRef>();
   if (ids.length === 0) return out;
   const keys = ids.map(String);
   const { results } = await env.DB.prepare(
      `SELECT m.entity_id, ${MEDIA_COLS} FROM media m LEFT JOIN media_variants v ON v.path = m.path
       WHERE m.reference = ?1 AND m.entity_id IN (${keys.map((_, i) => `?${i + 2}`).join(",")}) ORDER BY m.id`,
   )
      .bind(`${entity}.cover`, ...keys)
      .all<MediaRow & { entity_id: string }>();
   for (const m of results) {
      if (out.has(m.entity_id) || !m.path) continue;
      out.set(m.entity_id, mediaRefOf(env, m));
   }
   return out;
}

async function bodyImages(env: Env, body: string): Promise<MediaRef[]> {
   const paths = bodyImagePaths(env.PUBLIC_URL, body);
   if (!paths.length) return [];
   const { results } = await env.DB.prepare(
      `SELECT ${MEDIA_COLS} FROM media m LEFT JOIN media_variants v ON v.path = m.path WHERE m.path IN (${paths.map((_, i) => `?${i + 1}`).join(",")})`,
   )
      .bind(...paths)
      .all<MediaRow>();
   const byPath = new Map(results.map((r) => [r.path, r]));
   return paths.flatMap((p) => (byPath.has(p) ? [mediaRefOf(env, byPath.get(p)!)] : []));
}

function settingsOf(row: Row | null) {
   if (!row) return null;
   const social = parseJson<unknown>(row.social, []);
   return {
      locale: row.locale as Locale,
      site_title: typeof row.site_title === "string" ? row.site_title : "",
      tagline: strOrNull(row.tagline),
      hero_title: strOrNull(row.hero_title),
      hero_body: strOrNull(row.hero_body),
      social: Array.isArray(social)
         ? social
              .filter((s): s is { kind: string; url: string } => !!s && typeof s.kind === "string" && isHttps(s.url))
              .map((s) => ({ kind: s.kind, url: s.url }))
         : [],
   };
}

const getSettings = (env: Env, l: Locale) =>
   env.DB.prepare("SELECT * FROM site_settings WHERE locale = ?1 ORDER BY id LIMIT 1").bind(l).first<Row>();

async function nav(env: Env, l: Locale) {
   const { results } = await env.DB.prepare(
      "SELECT menu, label, url FROM nav_items WHERE locale = ?1 AND status = 'published' ORDER BY sort, id",
   )
      .bind(l)
      .all<{ menu: string; label: string; url: string }>();
   const pick = (menu: string) => results.filter((r) => r.menu === menu).map((r) => ({ label: r.label, url: r.url }));
   return { header: pick("header"), footer: pick("footer") };
}

const positiveOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
function localizedOf(v: unknown): Partial<Record<Locale, string>> {
   const out: Partial<Record<Locale, string>> = {};
   if (v && typeof v === "object") {
      for (const l of ["en", "ar"] as const) {
         const t = strOrNull((v as Row)[l]);
         if (t) out[l] = t;
      }
   }
   return out;
}

/**
 * The stored snapshot as served. The first three fields are the original contract; the rest are
 * filled by the snapshot refresh (src/lib/snapshots.ts) and are absent on rows not yet refreshed.
 */
export function snapshotOf(snap: Row | null) {
   if (!snap || typeof snap.title !== "string") return null;
   const out: Record<string, unknown> = {
      title: snap.title,
      thumbnail_url: isHttps(snap.thumbnail_url) ? (snap.thumbnail_url as string) : null,
      channel_name: strOrNull(snap.channel_name),
   };
   const refreshed = toIso(snap.refreshed_at);
   if (refreshed) {
      Object.assign(out, {
         refreshed_at: refreshed,
         handle: strOrNull(snap.handle),
         description: strOrNull(snap.description),
         titles: localizedOf(snap.titles),
         descriptions: localizedOf(snap.descriptions),
         duration_seconds: positiveOrNull(snap.duration_seconds),
         upload_date: toIso(snap.upload_date),
         video_count: positiveOrNull(snap.video_count),
      });
   }
   return out;
}

function curatedOf(r: Row) {
   return {
      id: Number(r.id),
      kind: r.kind as "video" | "playlist" | "channel",
      ref_id: String(r.ref_id),
      title_override: strOrNull(r.title_override),
      snapshot: snapshotOf(parseJson<Row | null>(r.snapshot, null)),
      sort: Number(r.sort ?? 0),
   };
}

/** Most curated rows served per placement: www resolves each one, so the list must stay bounded (audit CMS-4/UI-1). */
export const CURATED_MAX = 48;

async function curated(env: Env, l: Locale, placement: "home" | "videos") {
   const { results } = await env.DB.prepare(
      `SELECT id, kind, ref_id, title_override, snapshot, sort FROM curated_videos
       WHERE placement = ?1 AND status = 'published' AND (locale = ?2 OR locale = 'all' OR locale IS NULL)
         -- the snapshot refresh found the item no longer public (src/lib/snapshots.ts)
         AND NOT (json_valid(snapshot) AND json_extract(snapshot, '$.public') IS 0)
       ORDER BY sort, id
       LIMIT ?3`,
   )
      .bind(placement, l, CURATED_MAX)
      .all<Row>();
   return results.map(curatedOf);
}

export const POST_SUMMARY_COLS = "id, slug, locale, title, excerpt, author_name, tags, kind, slides, published_at, updated_at, created_at";

export async function postSummaries(env: Env, rows: Row[]) {
   const firstIds = rows.flatMap((r) => slideMediaIds(rowSlides(r)));
   const [cov, media] = await Promise.all([
      covers(
         env,
         "posts",
         rows.map((r) => r.id),
      ),
      mediaByIds(env, firstIds),
   ]);
   return rows.map((r) => {
      const slides = publicSlides(rowSlides(r), media);
      return postSummaryOf(r, cov.get(String(r.id)) ?? null, slides);
   });
}

/**
 * Slides a summary carries (lists, home, /cards, the home timeline feed), so www can show a card post
 * whole in a list without one more read per post. `slide_count` still counts every slide; the full set
 * is on GET /posts/{slug}.
 */
export const SUMMARY_SLIDES_MAX = 10;

/**
 * `kind`, `slide_count`, `first_slide` and `slides` are additive (card posts); articles have 0, null
 * and []. A summary's `slides` stops at SUMMARY_SLIDES_MAX; the full post (postOf) carries them all.
 */
function postSummaryOf(r: Row, cover: MediaRef | null, slides: PublicSlide[]) {
   const published = toIso(r.published_at) ?? toIso(r.created_at) ?? new Date(0).toISOString();
   const tags = parseJson<unknown>(r.tags, []);
   return {
      slug: String(r.slug),
      locale: r.locale as Locale,
      title: String(r.title ?? ""),
      excerpt: strOrNull(r.excerpt),
      cover,
      author_name: strOrNull(r.author_name),
      tags: Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [],
      published_at: published,
      updated_at: toIso(r.updated_at) ?? published,
      kind: r.kind === "cards" ? ("cards" as const) : ("article" as const),
      slide_count: slides.length,
      first_slide: slides[0] ?? null,
      slides: slides.slice(0, SUMMARY_SLIDES_MAX),
   };
}

const blockDeps = (env: Env): BlockDeps => ({
   summaries: (rows) => postSummaries(env, rows),
   postCols: POST_SUMMARY_COLS,
   snapshot: (s) => snapshotOf(s),
});

async function alternates(env: Env, table: "pages" | "posts", key: unknown, l: Locale) {
   if (typeof key !== "string" || key === "") return [];
   const { results } = await env.DB.prepare(
      `SELECT locale, slug FROM ${table} WHERE translation_key = ?1 AND ${LIVE_SQL} AND locale <> ?2 ORDER BY locale`,
   )
      .bind(key, l)
      .all<{ locale: Locale; slug: string }>();
   return results.map((r) => ({ locale: r.locale, slug: r.slug }));
}

/** A `pages` row as the public `Page` (also served by the preview API, src/routes/preview.ts). */
export async function pageOf(env: Env, row: Row) {
   const l = row.locale as Locale;
   const body = typeof row.body === "string" ? row.body : "";
   const [cov, alts, images, blocks] = await Promise.all([
      covers(env, "pages", [row.id]),
      alternates(env, "pages", row.translation_key, l),
      bodyImages(env, body),
      publicBlocks(env, row, blockDeps(env)),
   ]);
   const published = toIso(row.published_at) ?? toIso(row.created_at) ?? new Date(0).toISOString();
   return {
      slug: String(row.slug),
      locale: row.locale,
      title: String(row.title ?? ""),
      summary: strOrNull(row.summary),
      body,
      seo_title: strOrNull(row.seo_title),
      seo_description: strOrNull(row.seo_description),
      cover: cov.get(String(row.id)) ?? null,
      published_at: published,
      updated_at: toIso(row.updated_at) ?? published,
      alternates: alts,
      images,
      blocks,
   };
}

/** A `posts` row as the public `Post` (also served by the preview API). */
export async function postOf(env: Env, row: Row) {
   const l = row.locale as Locale;
   const body = typeof row.body === "string" ? row.body : "";
   const slideRows = rowSlides(row);
   const [cov, alts, images, media] = await Promise.all([
      covers(env, "posts", [row.id]),
      alternates(env, "posts", row.translation_key, l),
      bodyImages(env, body),
      mediaByIds(env, slideMediaIds(slideRows)),
   ]);
   const slides = publicSlides(slideRows, media);
   return {
      ...postSummaryOf(row, cov.get(String(row.id)) ?? null, slides),
      slides, // all of them (a summary stops at SUMMARY_SLIDES_MAX)
      body,
      seo_title: strOrNull(row.seo_title),
      seo_description: strOrNull(row.seo_description),
      alternates: alts,
      images,
   };
}

async function etagOf(body: string): Promise<string> {
   const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(body));
   const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
   return `W/"${hex.slice(0, 27)}"`;
}

function allowedOrigin(env: Env, origin: string | undefined): string | null {
   if (!origin) return null;
   const allowed = (env.WWW_ORIGINS || "")
      .split(",")
      .map((o) => o.trim().replace(/\/+$/, ""))
      .filter(Boolean);
   if (env.ENVIRONMENT === "local") allowed.push(LOCAL_WWW);
   return allowed.includes(origin) ? origin : null;
}

function corsHeaders(env: Env, origin: string | undefined): Record<string, string> {
   const allowed = allowedOrigin(env, origin);
   const h: Record<string, string> = { Vary: "Origin" };
   if (allowed) {
      h["Access-Control-Allow-Origin"] = allowed;
      h["Access-Control-Allow-Methods"] = "GET, HEAD, OPTIONS";
      h["Access-Control-Allow-Headers"] = "Accept, If-None-Match";
      h["Access-Control-Max-Age"] = "600";
   }
   return h;
}

async function json(c: Context<{ Bindings: Env }>, data: unknown): Promise<Response> {
   const body = JSON.stringify(data);
   const etag = await etagOf(body);
   const headers: Record<string, string> = {
      ...corsHeaders(c.env, c.req.header("Origin")),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": CACHE,
      ETag: etag,
      "X-Content-Type-Options": "nosniff",
   };
   const inm = c.req.header("If-None-Match");
   if (inm && inm.split(",").some((t) => t.trim() === etag)) return new Response(null, { status: 304, headers });
   return new Response(c.req.method === "HEAD" ? null : body, { status: 200, headers });
}

export function publicApi(): Hono<{ Bindings: Env }> {
   const api = new Hono<{ Bindings: Env }>();

   api.options("*", (c) => new Response(null, { status: 204, headers: corsHeaders(c.env, c.req.header("Origin")) }));

   api.get("/site", async (c) => {
      const l = locale(c);
      const [settings, navs] = await Promise.all([getSettings(c.env, l), nav(c.env, l)]);
      return json(c, { settings: settingsOf(settings), nav: navs });
   });

   api.get("/home", async (c) => {
      const l = locale(c);
      const [settings, videos, posts] = await Promise.all([
         getSettings(c.env, l),
         curated(c.env, l, "home"),
         c.env.DB.prepare(
            `SELECT ${POST_SUMMARY_COLS} FROM posts WHERE locale = ?1 AND ${LIVE_SQL} ORDER BY published_at DESC, id DESC LIMIT 3`,
         )
            .bind(l)
            .all<Row>(),
      ]);
      return json(c, { settings: settingsOf(settings), videos, posts: await postSummaries(c.env, posts.results) });
   });

   api.get("/pages/:slug", async (c) => {
      const l = locale(c);
      const row = await c.env.DB.prepare(`SELECT * FROM pages WHERE slug = ?1 AND locale = ?2 AND ${LIVE_SQL} LIMIT 1`)
         .bind(c.req.param("slug"), l)
         .first<Row>();
      if (!row) throw new HttpError(404);
      return json(c, await pageOf(c.env, row));
   });

   api.get("/posts", async (c) => {
      const l = locale(c);
      const page = intParam(c.req.query("page"), 1, 1, 100_000, "page");
      const limit = intParam(c.req.query("limit"), 10, 1, 20, "limit");
      const [count, rows] = await Promise.all([
         c.env.DB.prepare(`SELECT COUNT(*) AS n FROM posts WHERE locale = ?1 AND ${LIVE_SQL}`).bind(l).first<{ n: number }>(),
         c.env.DB.prepare(
            `SELECT ${POST_SUMMARY_COLS} FROM posts WHERE locale = ?1 AND ${LIVE_SQL} ORDER BY published_at DESC, id DESC LIMIT ?2 OFFSET ?3`,
         )
            .bind(l, limit, (page - 1) * limit)
            .all<Row>(),
      ]);
      return json(c, { items: await postSummaries(c.env, rows.results), page, limit, total: Number(count?.n ?? 0) });
   });

   api.get("/posts/:slug", async (c) => {
      const l = locale(c);
      const row = await c.env.DB.prepare(`SELECT * FROM posts WHERE slug = ?1 AND locale = ?2 AND ${LIVE_SQL} LIMIT 1`)
         .bind(c.req.param("slug"), l)
         .first<Row>();
      if (!row) throw new HttpError(404);
      return json(c, await postOf(c.env, row));
   });

   // Card posts only, newest first, optionally by tag (the cards grid). `tags`: every tag used by a
   // live card post in this locale, for the filter.
   api.get("/cards", async (c) => {
      const l = locale(c);
      const page = intParam(c.req.query("page"), 1, 1, 100_000, "page");
      const limit = intParam(c.req.query("limit"), 12, 1, 24, "limit");
      const tag = (c.req.query("tag") ?? "").trim();
      if (tag.length > 40) throw new HttpError(400, "tag must be at most 40 characters");
      const byTag = tag ? "AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(posts.tags) THEN posts.tags ELSE '[]' END) WHERE value = ?2)" : "";
      const where = `locale = ?1 AND kind = 'cards' AND ${LIVE_SQL} ${byTag}`;
      const binds = tag ? [l, tag] : [l];
      const n = binds.length;
      const [count, rows, tags] = await Promise.all([
         c.env.DB.prepare(`SELECT COUNT(*) AS n FROM posts WHERE ${where}`).bind(...binds).first<{ n: number }>(),
         c.env.DB.prepare(`SELECT ${POST_SUMMARY_COLS} FROM posts WHERE ${where} ORDER BY published_at DESC, id DESC LIMIT ?${n + 1} OFFSET ?${n + 2}`)
            .bind(...binds, limit, (page - 1) * limit)
            .all<Row>(),
         c.env.DB.prepare(
            `SELECT DISTINCT j.value AS tag FROM posts, json_each(CASE WHEN json_valid(posts.tags) THEN posts.tags ELSE '[]' END) j
             WHERE posts.locale = ?1 AND posts.kind = 'cards' AND ${LIVE_SQL.replace(/\b(status|publish_at)\b/g, "posts.$1")} AND typeof(j.value) = 'text' ORDER BY j.value LIMIT 50`,
         )
            .bind(l)
            .all<{ tag: string }>(),
      ]);
      return json(c, { items: await postSummaries(c.env, rows.results), page, limit, total: Number(count?.n ?? 0), tags: tags.results.map((r) => r.tag) });
   });

   // The home timeline (docs/PUBLIC_API.md "Timeline"): pinned items (first page only), then live
   // items newest first, by cursor. www reads the same feed from Workers KV (docs/FEED.md); this
   // endpoint serves other clients and checks.
   api.get("/timeline", async (c) => {
      const l = locale(c);
      const limit = intParam(c.req.query("limit"), 20, 1, 40, "limit");
      const raw = c.req.query("before");
      const cursor = raw ? parseCursor(raw) : null;
      if (raw && !cursor) throw new HttpError(400, "before must be a cursor from a previous page");
      const before = cursor ? { iso: new Date(cursor.ms).toISOString(), key: cursor.key } : undefined;
      const [pinned, rows] = await Promise.all([
         cursor ? Promise.resolve([]) : feedItems(c.env, l, { pinned: true }),
         feedItems(c.env, l, { pinned: false, before, limit: limit + 1 }),
      ]);
      const items = rows.slice(0, limit);
      const next = rows.length > limit ? cursorOf(items[items.length - 1]) : null;
      return json(c, { pinned, items, next });
   });

   api.get("/videos", async (c) => {
      const l = locale(c);
      const placement = c.req.query("placement") ?? "videos";
      if (placement !== "home" && placement !== "videos") throw new HttpError(400, "placement must be home or videos");
      return json(c, { items: await curated(c.env, l, placement) });
   });

   api.get("/sitemap", async (c) => {
      const [pages, posts] = await Promise.all([
         c.env.DB.prepare(
            `SELECT slug, locale, show_in_sitemap, updated_at, published_at, created_at FROM pages WHERE ${LIVE_SQL} ORDER BY locale, slug`,
         ).all<Row>(),
         c.env.DB.prepare(
            `SELECT slug, locale, updated_at, published_at, created_at FROM posts WHERE ${LIVE_SQL} ORDER BY locale, published_at DESC`,
         ).all<Row>(),
      ]);
      const updated = (r: Row) => toIso(r.updated_at) ?? toIso(r.published_at) ?? toIso(r.created_at) ?? new Date(0).toISOString();
      const items = [
         ...pages.results
            .filter((r) => truthy(r.show_in_sitemap, true))
            .map((r) => ({ type: "page" as const, locale: r.locale as Locale, slug: String(r.slug), updated_at: updated(r) })),
         ...posts.results.map((r) => ({ type: "post" as const, locale: r.locale as Locale, slug: String(r.slug), updated_at: updated(r) })),
      ];
      return json(c, { items });
   });

   api.get("/media/*", async (c) => {
      const prefix = "/api/public/v1/media/";
      const raw = new URL(c.req.url).pathname;
      const idx = raw.indexOf(prefix);
      let path: string;
      try {
         path = decodeURIComponent(raw.slice(idx + prefix.length));
      } catch {
         throw new HttpError(400, "bad path");
      }
      if (!path || path.includes("..") || path.startsWith("/") || path.length > 512) throw new HttpError(404);
      const variant = parseVariantQuery(new URL(c.req.url).searchParams);
      if (variant === "bad") throw new HttpError(400, "w must be 1–1600 and f one of avif, webp, jpeg, png");
      // Only files bknd's media module knows about (not arbitrary bucket keys).
      const known = await c.env.DB.prepare("SELECT mime_type FROM media WHERE path = ?1 LIMIT 1")
         .bind(path)
         .first<{ mime_type: string | null }>();
      if (!known) throw new HttpError(404);
      if (variant) {
         // A made variant is immutable like the original. One that isn't made yet: the original
         // answers with a short cache, and the job is queued (an insert + send; never made here).
         const made = await c.env.MEDIA.get(variantKey(path, variant.width, variant.format));
         if (made) {
            const headers = new Headers(corsHeaders(c.env, c.req.header("Origin")));
            headers.set("ETag", made.httpEtag);
            headers.set("Cache-Control", MEDIA_CACHE);
            headers.set("Content-Type", VARIANT_TYPES[variant.format]);
            headers.set("X-Content-Type-Options", "nosniff");
            headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
            headers.set("X-Variant", "hit");
            if (c.req.header("If-None-Match") === made.httpEtag) return new Response(null, { status: 304, headers });
            return new Response(c.req.method === "HEAD" ? null : made.body, { headers });
         }
         c.executionCtx.waitUntil(enqueueVariants(c.env, path).catch((e) => console.error("variant enqueue failed", String(e))));
      }
      const obj = await c.env.MEDIA.get(path);
      if (!obj) throw new HttpError(404);
      const headers = new Headers(corsHeaders(c.env, c.req.header("Origin")));
      obj.writeHttpMetadata(headers);
      headers.set("ETag", obj.httpEtag);
      headers.set("Cache-Control", variant ? PENDING_CACHE : MEDIA_CACHE);
      if (variant) headers.set("X-Variant", "pending");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
      // bknd's R2 adapter stores no httpMetadata; serve the type bknd recorded, images only.
      const type = (headers.get("Content-Type") || known.mime_type || "").toLowerCase();
      headers.set("Content-Type", MEDIA_TYPES.has(type) ? type : "application/octet-stream");
      if (c.req.header("If-None-Match") === obj.httpEtag) return new Response(null, { status: 304, headers });
      return new Response(c.req.method === "HEAD" ? null : obj.body, { headers });
   });

   api.notFound((c) => errorJson(c, new HttpError(404)));
   api.onError((err, c) => {
      if (err instanceof HttpError) return errorJson(c, err);
      console.error("public api error", err instanceof Error ? err.message : String(err));
      return c.json({ error: "internal_error" }, 500, { "Cache-Control": "no-store", ...corsHeaders(c.env, c.req.header("Origin")) });
   });
   return api;
}

function errorJson(c: Context<{ Bindings: Env }>, err: HttpError): Response {
   const body: { error: string; message?: string } = { error: err.code };
   if (err.message !== err.code) body.message = err.message;
   return c.json(body, err.status, {
      // Short shared caching for 404s keeps a hot missing slug off D1; 400s are not cached.
      "Cache-Control": err.status === 404 ? "public, s-maxage=30" : "no-store",
      ...corsHeaders(c.env, c.req.header("Origin")),
   });
}
