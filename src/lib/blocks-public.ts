/**
 * Page blocks and card-post slides as the public API serves them (docs/PUBLIC_API.md "Blocks",
 * "Card posts"). References are resolved here, at read time: media ids → MediaRef, picked post ids
 * → live PostSummary (in the page's locale, following translations), video refs → the stored
 * snapshot. A block that is incomplete, or whose references are all gone or not public, is left
 * out, so www never renders an empty frame.
 */
import type { Env } from "../env.ts";
import { isComplete, storedBlocks, storedSlides, type Block, type Slide, type SlidePosition } from "./blocks.ts";
import { MEDIA_COLS, mediaRefOf, type MediaRef, type MediaRow } from "./media-ref.ts";
import { LIVE_SQL } from "./schedule.ts";
import { getSnapshots } from "./video-snapshots.ts";

type Locale = "en" | "ar";
type Row = Record<string, unknown>;

export interface PublicSlide {
   id: string;
   image: MediaRef;
   heading: string | null;
   body: string | null;
   position: SlidePosition;
}

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
const orNull = (s: string) => (s.trim() ? s : null);

/** Media library rows by id (images only), as MediaRef with the library's alt text. */
export async function mediaByIds(env: Env, ids: number[]): Promise<Map<number, MediaRef>> {
   const out = new Map<number, MediaRef>();
   const unique = [...new Set(ids)].filter((x) => Number.isSafeInteger(x) && x > 0);
   for (let i = 0; i < unique.length; i += 90) {
      const part = unique.slice(i, i + 90);
      const { results } = await env.DB.prepare(
         `SELECT m.id, ${MEDIA_COLS} FROM media m LEFT JOIN media_variants v ON v.path = m.path WHERE m.id IN (${part.map((_, j) => `?${j + 1}`).join(",")})`,
      )
         .bind(...part)
         .all<MediaRow & { id: number }>();
      for (const m of results) {
         if (!m.path || !IMAGE_TYPES.has(String(m.mime_type ?? "").toLowerCase())) continue;
         out.set(Number(m.id), mediaRefOf(env, m));
      }
   }
   return out;
}

/** The block's own alt text wins over the library's. */
function withAlt(ref: MediaRef, alt: string): MediaRef {
   return { ...ref, alt: alt.trim() ? alt : ref.alt };
}

export function slideMediaIds(slides: Slide[]): number[] {
   return slides.flatMap((s) => (s.media_id ? [s.media_id] : []));
}

export function publicSlides(slides: Slide[], media: Map<number, MediaRef>): PublicSlide[] {
   const out: PublicSlide[] = [];
   for (const s of slides) {
      const ref = s.media_id ? media.get(s.media_id) : undefined;
      if (!ref) continue;
      out.push({ id: s.id, image: withAlt(ref, s.alt), heading: orNull(s.heading), body: orNull(s.body), position: s.position });
   }
   return out;
}

/** Slides of a post row (empty for articles). */
export function rowSlides(row: Row): Slide[] {
   return row.kind === "cards" ? storedSlides(row.slides) : [];
}

export interface BlockDeps {
   /** PostSummary for rows selected with `postCols` (the public API's own serializer). */
   summaries: (rows: Row[]) => Promise<unknown[]>;
   postCols: string;
   /** The served form of a stored snapshot, or null (src/routes/public-api.ts snapshotOf). */
   snapshot: (s: Row | null) => Record<string, unknown> | null;
}

async function postsFor(env: Env, b: Extract<Block, { type: "posts" }>, l: Locale, deps: BlockDeps): Promise<unknown[]> {
   const order = "ORDER BY published_at DESC, id DESC";
   if (b.mode === "latest" || b.mode === "tag") {
      const tag = b.mode === "tag" ? "AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(posts.tags) THEN posts.tags ELSE '[]' END) WHERE value = ?3)" : "";
      const stmt = env.DB.prepare(`SELECT ${deps.postCols} FROM posts WHERE locale = ?1 AND ${LIVE_SQL} ${tag} ${order} LIMIT ?2`);
      const { results } = await (b.mode === "tag" ? stmt.bind(l, b.limit, b.tag) : stmt.bind(l, b.limit)).all<Row>();
      return deps.summaries(results);
   }
   // Hand-picked: in the picked order, live only, and in this page's language. A post picked on the
   // other language's page (blocks are copied with a translation) is swapped for its translation.
   const ids = b.post_ids;
   if (!ids.length) return [];
   const { results: picked } = await env.DB.prepare(`SELECT id, locale, translation_key, (${LIVE_SQL}) AS live FROM posts WHERE id IN (${ids.map((_, i) => `?${i + 1}`).join(",")})`)
      .bind(...ids)
      .all<{ id: number; locale: string; translation_key: string | null; live: number }>();
   const byId = new Map(picked.map((r) => [Number(r.id), r]));
   const keys = [...new Set(picked.filter((r) => r.locale !== l && r.translation_key).map((r) => String(r.translation_key)))];
   const translated = new Map<string, number>();
   if (keys.length) {
      const { results } = await env.DB.prepare(`SELECT id, translation_key FROM posts WHERE locale = ?1 AND ${LIVE_SQL} AND translation_key IN (${keys.map((_, i) => `?${i + 2}`).join(",")})`)
         .bind(l, ...keys)
         .all<{ id: number; translation_key: string }>();
      for (const r of results) translated.set(r.translation_key, Number(r.id));
   }
   const wanted: number[] = [];
   for (const id of ids) {
      const r = byId.get(id);
      if (!r) continue;
      const target = r.locale === l ? (r.live ? Number(r.id) : null) : r.translation_key ? (translated.get(r.translation_key) ?? null) : null;
      if (target !== null && !wanted.includes(target)) wanted.push(target);
   }
   if (!wanted.length) return [];
   const { results: rows } = await env.DB.prepare(`SELECT ${deps.postCols} FROM posts WHERE id IN (${wanted.map((_, i) => `?${i + 1}`).join(",")})`)
      .bind(...wanted)
      .all<Row>();
   const rowById = new Map(rows.map((r) => [Number(r.id), r]));
   return deps.summaries(wanted.map((id) => rowById.get(id)).filter((r): r is Row => !!r));
}

