/**
 * Scholar post references (docs/SCHOLARS.md §7, wiki AUN-SCHOLAR-SITES §6.3, decisions SS6 and SS8).
 *
 * A scholar's posts are community posts on their PRIMARY channel (videos platform). For each public one,
 * the CMS keeps a hidden row in `posts` (ref_post_id set): www's address (slug, locale, translation key),
 * the editorial state (featured_at, show_on_timeline, tags, page entries) and a summary cache
 * (summary_json, post-schema postSummary) for lists, the home timeline and search. Never a copy of the
 * content: www's post page reads the community post itself (src/routes/public-api.ts postOf).
 *
 * Refs are written by api-videos' processor (the outbox, AlUmmahNow apps/processor/src/handlers/
 * scholar-refs.ts) through /internal/refs (src/routes/internal-refs.ts), on every create, edit and
 * delete. No opt-out: every public post on a primary channel gets one; editors decide what to feature.
 *
 * Reads stay on indexes: scholars.primary_channel_id, posts.ref_post_id (unique), posts (slug, locale).
 */
import type { Env } from "../../env.ts";
import { trimSlash } from "../../env.ts";
import { markDirty } from "../feed/jobs.ts";
import { slugify, slugCandidates } from "../slug.ts";
import { isPostKind, isPublicPost, postSummary, type PostLike, type PostSummaryV2 } from "../post-schema.generated.ts";
import { scholarName } from "./profiles.ts";

type Row = Record<string, unknown>;

export const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export class RefError extends Error {
   constructor(
      readonly status: 400 | 404 | 409,
      readonly code: string,
   ) {
      super(code);
      this.name = "RefError";
   }
}

export type RefResult = { status: "ignored" } | { status: "ok"; id: number; slug: string; locale: "en" | "ar"; url: string; created: boolean };

/** The scholar whose primary channel this is, or null (most channels are no scholar's). */
export async function scholarByPrimaryChannel(db: D1Database, channelId: string): Promise<Row | null> {
   return db.prepare("SELECT id, sso_sub, slug, name_en, name_ar FROM scholars WHERE primary_channel_id = ?1 ORDER BY id LIMIT 1").bind(channelId).first<Row>();
}

/**
 * Fills primary_channel_id from channel_ids[0] for scholars that have none yet (migrations never
 * rewrite data). Index lookup on primary_channel_id IS NULL; cheap enough for the cron.
 */
export async function fillPrimaryChannels(db: D1Database): Promise<number> {
   const res = await db
      .prepare(
         `UPDATE scholars SET primary_channel_id = json_extract(channel_ids, '$[0]')
          WHERE primary_channel_id IS NULL AND json_valid(channel_ids) AND json_array_length(channel_ids) > 0`,
      )
      .run();
   return Number(res.meta?.changes ?? 0);
}

/** www's address for a post (every kind uses the post route). */
export const wwwPostUrl = (env: Env, locale: string, slug: string) => `${trimSlash(env.WWW_URL || "https://www.alummahnow.net")}/${locale}/articles/${encodeURIComponent(slug)}/`;

