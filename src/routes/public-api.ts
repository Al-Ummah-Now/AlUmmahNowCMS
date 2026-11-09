/**
 * Public read API v1 (docs/PUBLIC_API.md, SPEC §6). The only unauthenticated surface besides
 * /healthz. Reads D1 directly (no bknd boot) and EVERY content query filters
 * `status = 'published'`: drafts are never serialized.
 */
import { Hono, type Context } from "hono";
import type { Env } from "../env.ts";

type Locale = "en" | "ar";
type Row = Record<string, unknown>;

export interface MediaRef {
   url: string;
   alt: string | null;
   width: number | null;
   height: number | null;
}

const CACHE = "public, s-maxage=60, stale-while-revalidate=600";
const MEDIA_CACHE = "public, max-age=31536000, immutable";
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

export function mediaUrl(publicUrl: string, path: string): string {
   return `${publicUrl.replace(/\/+$/, "")}/api/public/v1/media/${path.split("/").map(encodeURIComponent).join("/")}`;
}

async function covers(env: Env, entity: "pages" | "posts", ids: unknown[]): Promise<Map<string, MediaRef>> {
   const out = new Map<string, MediaRef>();
   if (ids.length === 0) return out;
   const keys = ids.map(String);
   const { results } = await env.DB.prepare(
      `SELECT entity_id, path, metadata FROM media WHERE reference = ?1 AND entity_id IN (${keys.map((_, i) => `?${i + 2}`).join(",")}) ORDER BY id`,
   )
      .bind(`${entity}.cover`, ...keys)
      .all<{ entity_id: string; path: string; metadata: unknown }>();
   for (const m of results) {
      if (out.has(m.entity_id) || !m.path) continue;
      const meta = parseJson<Row>(m.metadata, {});
      const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
      out.set(m.entity_id, {
         url: mediaUrl(env.PUBLIC_URL, m.path),
         alt: strOrNull(meta.alt),
         width: num(meta.width),
         height: num(meta.height),
      });
   }
   return out;
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

function curatedOf(r: Row) {
   const snap = parseJson<Row | null>(r.snapshot, null);
   return {
      id: Number(r.id),
      kind: r.kind as "video" | "playlist" | "channel",
      ref_id: String(r.ref_id),
      title_override: strOrNull(r.title_override),
      snapshot:
         snap && typeof snap.title === "string"
            ? { title: snap.title, thumbnail_url: isHttps(snap.thumbnail_url) ? (snap.thumbnail_url as string) : null, channel_name: strOrNull(snap.channel_name) }
            : null,
      sort: Number(r.sort ?? 0),
   };
}

/** Most curated rows served per placement: www resolves each one, so the list must stay bounded (audit CMS-4/UI-1). */
export const CURATED_MAX = 48;

async function curated(env: Env, l: Locale, placement: "home" | "videos") {
   const { results } = await env.DB.prepare(
      `SELECT id, kind, ref_id, title_override, snapshot, sort FROM curated_videos
       WHERE placement = ?1 AND status = 'published' AND (locale = ?2 OR locale = 'all' OR locale IS NULL)
       ORDER BY sort, id
       LIMIT ?3`,
   )
      .bind(placement, l, CURATED_MAX)
      .all<Row>();
   return results.map(curatedOf);
}

const POST_SUMMARY_COLS = "id, slug, locale, title, excerpt, author_name, tags, published_at, updated_at, created_at";

async function postSummaries(env: Env, rows: Row[]) {
   const cov = await covers(
      env,
      "posts",
      rows.map((r) => r.id),
   );
   return rows.map((r) => postSummaryOf(r, cov.get(String(r.id)) ?? null));
}

function postSummaryOf(r: Row, cover: MediaRef | null) {
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
   };
}

