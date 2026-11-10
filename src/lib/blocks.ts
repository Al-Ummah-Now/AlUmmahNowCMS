/**
 * Page blocks (docs/SPEC.md §4.1): a page is an ordered list of blocks. This module is shared by
 * the Worker (content rules, public API) and the staff client bundle, so it imports nothing.
 *
 * Every page row has one locale, so a block's text is in its page's language; the other language's
 * page has its own blocks (Add translation copies them, so only the text needs translating).
 *
 * Stored shape = `normalizeBlocks()` output. Incomplete blocks (an image block with no image yet, a
 * call to action with no link) may be saved in a draft; the public API leaves them out.
 */
export const BLOCK_TYPES = ["markdown", "image", "gallery", "posts", "cards", "videos", "video", "cta", "columns", "quote", "divider"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const MAX_BLOCKS = 80;
export const MAX_GALLERY = 24;
export const MAX_SHELF = 24;
export const MAX_PICKED_POSTS = 12;
export const MAX_POSTS_LIMIT = 12;
export const MAX_CARDS_PAGE = 24;
export const MAX_SLIDES = 40;
/** Longest markdown in one block (rich text, two-column text). */
export const LONG_TEXT = 20_000;
/** Headings, captions, alt text, labels, citations. */
export const SHORT_TEXT = 300;
export const CTA_TEXT = 600;
export const QUOTE_TEXT = 2_000;

export type ShelfKind = "video" | "playlist" | "channel";

export interface ImageRef {
   media_id: number | null;
   alt: string;
   caption: string;
}

export type Block =
   | { id: string; type: "markdown"; text: string }
   | ({ id: string; type: "image"; size: "content" | "wide" } & ImageRef)
   | { id: string; type: "gallery"; columns: 2 | 3 | 4; items: ImageRef[] }
   | { id: string; type: "posts"; heading: string; mode: "latest" | "tag" | "picked"; limit: number; tag: string; post_ids: number[] }
   | { id: string; type: "cards"; heading: string; tag: string; page_size: number; filter: boolean }
   | { id: string; type: "videos"; heading: string; items: { kind: ShelfKind; ref_id: string; title_override: string }[] }
   | { id: string; type: "video"; kind: "video" | "playlist"; ref_id: string; caption: string }
   | { id: string; type: "cta"; heading: string; text: string; label: string; url: string; tone: "primary" | "quiet" }
   | ({ id: string; type: "columns"; text: string; image_side: "start" | "end" } & ImageRef)
   | { id: string; type: "quote"; variant: "quote" | "callout"; text: string; cite: string }
   | { id: string; type: "divider"; style: "line" | "space"; size: "s" | "m" | "l" };

export type BlockOf<T extends BlockType> = Extract<Block, { type: T }>;

/** Machine-readable reason, so the staff client can show its own (localized) message. */
export type BlockErrorCode = "not_list" | "too_many" | "bad_block" | "bad_type" | "bad_id" | "duplicate_id" | "too_long" | "bad_url" | "bad_ref" | "too_many_items" | "bad_value";

export class BlockError extends Error {
   constructor(
      readonly code: BlockErrorCode,
      readonly index: number | null,
      message: string,
   ) {
      super(index === null ? message : `Block ${index + 1}: ${message}`);
      this.name = "BlockError";
   }
}

export const BLOCK_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** A videos-platform id (as content-rules REF_ID). */
export const BLOCK_REF_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** "/…" on www (not "//") or an absolute https URL: the nav_items rule (content-rules validNavUrl). */
export function validBlockUrl(url: string): boolean {
   if (!url || url.length > 2048) return false;
   if (url.startsWith("/")) return !url.startsWith("//") && !/[\\\s]/.test(url);
   try {
      return new URL(url).protocol === "https:";
   } catch {
      return false;
   }
}

export function newBlockId(): string {
   const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2);
   return `b${rnd.slice(0, 12)}`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);

function text(v: unknown, max: number, i: number, field: string): string {
   if (v === undefined || v === null) return "";
   if (typeof v !== "string") throw new BlockError("bad_value", i, `${field} must be text`);
   const s = v.replace(/\r\n?/g, "\n");
   if (s.length > max) throw new BlockError("too_long", i, `${field} is longer than ${max} characters`);
   return s;
}
const line = (v: unknown, max: number, i: number, field: string) => text(v, max, i, field).replace(/\s*\n\s*/g, " ").trim();