/** A page row's blocks as served. A page saved before blocks existed serves its body as one block. */
export async function publicBlocks(env: Env, row: Row, deps: BlockDeps): Promise<Record<string, unknown>[]> {
   let blocks = storedBlocks(row.blocks);
   if (!blocks.length && typeof row.body === "string" && row.body.trim()) blocks = [{ id: "body", type: "markdown", text: row.body }];
   blocks = blocks.filter(isComplete);
   const l = row.locale === "ar" ? "ar" : "en";
   const ids = blocks.flatMap((b) => (b.type === "image" || b.type === "columns" ? (b.media_id ? [b.media_id] : []) : b.type === "gallery" ? b.items.flatMap((x) => (x.media_id ? [x.media_id] : [])) : []));
   const refs = blocks.flatMap((b) => (b.type === "video" ? [{ kind: b.kind, ref_id: b.ref_id }] : b.type === "videos" ? b.items.map((x) => ({ kind: x.kind, ref_id: x.ref_id })) : []));
   const [media, snaps] = await Promise.all([mediaByIds(env, ids), getSnapshots(env.DB, refs)]);
   const served = (kind: string, ref: string) => {
      const raw = snaps.get(`${kind}:${ref}`) ?? null;
      if (raw && raw.public === false) return undefined; // no longer public: left out
      return deps.snapshot(raw);
   };
   const out: Record<string, unknown>[] = [];
   for (const b of blocks) {
      switch (b.type) {
         case "markdown":
            out.push({ id: b.id, type: b.type, text: b.text });
            break;
         case "image": {
            const ref = media.get(b.media_id!);
            if (ref) out.push({ id: b.id, type: b.type, image: withAlt(ref, b.alt), caption: orNull(b.caption), size: b.size });
            break;
         }
         case "gallery": {
            const items = b.items.flatMap((x) => {
               const ref = x.media_id ? media.get(x.media_id) : undefined;
               return ref ? [{ image: withAlt(ref, x.alt), caption: orNull(x.caption) }] : [];
            });
            if (items.length) out.push({ id: b.id, type: b.type, columns: b.columns, items });
            break;
         }
         case "posts": {
            const items = await postsFor(env, b, l, deps);
            if (items.length) out.push({ id: b.id, type: b.type, heading: orNull(b.heading), mode: b.mode, items });
            break;
         }
         case "cards":
            out.push({ id: b.id, type: b.type, heading: orNull(b.heading), tag: orNull(b.tag), page_size: b.page_size, filter: b.filter });
            break;
         case "videos": {
            const items = b.items.flatMap((x) => {
               const snapshot = served(x.kind, x.ref_id);
               return snapshot === undefined ? [] : [{ kind: x.kind, ref_id: x.ref_id, title_override: orNull(x.title_override), snapshot }];
            });
            if (items.length) out.push({ id: b.id, type: b.type, heading: orNull(b.heading), items });
            break;
         }
         case "video": {
            const snapshot = served(b.kind, b.ref_id);
            if (snapshot !== undefined) out.push({ id: b.id, type: b.type, kind: b.kind, ref_id: b.ref_id, caption: orNull(b.caption), snapshot });
            break;
         }
         case "cta":
            out.push({ id: b.id, type: b.type, heading: orNull(b.heading), text: orNull(b.text), label: b.label, url: b.url, tone: b.tone });
            break;
         case "columns": {
            const ref = b.media_id ? media.get(b.media_id) : undefined;
            out.push({ id: b.id, type: b.type, text: b.text, image: ref ? withAlt(ref, b.alt) : null, caption: ref ? orNull(b.caption) : null, image_side: b.image_side });
            break;
         }
         case "quote":
            out.push({ id: b.id, type: b.type, variant: b.variant, text: b.text, cite: orNull(b.cite) });
            break;
         case "divider":
            out.push({ id: b.id, type: b.type, style: b.style, size: b.size });
            break;
      }
   }
   return out;
}
