/**
 * The search candidates: every live post of a locale (LIVE_SQL, so never drafts, scheduled or
 * unpublished rows), normalised once and kept in this isolate for SEARCH_INDEX_TTL_MS. A change in
 * the CMS reaches search within that window plus the response cache (both 60 s, like www's cache).
 */
import type { Env } from "../../env.ts";
import { LIVE_SQL } from "../schedule.ts";
import { normalizeSearchText } from "./normalize.ts";
import { refSummary } from "../scholars/ref-summary.ts";
import type { SearchDoc } from "./rank.ts";

export type Locale = "en" | "ar";

export const SEARCH_INDEX_TTL_MS = 60_000;
/** Newest live posts searched per locale; older ones are not. */
export const SEARCH_MAX_DOCS = 2000;
/** Body characters searched per post (after normalisation). */
export const SEARCH_BODY_CHARS = 10_000;

export interface PostDoc extends SearchDoc {
   row: Record<string, unknown>;
}

type Row = Record<string, unknown>;

const memo = new Map<Locale, { at: number; docs: Promise<PostDoc[]> }>();

/** Tests: forget the isolate's copy. */
export function resetSearchIndex(): void {
   memo.clear();
}

export function docOf(row: Row): PostDoc {
   const tags = (() => {
      try {
         const t = typeof row.tags === "string" ? JSON.parse(row.tags) : row.tags;
         return Array.isArray(t) ? t.filter((x): x is string => typeof x === "string") : [];
      } catch {
         return [];
      }
   })();
   const body = typeof row.body === "string" ? row.body.slice(0, SEARCH_BODY_CHARS * 2) : "";
   // Scholar post references keep no body (docs/SCHOLARS.md §7): their summary's text is searched.
   const ref = refSummary(row);
   const refText = ref ? [ref.text, ref.poll?.question, ref.quiz?.question, ref.link?.title, ref.link?.description, ...ref.slides.flatMap((x) => [x.heading, x.body])].filter(Boolean).join(" ") : "";
   const at = new Date(String(row.published_at ?? row.created_at ?? "")).getTime();
   return {
      id: Number(row.id),
      title: normalizeSearchText(String(row.title ?? "")),
      text: normalizeSearchText([row.excerpt ?? "", tags.join(" "), body, refText].join(" ")).slice(0, SEARCH_BODY_CHARS),
      publishedMs: Number.isNaN(at) ? 0 : at,
      row,
   };
}

async function load(env: Env, locale: Locale): Promise<PostDoc[]> {
   const { results } = await env.DB.prepare(
      `SELECT id, slug, locale, title, excerpt, body, author_name, tags, kind, slides, published_at, updated_at, created_at, ref_post_id, ref_channel_id, summary_json
       FROM posts WHERE locale = ?1 AND ${LIVE_SQL} ORDER BY published_at DESC, id DESC LIMIT ?2`,
   )
      .bind(locale, SEARCH_MAX_DOCS)
      .all<Row>();
   return results.map(docOf);
}

export function searchDocs(env: Env, locale: Locale, now = Date.now()): Promise<PostDoc[]> {
   const hit = memo.get(locale);
   if (hit && now - hit.at < SEARCH_INDEX_TTL_MS) return hit.docs;
   const docs = load(env, locale);
   memo.set(locale, { at: now, docs });
   docs.catch(() => memo.delete(locale));
   return docs;
}