function oneOf<T extends string | number>(v: unknown, values: readonly T[], def: T, i: number, field: string): T {
   if (v === undefined || v === null || v === "") return def;
   if (!values.includes(v as T)) throw new BlockError("bad_value", i, `${field} must be one of ${values.join(", ")}`);
   return v as T;
}

function mediaId(v: unknown, i: number): number | null {
   if (v === undefined || v === null || v === "") return null;
   const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v;
   if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) throw new BlockError("bad_ref", i, "the image must be a media library item");
   return n;
}

function imageRef(o: Obj, i: number): ImageRef {
   return { media_id: mediaId(o.media_id, i), alt: line(o.alt, SHORT_TEXT, i, "alt text"), caption: line(o.caption, SHORT_TEXT, i, "caption") };
}

function refId(v: unknown, i: number, optional: boolean): string {
   if ((v === undefined || v === null || v === "") && optional) return "";
   if (typeof v !== "string" || !BLOCK_REF_ID.test(v)) throw new BlockError("bad_ref", i, "the video must be chosen from the videos platform");
   return v;
}

function list<T>(v: unknown, max: number, i: number, field: string, each: (x: Obj) => T): T[] {
   if (v === undefined || v === null) return [];
   if (!Array.isArray(v)) throw new BlockError("bad_value", i, `${field} must be a list`);
   if (v.length > max) throw new BlockError("too_many_items", i, `${field} can have at most ${max} items`);
   return v.map((x) => {
      if (!isObj(x)) throw new BlockError("bad_value", i, `${field} items must be objects`);
      return each(x);
   });
}

function normalizeOne(raw: unknown, i: number): Block {
   if (!isObj(raw)) throw new BlockError("bad_block", i, "must be an object");
   const id = raw.id;
   if (typeof id !== "string" || !BLOCK_ID.test(id)) throw new BlockError("bad_id", i, "has no valid id");
   const type = raw.type as BlockType;
   switch (type) {
      case "markdown":
         return { id, type, text: text(raw.text, LONG_TEXT, i, "text") };
      case "image":
         return { id, type, ...imageRef(raw, i), size: oneOf(raw.size, ["content", "wide"] as const, "content", i, "size") };
      case "gallery":
         return { id, type, columns: oneOf(raw.columns, [2, 3, 4] as const, 3, i, "columns"), items: list(raw.items, MAX_GALLERY, i, "images", (x) => imageRef(x, i)) };
      case "posts": {
         const mode = oneOf(raw.mode, ["latest", "tag", "picked"] as const, "latest", i, "mode");
         const limit = raw.limit === undefined || raw.limit === null || raw.limit === "" ? 3 : Number(raw.limit);
         if (!Number.isInteger(limit) || limit < 1 || limit > MAX_POSTS_LIMIT) throw new BlockError("bad_value", i, `the number of posts must be 1 to ${MAX_POSTS_LIMIT}`);
         const ids = raw.post_ids === undefined || raw.post_ids === null ? [] : raw.post_ids;
         if (!Array.isArray(ids)) throw new BlockError("bad_value", i, "post_ids must be a list");
         if (ids.length > MAX_PICKED_POSTS) throw new BlockError("too_many_items", i, `at most ${MAX_PICKED_POSTS} posts can be picked`);
         const postIds = ids.map((x) => mediaId(x, i) ?? 0).filter((x) => x > 0);
         return {
            id,
            type,
            heading: line(raw.heading, SHORT_TEXT, i, "heading"),
            mode,
            limit,
            tag: line(raw.tag, 40, i, "tag"),
            post_ids: [...new Set(postIds)],
         };
      }
      case "cards": {
         const size = raw.page_size === undefined || raw.page_size === null || raw.page_size === "" ? 12 : Number(raw.page_size);
         if (!Number.isInteger(size) || size < 3 || size > MAX_CARDS_PAGE) throw new BlockError("bad_value", i, `cards per page must be 3 to ${MAX_CARDS_PAGE}`);
         return { id, type, heading: line(raw.heading, SHORT_TEXT, i, "heading"), tag: line(raw.tag, 40, i, "tag"), page_size: size, filter: raw.filter === undefined ? true : raw.filter === true || raw.filter === "true" };
      }
      case "videos":
         return {
            id,
            type,
            heading: line(raw.heading, SHORT_TEXT, i, "heading"),
            items: list(raw.items, MAX_SHELF, i, "videos", (x) => ({
               kind: oneOf(x.kind, ["video", "playlist", "channel"] as const, "video", i, "kind"),
               ref_id: refId(x.ref_id, i, false),
               title_override: line(x.title_override, SHORT_TEXT, i, "title"),
            })),
         };
      case "video":
         return { id, type, kind: oneOf(raw.kind, ["video", "playlist"] as const, "video", i, "kind"), ref_id: refId(raw.ref_id, i, true), caption: line(raw.caption, SHORT_TEXT, i, "caption") };
      case "cta": {
         const url = line(raw.url, 2048, i, "link");
         if (url && !validBlockUrl(url)) throw new BlockError("bad_url", i, 'the link must be a "/…" path on the site or an https:// address');
         return {
            id,
            type,
            heading: line(raw.heading, SHORT_TEXT, i, "heading"),
            text: text(raw.text, CTA_TEXT, i, "text").trim(),
            label: line(raw.label, 80, i, "button label"),
            url,
            tone: oneOf(raw.tone, ["primary", "quiet"] as const, "primary", i, "style"),
         };
      }
      case "columns":
         return { id, type, text: text(raw.text, LONG_TEXT, i, "text"), ...imageRef(raw, i), image_side: oneOf(raw.image_side, ["start", "end"] as const, "end", i, "image side") };
      case "quote":
         return { id, type, variant: oneOf(raw.variant, ["quote", "callout"] as const, "quote", i, "style"), text: text(raw.text, QUOTE_TEXT, i, "text").trim(), cite: line(raw.cite, SHORT_TEXT, i, "source") };
      case "divider":
         return { id, type, style: oneOf(raw.style, ["line", "space"] as const, "line", i, "style"), size: oneOf(raw.size, ["s", "m", "l"] as const, "m", i, "size") };
      default:
         throw new BlockError("bad_type", i, "is not a known block type");
   }
}

