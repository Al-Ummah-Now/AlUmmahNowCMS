/**
 * Featuring (docs/SCHOLARS.md §5): editors and admins put a scholar's article on the main site (home
 * timeline and the Articles list) or take it off again. A scholar's video is featured by adding it to
 * the home timeline (src/lib/feed/admin.ts addVideo / removeVideo, which already log and rebuild).
 *
 * Featuring an article features its translations by the same scholar with it, so both languages of
 * the main site agree. Every feature and unfeature is in the timeline audit log (timeline_changes,
 * shown on the Timeline and Featuring screens) and in the post's own record (featured_by).
 */
import type { Env } from "../../env.ts";
import { logChange, type Actor } from "../feed/admin.ts";
import { markDirty } from "../feed/jobs.ts";
import { LIVE_SQL } from "../schedule.ts";

export class FeatureError extends Error {
   constructor(
      readonly status: 400 | 404 | 409,
      readonly code: string,
   ) {
      super(code);
      this.name = "FeatureError";
   }
}

type Row = Record<string, unknown>;

/** The post and its translations by the same scholar. */
async function family(env: Env, postId: number): Promise<Row[]> {
   const row = await env.DB.prepare("SELECT id, author_sub, translation_key, locale, featured_at FROM posts WHERE id = ?1").bind(postId).first<Row>();
   if (!row) throw new FeatureError(404, "not_found");
   if (!row.author_sub) throw new FeatureError(400, "not_scholar_post");
   if (typeof row.translation_key !== "string" || !row.translation_key) return [row];
   const { results } = await env.DB.prepare("SELECT id, author_sub, translation_key, locale, featured_at FROM posts WHERE translation_key = ?1 AND author_sub = ?2")
      .bind(row.translation_key, row.author_sub)
      .all<Row>();
   return results.length ? results : [row];
}

/** Feature (on = true) or unfeature a scholar's article and its translations. Returns the ids changed. */
export async function setFeatured(env: Env, postId: number, on: boolean, actor: Actor): Promise<number[]> {
   const rows = await family(env, postId);
   const at = new Date().toISOString();
   const changed = rows.filter((r) => (on ? !r.featured_at : !!r.featured_at));
   if (!changed.length) return [];
   const ids = changed.map((r) => Number(r.id));
   const marks = ids.map((_, i) => `?${i + 3}`).join(",");
   await env.DB.batch([
      // Featuring also puts it back on the timeline if someone switched that off; unfeaturing clears
      // its timeline pin (it is no longer on the timeline at all).
      on
         ? env.DB.prepare(`UPDATE posts SET featured_at = ?1, featured_by = ?2, show_on_timeline = 1 WHERE id IN (${marks})`).bind(at, actor.email, ...ids)
         : env.DB.prepare(`UPDATE posts SET featured_at = NULL, featured_by = ?2 WHERE id IN (${marks})`).bind(at, actor.email, ...ids),
      ...(on ? [] : [env.DB.prepare(`UPDATE timeline_entries SET pin_rank = NULL, updated_at = ?1, updated_by = ?2 WHERE kind = 'post' AND post_id IN (${marks})`).bind(at, actor.email, ...ids)]),
   ]);
   for (const r of changed) await logChange(env, actor, on ? "feature" : "unfeature", `p${r.id}`, String(r.locale ?? ""), { featured: on });
   await markDirty(
      env,
      ids.map((id) => `p${id}`),
      on ? "post featured" : "post unfeatured",
   );
   return ids;
}

export interface Candidate {
   id: number;
   title: string;
   slug: string;
   locale: "en" | "ar";
   /** Any PostV2 kind for references; staff-written scholar posts are article or cards. */
   kind: string;
   /** A scholar post reference (docs/SCHOLARS.md §7): the community post it stands for. */
   ref: { post_id: string; channel_id: string } | null;
   published_at: string | null;
   featured_at: string | null;
   featured_by: string | null;
   scholar: { id: number; slug: string; name_en: string | null; name_ar: string | null } | null;
}

/**
 * "Featured candidates": recent live scholar articles, newest first, featured or not (the screen
 * shows the state and the action). `q` searches titles; `state` filters.
 */
export async function articleCandidates(env: Env, opts: { q?: string; state?: "all" | "featured" | "not_featured"; limit?: number; offset?: number } = {}): Promise<{ items: Candidate[]; total: number }> {
   const q = (opts.q ?? "").trim().slice(0, 100);
   const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
   const state = opts.state === "featured" ? "AND p.featured_at IS NOT NULL" : opts.state === "not_featured" ? "AND p.featured_at IS NULL" : "";
   const live = LIVE_SQL.replace(/\b(status|publish_at)\b/g, "p.$1");
   const where = `p.author_sub IS NOT NULL AND ${live} ${state} AND (?1 = '%%' OR p.title LIKE ?1 ESCAPE '\\' OR p.slug LIKE ?1 ESCAPE '\\')`;
   const [rows, count] = await Promise.all([
      env.DB.prepare(
         `SELECT p.id, p.title, p.slug, p.locale, p.kind, p.ref_post_id, p.ref_channel_id, p.published_at, p.featured_at, p.featured_by, s.id AS s_id, s.slug AS s_slug, s.name_en AS s_name_en, s.name_ar AS s_name_ar
          FROM posts p LEFT JOIN scholars s ON s.sso_sub = p.author_sub WHERE ${where}
          ORDER BY coalesce(p.published_at, p.created_at) DESC, p.id DESC LIMIT ?2 OFFSET ?3`,
      )
         .bind(like, Math.min(opts.limit ?? 30, 100), opts.offset ?? 0)
         .all<Row>(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM posts p WHERE ${where}`).bind(like).first<{ n: number }>(),
   ]);
   const iso = (v: unknown) => (v === null || v === undefined || v === "" ? null : new Date(String(v)).toISOString());
   return {
      total: Number(count?.n ?? 0),
      items: rows.results.map((r) => ({
         id: Number(r.id),
         title: String(r.title ?? ""),
         slug: String(r.slug ?? ""),
         locale: r.locale === "ar" ? "ar" : "en",
         kind: typeof r.kind === "string" && r.kind ? r.kind : "article",
         ref: typeof r.ref_post_id === "string" && r.ref_post_id ? { post_id: r.ref_post_id, channel_id: String(r.ref_channel_id ?? "") } : null,
         published_at: iso(r.published_at),
         featured_at: iso(r.featured_at),
         featured_by: typeof r.featured_by === "string" ? r.featured_by : null,
         scholar: r.s_id === null || r.s_id === undefined ? null : { id: Number(r.s_id), slug: String(r.s_slug), name_en: (r.s_name_en as string | null) ?? null, name_ar: (r.s_name_ar as string | null) ?? null },
      })),
   };
}

/** The timeline entry keys (`v<id>`) of videos already featured, by video id. */
export async function featuredVideoKeys(db: D1Database, refIds: string[]): Promise<Map<string, string>> {
   const out = new Map<string, string>();
   const ids = [...new Set(refIds)].slice(0, 90);
   if (!ids.length) return out;
   const { results } = await db
      .prepare(`SELECT id, ref_id FROM timeline_entries WHERE kind = 'video' AND video_kind = 'video' AND ref_id IN (${ids.map((_, i) => `?${i + 1}`).join(",")}) ORDER BY id`)
      .bind(...ids)
      .all<{ id: number; ref_id: string }>();
   for (const r of results) if (!out.has(r.ref_id)) out.set(r.ref_id, `v${r.id}`);
   return out;
}
