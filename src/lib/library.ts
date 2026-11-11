/**
 * The CMS video library (cms_videos, docs/specs/WWW-PAGES.md): every video, playlist and channel an
 * editor added in the CMS, once. Adding a video to home, to a curated page or on the Videos screen
 * adds it here; taking it off home or a page leaves it here. /videos (and any filter page with video
 * kinds, src/lib/lists.ts) lists it, newest added first. Deleting is a soft delete (trash kind
 * cms_videos, docs/SOFT_DELETE.md) and only takes it off filter pages.
 */
import type { Env } from "../env.ts";
import { softDelete, type TrashActor } from "./trash.ts";

export type LibraryKind = "video" | "playlist" | "channel";
export const LIBRARY_KINDS: readonly LibraryKind[] = ["video", "playlist", "channel"];
export const LIBRARY_PAGE_SIZE = 30;

export class LibraryError extends Error {
   constructor(
      readonly status: 400 | 404 | 409,
      readonly code: string,
   ) {
      super(code);
   }
}

/**
 * Adds a video (idempotent). An existing row keeps its first added date; a second language makes it 'all'.
 * Returns the row id and whether it was new.
 */
export async function addToLibrary(env: Env, v: { kind: string; ref_id: string; locale: string }, from: string, actor: { email: string | null }): Promise<{ id: number; added: boolean }> {
   if (!(LIBRARY_KINDS as readonly string[]).includes(v.kind)) throw new LibraryError(400, "bad_kind");
   if (!["en", "ar", "all"].includes(v.locale)) throw new LibraryError(400, "bad_locale");
   const at = new Date().toISOString();
   const row = await env.DB.prepare(
      `INSERT INTO cms_videos (kind, ref_id, locale, added_at, added_by, added_from, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?4, ?4)
       ON CONFLICT (kind, ref_id) DO UPDATE SET
         locale = CASE WHEN cms_videos.locale = excluded.locale THEN cms_videos.locale ELSE 'all' END,
         updated_at = CASE WHEN cms_videos.locale = excluded.locale THEN cms_videos.updated_at ELSE excluded.updated_at END
       RETURNING id, created_at = ?4 AS added`,
   )
      .bind(v.kind, v.ref_id, v.locale, at, actor.email, from)
      .first<{ id: number; added: number }>();
   return { id: Number(row!.id), added: Number(row!.added) === 1 };
}

export interface LibraryRow {
   id: number;
   kind: LibraryKind;
   ref_id: string;
   locale: "en" | "ar" | "all";
   added_at: string;
   added_by: string | null;
   title: string;
   thumb: string | null;
   channel: string | null;
   unavailable: boolean;
   /** Where it is used: "home" and curated page titles. */
   usedOn: string[];
}

/** The Videos screen: newest added first, optional title/id search and kind. */
export async function listLibrary(env: Env, opts: { q?: string; kind?: LibraryKind | null; page?: number } = {}): Promise<{ items: LibraryRow[]; total: number }> {
   const page = Math.max(1, opts.page ?? 1);
   const where: string[] = [];
   const binds: unknown[] = [];
   if (opts.kind) {
      binds.push(opts.kind);
      where.push(`cv.kind = ?${binds.length}`);
   }
   const q = (opts.q ?? "").trim().toLowerCase();
   if (q) {
      binds.push(`%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
      where.push(`(lower(coalesce(json_extract(vs.snapshot, '$.title'), '')) LIKE ?${binds.length} ESCAPE '\\' OR cv.ref_id LIKE ?${binds.length} ESCAPE '\\')`);
   }
   const from = `FROM cms_videos cv LEFT JOIN video_snapshots vs ON vs.kind = cv.kind AND vs.ref_id = cv.ref_id${where.length ? ` WHERE ${where.join(" AND ")}` : ""}`;
   const [count, rows] = await Promise.all([
      env.DB.prepare(`SELECT count(*) AS n ${from}`).bind(...binds).first<{ n: number }>(),
      env.DB.prepare(
         `SELECT cv.*, vs.snapshot,
            (SELECT 1 FROM timeline_entries te WHERE te.kind = 'video' AND te.video_kind = cv.kind AND te.ref_id = cv.ref_id LIMIT 1) AS on_home,
            (SELECT group_concat(title, '\u001f') FROM (SELECT DISTINCT pg.title FROM page_entries pe JOIN pages pg ON pg.id = pe.page_id
               WHERE pe.kind = 'video' AND pe.video_kind = cv.kind AND pe.ref_id = cv.ref_id)) AS pages
          ${from} ORDER BY cv.added_at DESC, cv.id DESC LIMIT ${LIBRARY_PAGE_SIZE} OFFSET ${(page - 1) * LIBRARY_PAGE_SIZE}`,
      )
         .bind(...binds)
         .all<Record<string, unknown>>(),
   ]);
   const items = rows.results.map((r): LibraryRow => {
      let s: Record<string, unknown> = {};
      try {
         s = typeof r.snapshot === "string" ? (JSON.parse(r.snapshot) as Record<string, unknown>) : {};
      } catch {
         /* {} */
      }
      return {
         id: Number(r.id),
         kind: r.kind as LibraryKind,
         ref_id: String(r.ref_id),
         locale: (r.locale as LibraryRow["locale"]) ?? "all",
         added_at: String(r.added_at),
         added_by: typeof r.added_by === "string" ? r.added_by : null,
         title: typeof s.title === "string" && s.title ? s.title : String(r.ref_id),
         thumb: typeof s.thumbnail_url === "string" ? s.thumbnail_url : null,
         channel: typeof s.channel_name === "string" ? s.channel_name : null,
         unavailable: !r.snapshot || s.public === false,
         usedOn: [...(r.on_home ? ["home"] : []), ...(typeof r.pages === "string" && r.pages ? r.pages.split("\u001f") : [])],
      };
   });
   return { items, total: Number(count?.n ?? 0) };
}

/** Every library item as "kind:ref_id" (the picker marks them "Already added"). */
export async function libraryRefs(env: Env): Promise<string[]> {
   const { results } = await env.DB.prepare("SELECT kind, ref_id FROM cms_videos ORDER BY added_at DESC LIMIT 1000").all<{ kind: string; ref_id: string }>();
   return results.map((r) => `${r.kind}:${r.ref_id}`);
}

export async function setLibraryLocale(env: Env, id: number, locale: string): Promise<void> {
   if (!["en", "ar", "all"].includes(locale)) throw new LibraryError(400, "bad_locale");
   const res = await env.DB.prepare("UPDATE cms_videos SET locale = ?2, updated_at = ?3 WHERE id = ?1").bind(id, locale, new Date().toISOString()).run();
   if (!res.meta.changes) throw new LibraryError(404, "not_found");
}

/** A soft delete: the video leaves /videos (and every filter page); home and curated pages are unchanged. */
export async function removeFromLibrary(env: Env, id: number, actor: TrashActor, reason?: unknown): Promise<number> {
   return softDelete(env, "cms_videos", id, actor, reason);
}
