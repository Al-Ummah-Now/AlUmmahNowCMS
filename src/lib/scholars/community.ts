/**
 * A scholar's article is also a community post on their channel (docs/SCHOLARS.md §4).
 *
 * Every change to a scholar post (publish, edit, unpublish, schedule, delete, restore, going live)
 * calls noteCommunityChange, which only writes what the community post should now be into
 * `community_links` (want 'show' or 'hide', state 'pending'). syncCommunity then makes it so through
 * api-videos (src/lib/scholars/videos-internal.ts): right after the save (waitUntil) and from the
 * every-minute cron, so a failed call is retried with backoff and never blocks or fails the save.
 *
 * Idempotent: the community post is keyed by the CMS post (`cms-<id>`), so re-publishing updates
 * the same post, and its id is stored on the link and on posts.community_post_id. A post that never
 * went out is never "hidden" (no call at all).
 */
import type { Env } from "../../env.ts";
import { trimSlash } from "../../env.ts";
import { errText, log } from "../log.ts";
import { mediaUrl } from "../media-ref.ts";
import { LIVE_SQL } from "../schedule.ts";
import { scholarOfSub } from "./profiles.ts";
import { hideArticlePost, upsertArticlePost, VideosInternalError } from "./videos-internal.ts";

export const MAX_ATTEMPTS = 8;
export const SYNC_BATCH = 10;
const EXCERPT_MAX = 280;

export const externalIdOf = (postId: number) => `cms-${postId}`;

/** Backoff after the n-th failure in a row: 1, 2, 4 … minutes, at most 6 hours. */
export function backoffMs(attempts: number): number {
   return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60 * 1000);
}

type Row = Record<string, unknown>;

/** Records what each post's community post should now be. DB only; cheap; never throws. */
export async function noteCommunityChange(env: Env, postIds: number[]): Promise<void> {
   const ids = [...new Set(postIds)].filter((n) => Number.isSafeInteger(n) && n > 0);
   if (!ids.length) return;
   try {
      const at = new Date().toISOString();
      for (const id of ids) {
         const [row, link] = await Promise.all([
            env.DB.prepare(`SELECT id, author_sub, (${LIVE_SQL}) AS live FROM posts WHERE id = ?1`).bind(id).first<Row>(),
            env.DB.prepare("SELECT post_id, author_sub, want, state FROM community_links WHERE post_id = ?1").bind(id).first<Row>(),
         ]);
         const sub = typeof row?.author_sub === "string" && row.author_sub ? row.author_sub : null;
         const want = row && sub && Number(row.live) === 1 ? "show" : "hide";
         // Nothing went out and nothing should: no row, no call.
         if (!link && want === "hide") continue;
         await env.DB.prepare(
            `INSERT INTO community_links (post_id, author_sub, want, state, attempts, next_attempt_at, updated_at) VALUES (?1, ?2, ?3, 'pending', 0, ?4, ?4)
             ON CONFLICT (post_id) DO UPDATE SET want = excluded.want, author_sub = coalesce(?5, community_links.author_sub), state = 'pending', attempts = 0, next_attempt_at = excluded.next_attempt_at, last_error = NULL, updated_at = excluded.updated_at`,
         )
            .bind(id, sub ?? String(link?.author_sub ?? ""), want, at, sub)
            .run();
      }
   } catch (error) {
      log.error("community change not recorded", { post_ids: ids, error: errText(error) });
   }
}

/** Every post of a scholar again (their channel changed: posts move to the new one). */
export async function requeueScholarPosts(env: Env, sub: string): Promise<void> {
   const { results } = await env.DB.prepare("SELECT id FROM posts WHERE author_sub = ?1 UNION SELECT post_id AS id FROM community_links WHERE author_sub = ?1").bind(sub).all<{ id: number }>();
   await noteCommunityChange(
      env,
      results.map((r) => Number(r.id)),
   );
}

