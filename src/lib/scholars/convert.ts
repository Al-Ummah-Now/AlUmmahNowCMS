/**
 * Conversion of existing CMS scholar posts into community posts (docs/SCHOLARS.md §8, wiki
 * AUN-SCHOLAR-SITES §6.6). Runs inside the Worker (it holds the internal key for api-videos), driven
 * by scripts/ops/convert-scholar-posts.ts through POST /api/release/v1/scholar-conversion.
 *
 * Per scholar post (posts.author_sub set, not yet a reference):
 *   1. The full post (article: title, summary, markdown body, cover; cards: title and every card with
 *      its image and alt text) is written to the scholar's primary channel. An article that already
 *      has a link-only community mirror is upgraded IN PLACE (same id, likes and comments); anything
 *      else becomes a new community post. Media is re-referenced (CMS media URLs), never copied.
 *   2. The CMS row becomes the reference: ref_post_id, ref_channel_id, summary_json, kind, and an empty
 *      body/slides. Its slug, locale, translation key, featuring, timeline and page entries are kept,
 *      so www addresses and the home timeline do not change.
 *   3. The original row is kept as a content revision (actor "system:scholar-conversion"): history
 *      shows it, and it is the rollback copy (revisions are kept ≥ 30 days).
 *
 * Left alone (reported): scheduled posts (community posts have no schedule yet), posts of scholars
 * with no channel, posts whose scholar profile is gone.
 *
 * Reads stay on indexes: posts by author_sub (idx … author_sub …) and id, scholars by sso_sub.
 */
import type { Env } from "../../env.ts";
import { trimSlash } from "../../env.ts";
import { markDirty } from "../feed/jobs.ts";
import { serializeRow } from "../revisions.ts";
import { storedSlides } from "../blocks.ts";
import { mediaByIds, publicSlides, slideMediaIds } from "../blocks-public.ts";
import { covers } from "../../routes/public-api.ts";
import { postSummary, type PostLike } from "../post-schema.generated.ts";
import { convertPost, convertedPost, type ConvertBody } from "./videos-internal.ts";

type Row = Record<string, unknown>;

export const CONVERSION_ACTOR = "system:scholar-conversion";
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type Skip = "scheduled" | "no_scholar" | "no_channel";
export interface PlanItem {
   id: number;
   slug: string;
   locale: "en" | "ar";
   kind: "article" | "cards";
   status: "published" | "draft";
   mirror: boolean;
   featured: boolean;
   channel_id: string | null;
   skip: Skip | null;
}

export interface Plan {
   items: PlanItem[];
   counts: { total: number; to_convert: number; articles: number; cards: number; upgrade_in_place: number; new_posts: number; drafts: number; featured: number; skipped: Record<Skip, number> };
   already_converted: number;
}