/** Validates and normalizes a page's blocks (unknown keys dropped, defaults filled). Throws BlockError. */
export function normalizeBlocks(raw: unknown): Block[] {
   const value = typeof raw === "string" ? parseOrThrow(raw) : raw;
   if (value === null || value === undefined) return [];
   if (!Array.isArray(value)) throw new BlockError("not_list", null, "blocks must be a list");
   if (value.length > MAX_BLOCKS) throw new BlockError("too_many", null, `a page can have at most ${MAX_BLOCKS} blocks`);
   const seen = new Set<string>();
   return value.map((b, i) => {
      const out = normalizeOne(b, i);
      if (seen.has(out.id)) throw new BlockError("duplicate_id", i, "has the same id as another block");
      seen.add(out.id);
      return out;
   });
}

function parseOrThrow(s: string): unknown {
   try {
      return JSON.parse(s);
   } catch {
      throw new BlockError("not_list", null, "blocks must be a list");
   }
}

/** Blocks as stored, without throwing (a malformed stored value reads as no blocks). */
export function storedBlocks(raw: unknown): Block[] {
   try {
      return normalizeBlocks(raw);
   } catch {
      return [];
   }
}

/** True when the block has what it needs to show on the site. */
export function isComplete(b: Block): boolean {
   switch (b.type) {
      case "markdown":
         return b.text.trim() !== "";
      case "image":
         return b.media_id !== null;
      case "gallery":
         return b.items.some((x) => x.media_id !== null);
      case "cards":
         return true;
      case "posts":
         return b.mode === "latest" || (b.mode === "tag" ? b.tag !== "" : b.post_ids.length > 0);
      case "videos":
         return b.items.length > 0;
      case "video":
         return b.ref_id !== "";
      case "cta":
         return b.label !== "" && b.url !== "";
      case "columns":
         return b.text.trim() !== "" || b.media_id !== null;
      case "quote":
         return b.text !== "";
      case "divider":
         return true;
   }
}

/** One rich-text block holding a legacy body (what migration 0004 does in SQL). */
export function bodyAsBlocks(body: unknown, id = "body"): Block[] {
   return typeof body === "string" && body.trim() !== "" ? [{ id, type: "markdown", text: body }] : [];
}