async function alternates(env: Env, table: "pages" | "posts", key: unknown, l: Locale) {
   if (typeof key !== "string" || key === "") return [];
   const { results } = await env.DB.prepare(
      `SELECT locale, slug FROM ${table} WHERE translation_key = ?1 AND status = 'published' AND locale <> ?2 ORDER BY locale`,
   )
      .bind(key, l)
      .all<{ locale: Locale; slug: string }>();
   return results.map((r) => ({ locale: r.locale, slug: r.slug }));
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
            `SELECT ${POST_SUMMARY_COLS} FROM posts WHERE locale = ?1 AND status = 'published' ORDER BY published_at DESC, id DESC LIMIT 3`,
         )
            .bind(l)
            .all<Row>(),
      ]);
      return json(c, { settings: settingsOf(settings), videos, posts: await postSummaries(c.env, posts.results) });
   });

   api.get("/pages/:slug", async (c) => {
      const l = locale(c);
      const row = await c.env.DB.prepare("SELECT * FROM pages WHERE slug = ?1 AND locale = ?2 AND status = 'published' LIMIT 1")
         .bind(c.req.param("slug"), l)
         .first<Row>();
      if (!row) throw new HttpError(404);
      const [cov, alts] = await Promise.all([covers(c.env, "pages", [row.id]), alternates(c.env, "pages", row.translation_key, l)]);
      const published = toIso(row.published_at) ?? toIso(row.created_at) ?? new Date(0).toISOString();
      return json(c, {
         slug: String(row.slug),
         locale: row.locale,
         title: String(row.title ?? ""),
         summary: strOrNull(row.summary),
         body: typeof row.body === "string" ? row.body : "",
         seo_title: strOrNull(row.seo_title),
         seo_description: strOrNull(row.seo_description),
         cover: cov.get(String(row.id)) ?? null,
         published_at: published,
         updated_at: toIso(row.updated_at) ?? published,
         alternates: alts,
      });
   });

   api.get("/posts", async (c) => {
      const l = locale(c);
      const page = intParam(c.req.query("page"), 1, 1, 100_000, "page");
      const limit = intParam(c.req.query("limit"), 10, 1, 20, "limit");
      const [count, rows] = await Promise.all([
         c.env.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE locale = ?1 AND status = 'published'").bind(l).first<{ n: number }>(),
         c.env.DB.prepare(
            `SELECT ${POST_SUMMARY_COLS} FROM posts WHERE locale = ?1 AND status = 'published' ORDER BY published_at DESC, id DESC LIMIT ?2 OFFSET ?3`,
         )
            .bind(l, limit, (page - 1) * limit)
            .all<Row>(),
      ]);
      return json(c, { items: await postSummaries(c.env, rows.results), page, limit, total: Number(count?.n ?? 0) });
   });

   api.get("/posts/:slug", async (c) => {
      const l = locale(c);
      const row = await c.env.DB.prepare("SELECT * FROM posts WHERE slug = ?1 AND locale = ?2 AND status = 'published' LIMIT 1")
         .bind(c.req.param("slug"), l)
         .first<Row>();
      if (!row) throw new HttpError(404);
      const [cov, alts] = await Promise.all([covers(c.env, "posts", [row.id]), alternates(c.env, "posts", row.translation_key, l)]);
      return json(c, {
         ...postSummaryOf(row, cov.get(String(row.id)) ?? null),
         body: typeof row.body === "string" ? row.body : "",
         seo_title: strOrNull(row.seo_title),
         seo_description: strOrNull(row.seo_description),
         alternates: alts,
      });
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
            "SELECT slug, locale, show_in_sitemap, updated_at, published_at, created_at FROM pages WHERE status = 'published' ORDER BY locale, slug",
         ).all<Row>(),
         c.env.DB.prepare(
            "SELECT slug, locale, updated_at, published_at, created_at FROM posts WHERE status = 'published' ORDER BY locale, published_at DESC",
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
      // Only files bknd's media module knows about (not arbitrary bucket keys).
      const known = await c.env.DB.prepare("SELECT mime_type FROM media WHERE path = ?1 LIMIT 1")
         .bind(path)
         .first<{ mime_type: string | null }>();
      if (!known) throw new HttpError(404);
      const obj = await c.env.MEDIA.get(path);
      if (!obj) throw new HttpError(404);
      const headers = new Headers(corsHeaders(c.env, c.req.header("Origin")));
      obj.writeHttpMetadata(headers);
      headers.set("ETag", obj.httpEtag);
      headers.set("Cache-Control", MEDIA_CACHE);
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