const iso = (v: unknown): string | null => {
   if (v === null || v === undefined || v === "") return null;
   const d = new Date(String(v));
   return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Every scholar post still to convert, with what will happen to it. Read-only. */
export async function planConversion(env: Env, now = Date.now()): Promise<Plan> {
   const [rows, done] = await Promise.all([
      env.DB.prepare(
         `SELECT p.id, p.slug, p.locale, p.kind, p.status, p.publish_at, p.community_post_id, p.featured_at, p.author_sub, s.id AS s_id, s.primary_channel_id, s.channel_ids
          FROM posts p LEFT JOIN scholars s ON s.sso_sub = p.author_sub
          WHERE p.author_sub IS NOT NULL AND p.ref_post_id IS NULL ORDER BY p.id`,
      ).all<Row>(),
      env.DB.prepare("SELECT COUNT(*) AS n FROM posts WHERE author_sub IS NOT NULL AND ref_post_id IS NOT NULL").first<{ n: number }>(),
   ]);
   const items: PlanItem[] = rows.results.map((r) => {
      let channel = typeof r.primary_channel_id === "string" && r.primary_channel_id ? r.primary_channel_id : null;
      if (!channel && typeof r.channel_ids === "string") {
         try {
            const ids = JSON.parse(r.channel_ids) as unknown;
            channel = Array.isArray(ids) && typeof ids[0] === "string" ? ids[0] : null;
         } catch {
            channel = null;
         }
      }
      const publishAt = iso(r.publish_at);
      const scheduled = r.status === "published" && publishAt !== null && new Date(publishAt).getTime() > now;
      const skip: Skip | null = r.s_id === null || r.s_id === undefined ? "no_scholar" : !channel ? "no_channel" : scheduled ? "scheduled" : null;
      return {
         id: Number(r.id),
         slug: String(r.slug),
         locale: r.locale === "ar" ? "ar" : "en",
         kind: r.kind === "cards" ? "cards" : "article",
         status: r.status === "published" ? "published" : "draft",
         mirror: typeof r.community_post_id === "string" && r.community_post_id !== "",
         featured: !!r.featured_at,
         channel_id: channel,
         skip,
      };
   });
   const go = items.filter((i) => !i.skip);
   const skipped = { scheduled: 0, no_scholar: 0, no_channel: 0 } as Record<Skip, number>;
   for (const i of items) if (i.skip) skipped[i.skip] += 1;
   return {
      items,
      already_converted: Number(done?.n ?? 0),
      counts: {
         total: items.length,
         to_convert: go.length,
         articles: go.filter((i) => i.kind === "article").length,
         cards: go.filter((i) => i.kind === "cards").length,
         upgrade_in_place: go.filter((i) => i.kind === "article" && i.mirror).length,
         new_posts: go.filter((i) => !(i.kind === "article" && i.mirror)).length,
         drafts: go.filter((i) => i.status === "draft").length,
         featured: go.filter((i) => i.featured).length,
         skipped,
      },
   };
}

/** The community post body for one CMS row (pure apart from media lookups). */
export async function convertBody(env: Env, row: Row, channelId: string): Promise<ConvertBody> {
   const locale = row.locale === "ar" ? "ar" : "en";
   const slug = String(row.slug);
   const www = { url: `${trimSlash(env.WWW_URL || "https://www.alummahnow.net")}/${locale}/articles/${encodeURIComponent(slug)}/`, slug, locale } as const;
   const key = typeof row.translation_key === "string" && KEY_RE.test(row.translation_key) ? row.translation_key : undefined;
   const status = row.status === "published" ? "published" : "draft";
   const publishedAt = iso(row.published_at) ?? iso(row.created_at);
   const title = String(row.title ?? "").slice(0, 200);
   if (row.kind === "cards") {
      const stored = storedSlides(row.slides);
      const slides = publicSlides(stored, await mediaByIds(env, slideMediaIds(stored)));
      return {
         channelId,
         kind: "cards",
         locale,
         translationKey: key,
         title,
         slides: slides.map((s) => ({
            id: s.id,
            image: { url: s.image.url, alt: s.image.alt || title, width: s.image.width, height: s.image.height },
            heading: s.heading,
            body: s.body,
            position: s.position,
         })),
         www,
         status,
         publishedAt,
      };
   }
   const cover = (await covers(env, "posts", [row.id])).get(String(row.id)) ?? null;
   const excerpt = typeof row.excerpt === "string" && row.excerpt.trim() ? row.excerpt.trim().slice(0, 300) : null;
   return {
      channelId,
      kind: "article",
      locale,
      translationKey: key,
      article: {
         title,
         excerpt,
         body: typeof row.body === "string" && row.body.trim() ? row.body : title,
         cover: cover ? { url: cover.url, alt: cover.alt, width: cover.width, height: cover.height } : null,
      },
      www,
      status,
      publishedAt,
   };
}

export interface ConvertResult {
   converted: { id: number; post_id: string; upgraded: boolean }[];
   failed: { id: number; error: string }[];
   skipped: { id: number; reason: Skip }[];
}

/** Converts up to `limit` posts (all when no `ids`). Idempotent: converted rows are no longer candidates. */
export async function runConversion(env: Env, opts: { limit?: number; ids?: number[]; fetch?: typeof fetch } = {}): Promise<ConvertResult> {
   const plan = await planConversion(env);
   const want = opts.ids ? new Set(opts.ids) : null;
   const out: ConvertResult = { converted: [], failed: [], skipped: [] };
   for (const item of plan.items) {
      if (want && !want.has(item.id)) continue;
      if (item.skip) {
         out.skipped.push({ id: item.id, reason: item.skip });
         continue;
      }
      if (out.converted.length + out.failed.length >= (opts.limit ?? 25)) break;
      try {
         const row = await env.DB.prepare("SELECT * FROM posts WHERE id = ?1 AND ref_post_id IS NULL").bind(item.id).first<Row>();
         if (!row) continue;
         const body = await convertBody(env, row, item.channel_id!);
         const res = await convertPost(env, String(row.author_sub), `cms-${item.id}`, body, opts.fetch);
         const summary = postSummary(res.post as PostLike);
         const at = new Date().toISOString();
         await env.DB.batch([
            // The rollback copy: the row exactly as it was.
            env.DB.prepare(
               `INSERT INTO content_revisions (entity, entity_id, version, action, actor_id, actor_email, restored_from, changed, snapshot, created_at)
                SELECT 'posts', ?1, coalesce(max(version), 0) + 1, 'update', NULL, ?2, NULL, '["ref_post_id"]', ?3, ?4 FROM content_revisions WHERE entity = 'posts' AND entity_id = ?1`,
            ).bind(item.id, CONVERSION_ACTOR, serializeRow(row), at),
            env.DB.prepare(
               `UPDATE posts SET ref_post_id = ?2, ref_channel_id = ?3, summary_json = ?4, kind = ?5, community_post_id = ?2, body = '', slides = NULL, updated_at = ?6
                WHERE id = ?1 AND ref_post_id IS NULL`,
            ).bind(item.id, res.postId, res.channelId, JSON.stringify(summary), summary.kind, at),
            env.DB.prepare("UPDATE community_links SET state = 'retired', next_attempt_at = NULL, updated_at = ?2 WHERE post_id = ?1").bind(item.id, at),
         ]);
         out.converted.push({ id: item.id, post_id: res.postId, upgraded: res.upgraded });
      } catch (error) {
         out.failed.push({ id: item.id, error: error instanceof Error ? error.message.slice(0, 200) : String(error) });
      }
   }
   if (out.converted.length) await markDirty(env, out.converted.map((c) => `p${c.id}`), "scholar posts converted");
   return out;
}

/* ── The check: every converted post against its original ──────────────────────────────────────── */

const norm = (s: unknown) => (typeof s === "string" ? s.replace(/\r\n?/g, "\n").trim() : "");

async function sha(s: string): Promise<string> {
   const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
   return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

export interface CheckItem {
   id: number;
   post_id: string;
   ok: boolean;
   diffs: string[];
}

/**
 * Compares each converted post (its rollback copy) with the community post now behind it: title,
 * body hash (articles), slide count (cards), slug and locale (www address), featured state, kind.
 */
export async function checkConversion(env: Env, opts: { fetch?: typeof fetch; ids?: number[] } = {}): Promise<{ items: CheckItem[]; ok: number; failed: number }> {
   const { results } = await env.DB.prepare(
      `SELECT r.entity_id AS id, r.snapshot, p.slug, p.locale, p.featured_at, p.ref_post_id, p.author_sub, p.status
       FROM content_revisions r JOIN posts p ON p.id = r.entity_id
       WHERE r.entity = 'posts' AND r.actor_email = ?1 ORDER BY r.entity_id`,
   )
      .bind(CONVERSION_ACTOR)
      .all<Row>();
   const want = opts.ids ? new Set(opts.ids) : null;
   const items: CheckItem[] = [];
   for (const r of results) {
      const id = Number(r.id);
      if (want && !want.has(id)) continue;
      const diffs: string[] = [];
      let before: Row = {};
      try {
         before = JSON.parse(String(r.snapshot)) as Row;
      } catch {
         diffs.push("snapshot unreadable");
      }
      const got = await convertedPost(env, String(r.author_sub), `cms-${id}`, opts.fetch).catch((e: unknown) => {
         diffs.push(`videos: ${e instanceof Error ? e.message : String(e)}`);
         return null;
      });
      const post = got?.post as (PostLike & Record<string, unknown>) | undefined;
      if (!got || !post) diffs.push("community post missing");
      else {
         if (got.postId !== r.ref_post_id) diffs.push(`ref_post_id ${String(r.ref_post_id)} ≠ ${got.postId}`);
         const kind = before.kind === "cards" ? "cards" : "article";
         if (post.type !== kind) diffs.push(`kind ${kind} → ${String(post.type)}`);
         const title = kind === "cards" ? post.title : post.article?.title;
         if (norm(title) !== norm(before.title)) diffs.push("title differs");
         if (kind === "article") {
            const a = await sha(norm(before.body) || norm(before.title));
            const b = await sha(norm(post.article?.body));
            if (a !== b) diffs.push(`body hash ${a} ≠ ${b}`);
         } else {
            const was = storedSlides(before.slides).filter((s) => s.media_id !== null).length;
            const now = Array.isArray(post.slides) ? post.slides.length : 0;
            if (was !== now) diffs.push(`slides ${was} → ${now}`);
         }
         if (post.www?.slug !== r.slug || post.www?.locale !== r.locale) diffs.push("www address differs");
         if (post.status !== (before.status === "published" ? "published" : "draft")) diffs.push(`status ${String(before.status)} → ${String(post.status)}`);
      }
      if (String(before.slug ?? "") !== String(r.slug)) diffs.push(`slug ${String(before.slug)} → ${String(r.slug)}`);
      if (!!before.featured_at !== !!r.featured_at) diffs.push("featured state changed");
      items.push({ id, post_id: String(r.ref_post_id ?? ""), ok: diffs.length === 0, diffs });
   }
   return { items, ok: items.filter((i) => i.ok).length, failed: items.filter((i) => !i.ok).length };
}
