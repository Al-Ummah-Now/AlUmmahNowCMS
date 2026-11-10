/**
 * Public scholar endpoints (docs/PUBLIC_API.md "Scholars", docs/SCHOLARS.md §3). Mounted on the
 * public API (src/routes/public-api.ts) with its helpers, so caching, ETags, CORS and errors are the
 * same as every other public read.
 *
 *   GET /scholars?locale=&page=&limit=           the directory: { items: ScholarSummary[], page, limit, total }
 *   GET /scholars/:slug?locale=&page=&limit=     { scholar: Scholar, posts: { items: PostSummary[], page, limit, total }, post_counts: { en, ar } }
 *   GET /scholars/by-channel/:channelId          { slug, name_en, name_ar } of the scholar who linked that channel
 *   GET /search/scholars?locale=&q=&limit=       scholars whose name or address matches (search suggestions)
 *
 * A scholar's page lists every live post they wrote, featured or not (MAIN_SITE_SQL does not apply).
 */
import type { Context, Hono } from "hono";
import type { Env } from "../env.ts";
import { mediaByIds } from "../lib/blocks-public.ts";
import type { MediaRef } from "../lib/media-ref.ts";
import { LIVE_SQL } from "../lib/schedule.ts";
import { CHANNEL_ID_RE, listScholars, scholarBio, scholarByChannel, scholarBySlug, scholarName, type Scholar } from "../lib/scholars/profiles.ts";
import { normalizeSearchText } from "../lib/search/normalize.ts";

type Locale = "en" | "ar";
type Row = Record<string, unknown>;
type C = Context<{ Bindings: Env }>;

export interface ScholarHelpers {
   json: (c: C, data: unknown, cache?: string) => Promise<Response>;
   locale: (c: C) => Locale;
   intParam: (raw: string | undefined, def: number, min: number, max: number, name: string) => number;
   postSummaries: (env: Env, rows: Row[]) => Promise<unknown[]>;
   HttpError: new (status: 400 | 404, message?: string) => Error;
   CACHE: string;
}

/** Columns of a post summary (the same as POST_SUMMARY_COLS in public-api.ts, kept local to avoid a cycle). */
const COLS = "id, slug, locale, title, excerpt, author_name, author_sub, tags, kind, slides, published_at, updated_at, created_at";

async function avatars(env: Env, list: Scholar[]): Promise<Map<number, MediaRef>> {
   return mediaByIds(
      env,
      list.flatMap((s) => (s.avatar_media_id ? [s.avatar_media_id] : [])),
   );
}

function summaryOf(s: Scholar, l: Locale, avatar: MediaRef | null) {
   const bio = scholarBio(s, l);
   return {
      slug: s.slug,
      name: scholarName(s, l),
      name_en: s.name_en,
      name_ar: s.name_ar,
      // Plain text, at most a few lines on the directory; the page has the whole bio.
      bio_excerpt: bio ? (bio.length > 200 ? `${bio.slice(0, 199).trimEnd()}…` : bio) : null,
      avatar,
      updated_at: s.updated_at,
   };
}

export function scholarRoutes(api: Hono<{ Bindings: Env }>, h: ScholarHelpers): void {
   api.get("/scholars", async (c) => {
      const l = h.locale(c);
      const page = h.intParam(c.req.query("page"), 1, 1, 10_000, "page");
      const limit = h.intParam(c.req.query("limit"), 24, 1, 48, "limit");
      const { items, total } = await listScholars(c.env.DB, { limit, offset: (page - 1) * limit });
      const pics = await avatars(c.env, items);
      return h.json(c, {
         items: items.map((s) => ({ ...summaryOf(s, l, s.avatar_media_id ? (pics.get(s.avatar_media_id) ?? null) : null), post_count: s.posts })),
         page,
         limit,
         total,
      });
   });

   api.get("/scholars/by-channel/:channelId", async (c) => {
      const id = c.req.param("channelId");
      if (!CHANNEL_ID_RE.test(id)) throw new h.HttpError(404);
      const s = await scholarByChannel(c.env.DB, id);
      if (!s) throw new h.HttpError(404);
      return h.json(c, { slug: s.slug, name_en: s.name_en, name_ar: s.name_ar });
   });

   api.get("/scholars/:slug", async (c) => {
      const l = h.locale(c);
      const page = h.intParam(c.req.query("page"), 1, 1, 10_000, "page");
      const limit = h.intParam(c.req.query("limit"), 12, 1, 24, "limit");
      const s = await scholarBySlug(c.env.DB, c.req.param("slug"));
      if (!s) throw new h.HttpError(404);
      const [rows, counts, pics] = await Promise.all([
         c.env.DB.prepare(`SELECT ${COLS} FROM posts WHERE author_sub = ?1 AND locale = ?2 AND ${LIVE_SQL} ORDER BY published_at DESC, id DESC LIMIT ?3 OFFSET ?4`)
            .bind(s.sso_sub, l, limit, (page - 1) * limit)
            .all<Row>(),
         c.env.DB.prepare(`SELECT locale, COUNT(*) AS n FROM posts WHERE author_sub = ?1 AND ${LIVE_SQL} GROUP BY locale`).bind(s.sso_sub).all<{ locale: string; n: number }>(),
         avatars(c.env, [s]),
      ]);
      const count = (x: Locale) => Number(counts.results.find((r) => r.locale === x)?.n ?? 0);
      return h.json(c, {
         scholar: {
            ...summaryOf(s, l, s.avatar_media_id ? (pics.get(s.avatar_media_id) ?? null) : null),
            bio: scholarBio(s, l),
            bio_en: s.bio_en,
            bio_ar: s.bio_ar,
            // Their own channels on the videos platform (www lists their public videos from there).
            channel_ids: s.channel_ids,
            created_at: s.created_at,
         },
         posts: { items: await h.postSummaries(c.env, rows.results), page, limit, total: count(l) },
         post_counts: { en: count("en"), ar: count("ar") },
      });
   });

   api.get("/search/scholars", async (c) => {
      const raw = c.req.query("locale") ?? c.req.query("lang");
      if (raw !== "en" && raw !== "ar") throw new h.HttpError(400, "locale must be en or ar");
      const limit = h.intParam(c.req.query("limit"), 3, 1, 10, "limit");
      const q = (c.req.query("q") ?? "").trim().slice(0, 100);
      if (normalizeSearchText(q).length < 2) return h.json(c, [], h.CACHE);
      const { items } = await listScholars(c.env.DB, { q, limit });
      const pics = await avatars(c.env, items);
      return h.json(
         c,
         items.map((s) => {
            const pic = s.avatar_media_id ? pics.get(s.avatar_media_id) : undefined;
            return {
               type: "scholar",
               slug: s.slug,
               title: scholarName(s, raw),
               href: `/${raw}/scholars/${encodeURIComponent(s.slug)}/`,
               thumbnailUrl: pic ? `${pic.url}?w=160&f=webp` : null,
               post_count: s.posts,
            };
         }),
         h.CACHE,
      );
   });
}
