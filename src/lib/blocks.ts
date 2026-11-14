/**
 * Page blocks (docs/SPEC.md §4.1, wiki AUN-CMS-PAGE-BUILDER): a page is an ordered list of typed blocks.
 * The schema, its validator, the served shape and the renderer are the page builder's, vendored from
 * the monorepo (`src/lib/page-blocks.generated.ts`, `npm run sync:page-blocks`); this module gives
 * them the names the CMS has always used, and keeps the card-post slides, which are CMS-only.
 *
 * Every page row has one locale, so a block's text is in its page's language; the other language's
 * page has its own blocks (Add translation and "Copy from the other language" copy them).
 *
 * Stored shape = `normalizeBlocks()` output, schema version PAGE_BLOCKS_VERSION (pages.blocks_version).
 * Incomplete blocks may be saved in a draft; the public API leaves them out.
 */
import {
   BlockError,
   bodyAsPageBlocks,
   emptyPageBlock,
   isBlockComplete,
   newBlockId,
   normalizePageBlocks,
   PAGE_BLOCK_TYPES,
   pageBlockMediaIds,
   pageBlockPostIds,
   pageBlocksToMarkdown,
   pageBlockTexts,
   pageBlockVideoRefs,
   storedPageBlocks,
   withPageBlockTexts,
   type BlockText,
   type PageBlock,
   type PageBlockOf,
   type PageBlockType,
} from "./page-blocks.generated.ts";

export {
   BLOCK_ID,
   BLOCK_REF_ID,
   BlockError,
   CTA_TEXT,
   DEFAULT_STYLE,
   FEATURE_ICONS,
   LONG_TEXT,
   MAX_BLOCKS,
   MAX_CARD_ITEMS,
   MAX_CARDS_PAGE,
   MAX_FAQ,
   MAX_GALLERY,
   MAX_HERO_BUTTONS,
   MAX_PICKED_POSTS,
   MAX_POSTS_LIMIT,
   MAX_SHELF,
   MAX_STATS,
   newBlockId,
   PAGE_BLOCK_PRESETS,
   PAGE_BLOCKS_VERSION,
   presetBlock,
   QUOTE_TEXT,
   SHORT_TEXT,
   STYLE_OPTIONS,
   validBlockUrl,
   validEmail,
   type BlockErrorCode,
   type BlockStyle,
   type BlockText,
   type FeatureIcon,
   type ImageRef,
   type PresetKey,
   type ShelfKind,
} from "./page-blocks.generated.ts";

export const BLOCK_TYPES = PAGE_BLOCK_TYPES;
export type BlockType = PageBlockType;
export type Block = PageBlock;
export type BlockOf<T extends BlockType> = PageBlockOf<T>;

export const normalizeBlocks: (raw: unknown) => Block[] = normalizePageBlocks;
export const storedBlocks: (raw: unknown) => Block[] = storedPageBlocks;
export const isComplete: (b: Block) => boolean = isBlockComplete;
export const bodyAsBlocks: (body: unknown, id?: string) => Block[] = bodyAsPageBlocks;
export const blocksToMarkdown: (blocks: Block[]) => string = pageBlocksToMarkdown;
export const blockMediaIds: (blocks: Block[]) => number[] = pageBlockMediaIds;
export const blockVideoRefs = pageBlockVideoRefs;
export const blockPostIds: (blocks: Block[]) => number[] = pageBlockPostIds;
export const blockTexts = pageBlockTexts;
export const withBlockTexts: (blocks: Block[], texts: Record<string, string>) => Block[] = withPageBlockTexts;
export const emptyBlock: (type: BlockType, id?: string) => Block = emptyPageBlock;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const SHORT = 300;

function text(v: unknown, max: number, i: number, field: string): string {
   if (v === undefined || v === null) return "";
   if (typeof v !== "string") throw new BlockError("bad_value", i, `${field} must be text`);
   const s = v.replace(/\r\n?/g, "\n");
   if (s.length > max) throw new BlockError("too_long", i, `${field} is longer than ${max} characters`);
   return s;
}
const line = (v: unknown, max: number, i: number, field: string) => text(v, max, i, field).replace(/\s*\n\s*/g, " ").trim();

function oneOf<T extends string>(v: unknown, values: readonly T[], def: T, i: number, field: string): T {
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

function parseOrThrow(s: string): unknown {
   try {
      return JSON.parse(s);
   } catch {
      throw new BlockError("not_list", null, "slides must be a list");
   }
}

export const MAX_SLIDES = 40;
const BLOCK_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

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
      if (typeof id !== "string" || !BLOCK_ID_RE.test(id) || seen.has(id)) throw new BlockError(seen.has(String(id)) ? "duplicate_id" : "bad_id", i, "has no valid id");
      seen.add(id);
      return {
         id,
         media_id: mediaId(s.media_id, i),
         alt: line(s.alt, SHORT, i, "alt text"),
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

/** One line under a block's name: its first words, so a collapsed list still reads like the page. */
export function blockSummary(b: Block): string {
   const first = (...xs: (string | undefined)[]) => (xs.find((x) => x && x.trim()) ?? "").replace(/[#*_>`[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 90);
   switch (b.type) {
      case "hero":
         return first(b.title, b.subtitle, b.eyebrow);
      case "markdown":
      case "columns":
         return first(b.text);
      case "image":
         return first(b.caption, b.alt);
      case "layout":
         return first(...b.items.map((x) => x.heading), ...b.items.map((x) => x.text));
      case "cardgrid":
         return first(b.heading, ...b.items.map((x) => x.title));
      case "cta":
      case "contact":
         return first(b.heading, b.text, b.label);
      case "quote":
         return first(b.text);
      case "faq":
         return first(b.heading, ...b.items.map((x) => x.q));
      case "stats":
         return first(b.heading, ...b.items.map((x) => [x.value, x.label].filter(Boolean).join(" ")));
      case "video":
         return first(b.caption);
      case "videos":
      case "posts":
      case "cards":
         return first(b.heading);
      default:
         return "";
   }
}