/**
 * The markdown `body` kept beside the blocks for readers of the v1 contract that predate blocks
 * (www falls back to it, its meta descriptions and RSS read it). Rich text is kept verbatim, so a
 * page with one rich-text block has exactly its old body. Images, galleries, post lists and shelves
 * need data markdown cannot carry and are left out; an embedded video becomes a `::video[ID]` line.
 */
export function blocksToMarkdown(blocks: Block[]): string {
   const parts: string[] = [];
   for (const b of blocks) {
      if (!isComplete(b)) continue;
      switch (b.type) {
         case "markdown":
            parts.push(b.text.trim());
            break;
         case "columns":
            if (b.text.trim()) parts.push(b.text.trim());
            break;
         case "video":
            if (b.kind === "video") parts.push(`::video[${b.ref_id}]`);
            break;
         case "quote":
            parts.push([...b.text.split("\n").map((l) => `> ${l}`.trimEnd()), ...(b.cite ? [">", `> — ${b.cite}`] : [])].join("\n"));
            break;
         case "cta":
            parts.push([b.heading ? `**${b.heading}**` : "", b.text, `[${b.label.replace(/[[\]]/g, "")}](${b.url})`].filter(Boolean).join("\n\n"));
            break;
         case "divider":
            if (b.style === "line") parts.push("---");
            break;
         case "posts":
         case "cards":
         case "videos":
            if (b.heading) parts.push(`## ${b.heading}`);
            break;
         case "image":
         case "gallery":
            break;
      }
   }
   return parts.filter(Boolean).join("\n\n");
}

/** Media library ids the blocks use. */
export function blockMediaIds(blocks: Block[]): number[] {
   const ids = new Set<number>();
   for (const b of blocks) {
      if ((b.type === "image" || b.type === "columns") && b.media_id) ids.add(b.media_id);
      if (b.type === "gallery") for (const x of b.items) if (x.media_id) ids.add(x.media_id);
   }
   return [...ids];
}

/** Videos-platform items the blocks use (shelves and embeds). */
export function blockVideoRefs(blocks: Block[]): { kind: ShelfKind; ref_id: string }[] {
   const out = new Map<string, { kind: ShelfKind; ref_id: string }>();
   for (const b of blocks) {
      if (b.type === "video" && b.ref_id) out.set(`${b.kind}:${b.ref_id}`, { kind: b.kind, ref_id: b.ref_id });
      if (b.type === "videos") for (const x of b.items) out.set(`${x.kind}:${x.ref_id}`, { kind: x.kind, ref_id: x.ref_id });
   }
   return [...out.values()];
}

/** Hand-picked post ids. */
export function blockPostIds(blocks: Block[]): number[] {
   return [...new Set(blocks.flatMap((b) => (b.type === "posts" && b.mode === "picked" ? b.post_ids : [])))];
}

/**
 * Every piece of reader-facing text in the blocks, with a stable path, so a translation helper
 * (AI assist, #17) can translate a page's blocks and put the text back with `withBlockTexts`.
 * `markdown: true` marks markdown (keep `::video[ID]` lines and link targets as they are).
 */
export interface BlockText {
   path: string;
   value: string;
   markdown: boolean;
}

export function blockTexts(blocks: Block[]): BlockText[] {
   const out: BlockText[] = [];
   const add = (path: string, value: string, markdown = false) => {
      if (value.trim()) out.push({ path, value, markdown });
   };
   blocks.forEach((b) => {
      const p = b.id;
      switch (b.type) {
         case "markdown":
            return add(`${p}.text`, b.text, true);
         case "image":
            add(`${p}.alt`, b.alt);
            return add(`${p}.caption`, b.caption);
         case "gallery":
            return b.items.forEach((x, j) => {
               add(`${p}.items.${j}.alt`, x.alt);
               add(`${p}.items.${j}.caption`, x.caption);
            });
         case "posts":
         case "cards":
            return add(`${p}.heading`, b.heading);
         case "videos":
            add(`${p}.heading`, b.heading);
            return b.items.forEach((x, j) => add(`${p}.items.${j}.title_override`, x.title_override));
         case "video":
            return add(`${p}.caption`, b.caption);
         case "cta":
            add(`${p}.heading`, b.heading);
            add(`${p}.text`, b.text);
            return add(`${p}.label`, b.label);
         case "columns":
            add(`${p}.text`, b.text, true);
            add(`${p}.alt`, b.alt);
            return add(`${p}.caption`, b.caption);
         case "quote":
            add(`${p}.text`, b.text);
            return add(`${p}.cite`, b.cite);
         case "divider":
            return;
      }
   });
   return out;
}