/** A title for a post that has none of its own (a GIF): the scholar's name and the date. */
function fallbackTitle(scholar: Row, locale: "en" | "ar", at: string): string {
   const name = scholarName({ name_en: (scholar.name_en as string | null) ?? null, name_ar: (scholar.name_ar as string | null) ?? null, slug: String(scholar.slug) }, locale);
   const day = new Date(at);
   const date = Number.isNaN(day.getTime()) ? "" : day.toLocaleDateString(locale === "ar" ? "ar" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
   return date ? `${name} · ${date}` : name;
}

/** A free slug for a new ref: the post's wanted slug, else one from its title, else post-<id>. */
async function freeSlug(db: D1Database, locale: string, wanted: string): Promise<string> {
   const candidates = slugCandidates(wanted, 20);
   const marks = candidates.map((_, i) => `?${i + 2}`).join(",");
   const { results } = await db.prepare(`SELECT slug FROM posts WHERE locale = ?1 AND slug IN (${marks})`).bind(locale, ...candidates).all<{ slug: string }>();
   const taken = new Set(results.map((r) => r.slug));
   return candidates.find((c) => !taken.has(c)) ?? `${wanted.slice(0, 40)}-${crypto.randomUUID().slice(0, 8)}`;
}

/** Checks the outbox body: the post must be the one in the URL, on the named channel. Pure. */
export function parseRefBody(postId: string, body: unknown): { channelId: string; post: PostLike } {
   if (!ID_RE.test(postId)) throw new RefError(400, "bad_request");
   const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
   const channelId = typeof b.channelId === "string" && ID_RE.test(b.channelId) ? b.channelId : "";
   const post = b.post && typeof b.post === "object" ? (b.post as PostLike) : null;
   if (!channelId || !post || post.id !== postId || post.channelId !== channelId || !isPostKind(post.type)) throw new RefError(400, "bad_request");
   return { channelId, post };
}

const iso = (v: unknown): string | null => {
   if (typeof v !== "string" || !v) return null;
   const d = new Date(v);
   return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * Creates or refreshes the ref for a community post. A ref keeps its slug for life (www addresses
 * never change); the title, kind, summary, language and dates follow the post. A CMS article whose
 * link-only mirror this is, and which has not been converted yet, is left alone: the conversion
 * (scripts/ops/convert-scholar-posts.ts) turns that row into the ref, keeping its slug.
 */
export async function upsertRef(env: Env, postId: string, channelId: string, post: PostLike): Promise<RefResult> {
   if (!isPublicPost(post)) return removeRef(env, postId, channelId).then(() => ({ status: "ignored" }) as const);
   const scholar = await scholarByPrimaryChannel(env.DB, channelId);
   if (!scholar) return { status: "ignored" };
   const ext = /^cms-(\d{1,12})$/.exec(post.article?.externalId ?? "");
   const existing = await env.DB.prepare("SELECT id, slug, locale, published_at, featured_at FROM posts WHERE ref_post_id = ?1").bind(postId).first<Row>();
   if (!existing && ext) {
      const mirror = await env.DB.prepare("SELECT id FROM posts WHERE id = ?1 AND ref_post_id IS NULL").bind(Number(ext[1])).first<Row>();
      if (mirror) return { status: "ignored" };
   }

   const summary: PostSummaryV2 = postSummary(post);
   const locale = summary.locale;
   const now = new Date().toISOString();
   const createdAt = iso(post.createdAt) ?? now;
   const title = (summary.title || fallbackTitle(scholar, locale, createdAt)).slice(0, 200);
   const scheduled = post.status === "scheduled" ? iso(post.scheduledAt) : null;
   const key = typeof post.translationKey === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(post.translationKey) ? post.translationKey : null;
   const tags = JSON.stringify(Array.isArray((post as { tags?: unknown }).tags) ? ((post as { tags: unknown[] }).tags.filter((t) => typeof t === "string").slice(0, 20)) : []);
   const kind = summary.kind;
   const sub = String(scholar.sso_sub);
   const summaryJson = JSON.stringify(summary);

   if (existing) {
      const id = Number(existing.id);
      // The language never moves a ref (its address is /<locale>/…); a post edited into the other
      // language keeps its www locale.
      await env.DB.prepare(
         `UPDATE posts SET title = ?2, excerpt = ?3, kind = ?4, summary_json = ?5, ref_channel_id = ?6, author_sub = ?7,
             status = 'published', publish_at = ?8, translation_key = coalesce(?9, translation_key), updated_at = ?10,
             published_at = coalesce(published_at, ?11)
          WHERE id = ?1`,
      )
         .bind(id, title, summary.excerpt, kind, summaryJson, channelId, sub, scheduled, key, now, createdAt)
         .run();
      if (existing.featured_at) await markDirty(env, [`p${id}`], "scholar post changed");
      const slug = String(existing.slug);
      const l = existing.locale === "ar" ? "ar" : "en";
      return { status: "ok", id, slug, locale: l, url: wwwPostUrl(env, l, slug), created: false };
   }

   const wanted = (typeof post.slug === "string" && post.slug) || slugify(title, 80) || `post-${postId.slice(0, 8).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
   for (let attempt = 0; attempt < 3; attempt++) {
      const slug = await freeSlug(env.DB, locale, wanted);
      try {
         const row = await env.DB.prepare(
            `INSERT INTO posts (slug, locale, translation_key, title, excerpt, body, status, published_at, publish_at, tags, kind, show_on_timeline,
                author_sub, ref_post_id, ref_channel_id, summary_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, '', 'published', ?6, ?7, ?8, ?9, 1, ?10, ?11, ?12, ?13, ?14, ?14)
             ON CONFLICT (ref_post_id) DO NOTHING
             RETURNING id`,
         )
            .bind(slug, locale, key, title, summary.excerpt, createdAt, scheduled, tags, kind, sub, postId, channelId, summaryJson, now)
            .first<{ id: number }>();
         if (!row) {
            // A concurrent sync created it: answer with that one.
            const again = await env.DB.prepare("SELECT id, slug, locale FROM posts WHERE ref_post_id = ?1").bind(postId).first<Row>();
            if (!again) throw new RefError(409, "conflict");
            const l = again.locale === "ar" ? "ar" : "en";
            return { status: "ok", id: Number(again.id), slug: String(again.slug), locale: l, url: wwwPostUrl(env, l, String(again.slug)), created: false };
         }
         return { status: "ok", id: Number(row.id), slug, locale, url: wwwPostUrl(env, locale, slug), created: true };
      } catch (error) {
         // The slug was taken between the check and the insert: pick again.
         if (!/UNIQUE/i.test(String(error)) || attempt === 2) throw error;
      }
   }
   throw new RefError(409, "conflict");
}

/**
 * The post is gone, unpublished or no longer public: its ref leaves www (status draft, so the address
 * answers 404 and every list drops it). The row is kept, so a post published again gets the same
 * address and featuring back. Featured refs drop off the timeline on the next build.
 */
export async function removeRef(env: Env, postId: string, channelId: string | null): Promise<{ status: "ok" | "ignored" }> {
   if (!ID_RE.test(postId)) throw new RefError(400, "bad_request");
   const row = await env.DB.prepare("SELECT id, ref_channel_id, status, featured_at FROM posts WHERE ref_post_id = ?1").bind(postId).first<Row>();
   if (!row) return { status: "ignored" };
   if (channelId && row.ref_channel_id && row.ref_channel_id !== channelId) throw new RefError(400, "bad_request");
   if (row.status !== "draft") {
      await env.DB.prepare("UPDATE posts SET status = 'draft', updated_at = ?2 WHERE id = ?1").bind(Number(row.id), new Date().toISOString()).run();
      await markDirty(env, [`p${Number(row.id)}`], "scholar post removed");
   }
   return { status: "ok" };
}

export { refSummary } from "./ref-summary.ts";