function excerptOf(row: Row): string | null {
   const raw = typeof row.excerpt === "string" && row.excerpt.trim() ? row.excerpt : typeof row.body === "string" ? row.body : "";
   const text = raw
      .replace(/^::video\[[^\]]*\]\s*$/gm, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/[#>*_`~]/g, "")
      .replace(/\s+/g, " ")
      .trim();
   if (!text) return null;
   return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : text;
}

async function coverUrl(env: Env, postId: number): Promise<string | null> {
   const m = await env.DB.prepare("SELECT path FROM media WHERE reference = 'posts.cover' AND entity_id = ?1 ORDER BY id LIMIT 1").bind(String(postId)).first<{ path: string | null }>();
   return m?.path ? mediaUrl(env.PUBLIC_URL, m.path) : null;
}

export interface SyncResult {
   shown: number;
   hidden: number;
   failed: number;
   waiting: number;
}

/** Works the due links (bounded). Safe to run concurrently: each link is claimed first. */
export async function syncCommunity(env: Env, opts: { limit?: number; now?: number; fetch?: typeof fetch } = {}): Promise<SyncResult> {
   const now = opts.now ?? Date.now();
   const out: SyncResult = { shown: 0, hidden: 0, failed: 0, waiting: 0 };
   const { results } = await env.DB.prepare(
      "SELECT * FROM community_links WHERE state = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?1) ORDER BY next_attempt_at LIMIT ?2",
   )
      .bind(new Date(now).toISOString(), opts.limit ?? SYNC_BATCH)
      .all<Row>();
   for (const link of results) {
      const postId = Number(link.post_id);
      // Claim: push next_attempt_at out a little, only if nobody touched the row since we read it.
      const claim = await env.DB.prepare("UPDATE community_links SET next_attempt_at = ?3 WHERE post_id = ?1 AND updated_at = ?2 AND state = 'pending' RETURNING post_id")
         .bind(postId, link.updated_at, new Date(now + 5 * 60_000).toISOString())
         .first();
      if (!claim) continue;
      try {
         const result = await syncOne(env, link, opts.fetch ?? fetch);
         out[result] += 1;
      } catch (error) {
         out.failed += 1;
         const attempts = Number(link.attempts ?? 0) + 1;
         const permanent = error instanceof VideosInternalError && error.permanent;
         const dead = permanent || attempts >= MAX_ATTEMPTS;
         const code = error instanceof VideosInternalError ? error.code : "error";
         await env.DB.prepare("UPDATE community_links SET state = ?2, attempts = ?3, next_attempt_at = ?4, last_error = ?5 WHERE post_id = ?1 AND updated_at = ?6")
            .bind(postId, dead ? "dead" : "pending", attempts, dead ? null : new Date(now + backoffMs(attempts)).toISOString(), code, link.updated_at)
            .run();
         log.warn("community sync failed", { post_id: postId, attempts, dead, error: errText(error) });
      }
   }
   return out;
}

async function done(env: Env, link: Row, fields: { channel_id?: string | null; community_post_id?: string | null; state?: string; last_error?: string | null }): Promise<void> {
   await env.DB.prepare(
      "UPDATE community_links SET state = ?3, channel_id = coalesce(?4, channel_id), community_post_id = ?5, attempts = 0, next_attempt_at = NULL, last_error = ?6 WHERE post_id = ?1 AND updated_at = ?2",
   )
      .bind(link.post_id, link.updated_at, fields.state ?? "ok", fields.channel_id ?? null, fields.community_post_id === undefined ? (link.community_post_id ?? null) : fields.community_post_id, fields.last_error ?? null)
      .run();
}

async function syncOne(env: Env, link: Row, fetchImpl: typeof fetch): Promise<"shown" | "hidden" | "waiting"> {
   const postId = Number(link.post_id);
   const sub = String(link.author_sub ?? "");
   const row = link.want === "show" ? await env.DB.prepare(`SELECT *, (${LIVE_SQL}) AS live FROM posts WHERE id = ?1`).bind(postId).first<Row>() : null;
   if (link.want === "show" && row && Number(row.live) === 1 && sub) {
      const scholar = await scholarOfSub(env.DB, sub);
      const channelId = scholar?.channel_ids[0] ?? null;
      if (!channelId) {
         // No channel linked yet: nothing to post. Linking one requeues every post (requeueScholarPosts).
         await done(env, link, { state: "no_channel", last_error: "no_channel" });
         return "waiting";
      }
      const locale = row.locale === "ar" ? "ar" : "en";
      const res = await upsertArticlePost(
         env,
         sub,
         externalIdOf(postId),
         {
            channelId,
            title: String(row.title ?? ""),
            excerpt: excerptOf(row),
            coverUrl: await coverUrl(env, postId),
            url: `${trimSlash(env.WWW_URL)}/${locale}/articles/${encodeURIComponent(String(row.slug))}/`,
            locale,
            publishedAt: typeof row.published_at === "string" ? row.published_at : row.published_at instanceof Date ? row.published_at.toISOString() : null,
         },
         fetchImpl,
      );
      await done(env, link, { channel_id: res.channelId, community_post_id: res.postId });
      await env.DB.prepare("UPDATE posts SET community_post_id = ?2 WHERE id = ?1").bind(postId, res.postId).run();
      return "shown";
   }
   // Hide (unpublished, scheduled, deleted, or no longer a scholar post).
   if (link.community_post_id) await hideArticlePost(env, sub, externalIdOf(postId), fetchImpl);
   await done(env, link, {});
   return "hidden";
}

/** Links that gave up (Overview flag) and a retry for them. */
export async function deadLinks(db: D1Database): Promise<number> {
   const r = await db.prepare("SELECT COUNT(*) AS n FROM community_links WHERE state = 'dead'").first<{ n: number }>();
   return Number(r?.n ?? 0);
}

export async function retryDeadLinks(db: D1Database): Promise<number> {
   const res = await db.prepare("UPDATE community_links SET state = 'pending', attempts = 0, next_attempt_at = ?1, updated_at = ?1 WHERE state = 'dead'").bind(new Date().toISOString()).run();
   return Number(res.meta.changes ?? 0);
}