/** A copy of `blocks` with the texts at `paths` replaced (unknown paths are ignored). Re-normalized. */
export function withBlockTexts(blocks: Block[], texts: Record<string, string>): Block[] {
   const copy = structuredClone(blocks) as unknown as Obj[];
   const byId = new Map(copy.map((b) => [String(b.id), b]));
   for (const [path, value] of Object.entries(texts)) {
      const [id, ...rest] = path.split(".");
      let target: unknown = byId.get(id);
      for (const key of rest.slice(0, -1)) target = isObj(target) || Array.isArray(target) ? (target as Obj)[key] : undefined;
      const last = rest.at(-1);
      if (last && isObj(target) && typeof target[last] === "string") target[last] = value;
   }
   return normalizeBlocks(copy);
}

/** A fresh, empty block of `type` (the editor's starting values). */
export function emptyBlock(type: BlockType, id = newBlockId()): Block {
   return normalizeOne({ id, type }, 0);
}

/* ── Card posts (posts.kind = "cards"): an ordered sequence of slides ─────────────────────────── */

export const POST_KINDS = ["article", "cards"] as const;
export type PostKind = (typeof POST_KINDS)[number];
export const SLIDE_POSITIONS = ["top", "middle", "bottom"] as const;
export type SlidePosition = (typeof SLIDE_POSITIONS)[number];
export const SLIDE_HEADING = 140;
export const SLIDE_BODY = 400;

/**
 * One slide: an image with real overlay text (never burned into the image). The text is in the
 * post's language; `position` is vertical (start/end follow the reading direction on www).
 */
export interface Slide {
   id: string;
   media_id: number | null;
   alt: string;
   heading: string;
   body: string;
   position: SlidePosition;
}

/** Validates and normalizes a card post's slides. Throws BlockError (index = slide). */
export function normalizeSlides(raw: unknown): Slide[] {
   const value = typeof raw === "string" ? parseOrThrow(raw) : raw;
   if (value === null || value === undefined) return [];
   if (!Array.isArray(value)) throw new BlockError("not_list", null, "slides must be a list");
   if (value.length > MAX_SLIDES) throw new BlockError("too_many", null, `a card post can have at most ${MAX_SLIDES} slides`);
   const seen = new Set<string>();
   return value.map((s, i) => {
      if (!isObj(s)) throw new BlockError("bad_block", i, "must be an object");
      const id = s.id;
      if (typeof id !== "string" || !BLOCK_ID.test(id) || seen.has(id)) throw new BlockError(seen.has(String(id)) ? "duplicate_id" : "bad_id", i, "has no valid id");
      seen.add(id);
      return {
         id,
         media_id: mediaId(s.media_id, i),
         alt: line(s.alt, SHORT_TEXT, i, "alt text"),
         heading: line(s.heading, SLIDE_HEADING, i, "heading"),
         body: text(s.body, SLIDE_BODY, i, "text").trim(),
         position: oneOf(s.position, SLIDE_POSITIONS, "bottom", i, "text position"),
      };
   });
}

export function storedSlides(raw: unknown): Slide[] {
   try {
      return normalizeSlides(raw);
   } catch {
      return [];
   }
}

/** Slides that can show on the site (an image is required). */
export const shownSlides = (slides: Slide[]) => slides.filter((s) => s.media_id !== null);

/** The markdown body of a card post (RSS, meta descriptions, readers that predate slides). */
export function slidesToMarkdown(slides: Slide[]): string {
   return shownSlides(slides)
      .map((s) => [s.heading ? `## ${s.heading}` : "", s.body].filter(Boolean).join("\n\n"))
      .filter(Boolean)
      .join("\n\n");
}

export function slideTexts(slides: Slide[]): BlockText[] {
   return slides.flatMap((s) =>
      (["heading", "body", "alt"] as const).filter((k) => s[k].trim()).map((k) => ({ path: `${s.id}.${k}`, value: s[k], markdown: false })),
   );
}

export function emptySlide(id = newBlockId()): Slide {
   return { id, media_id: null, alt: "", heading: "", body: "", position: "bottom" };
}
