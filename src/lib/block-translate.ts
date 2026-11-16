/**
 * Page-builder Translate (owner rule 2026-11-16, docs/LOCALIZED_FIELDS.md "Page blocks"): which block
 * fields carry reader-facing text, and how a field's text is cut into the pieces that go to the staff
 * translate endpoint (POST /admin/api/translate, src/admin/translate-api.ts) and put back.
 *
 *   - Only text goes out. Markdown markup (heading and list markers, quotes, **bold**, *italic*, `code`,
 *     link targets, `::video[ID]` lines) stays in the skeleton; so do bare URLs and email addresses.
 *     Link labels are text and are translated.
 *   - A block's pieces are packed into one request ("[1] …\n[2] …") under the endpoint's length cap,
 *     so a page costs about one call per block. A request with one piece is sent as plain text.
 *   - The answer is accepted only when every numbered piece comes back once; otherwise the caller
 *     treats the block as failed (never a half-mapped field).
 *
 * Pure: shared by the admin client (src/admin/client/block-translate.ts) and the unit tests.
 */
import type { PageBlock, PageBlockType } from "./page-blocks.generated.ts";

/** The endpoint's per-request cap is 2000 characters (FIELD_TEXT_MAX); markers and newlines fit under it. */
export const CHUNK_MAX = 1800;
/** A single piece longer than this is cut at sentence ends. */
const PIECE_MAX = 1500;

type FieldSpec = readonly (readonly [key: string, markdown: boolean])[];
interface BlockSpec {
   fields: FieldSpec;
   lists?: Readonly<Record<string, FieldSpec>>;
}

/**
 * Every reader-facing text field per block type, in editor order (the same set as the vendored
 * `pageBlockTexts`; test/node/block-translate.test.ts keeps the two in step). `true` = markdown.
 * Never listed: ids, types, URLs, emails, tags, media and video refs, appearance.
 */
export const BLOCK_TEXT_FIELDS: Readonly<Record<PageBlockType, BlockSpec>> = {
   hero: { fields: [["eyebrow", false], ["title", false], ["subtitle", false], ["alt", false]], lists: { buttons: [["label", false]] } },
   markdown: { fields: [["text", true]] },
   image: { fields: [["alt", false], ["caption", false]] },
   gallery: { fields: [], lists: { items: [["alt", false], ["caption", false]] } },
   layout: { fields: [], lists: { items: [["heading", false], ["text", true], ["label", false], ["alt", false]] } },
   columns: { fields: [["text", true], ["alt", false], ["caption", false]] },
   cardgrid: { fields: [["heading", false], ["intro", false]], lists: { items: [["title", false], ["text", false], ["label", false], ["alt", false]] } },
   cta: { fields: [["heading", false], ["text", false], ["label", false]] },
   quote: { fields: [["text", false], ["cite", false]] },
   faq: { fields: [["heading", false]], lists: { items: [["q", false], ["a", true]] } },
   video: { fields: [["caption", false]] },
   videos: { fields: [["heading", false]], lists: { items: [["title_override", false]] } },
   posts: { fields: [["heading", false]] },
   cards: { fields: [["heading", false]] },
   stats: { fields: [["heading", false]], lists: { items: [["value", false], ["label", false], ["text", true]] } },
   divider: { fields: [] },
   contact: { fields: [["heading", false], ["text", false], ["label", false]] },
};

/** A field's place in a block: `title`, or `items.2.text` (a list item's field). */
export interface FieldPath {
   key: string;
   list?: string;
   index?: number;
}
export const pathString = (p: FieldPath): string => (p.list === undefined ? p.key : `${p.list}.${p.index}.${p.key}`);

export function isMarkdownField(type: PageBlockType, p: Pick<FieldPath, "key" | "list">): boolean {
   const spec = BLOCK_TEXT_FIELDS[type];
   const fields = p.list === undefined ? spec?.fields : spec?.lists?.[p.list];
   return !!fields?.find(([k]) => k === p.key)?.[1];
}

/** The text at `p` in a stored block ('' when the block has no such field or item). */
export function blockFieldValue(b: PageBlock | Record<string, unknown> | undefined, p: FieldPath): string {
   if (!b) return "";
   const o = b as Record<string, unknown>;
   if (p.list === undefined) return typeof o[p.key] === "string" ? (o[p.key] as string) : "";
   const items = o[p.list];
   const item = Array.isArray(items) ? (items[p.index ?? -1] as Record<string, unknown> | undefined) : undefined;
   return item && typeof item[p.key] === "string" ? (item[p.key] as string) : "";
}

/* ── Segmenting: text pieces and the skeleton around them ────────────────────────────────────── */

/** A field's text as skeleton strings and numbered pieces: rebuild() puts translated pieces back. */
export interface Segmented {
   parts: (string | number)[];
   pieces: string[];
}

const LETTER = /\p{L}/u;
// Bare links and addresses are never sent: they stay as written.
const KEEP = /\bhttps?:\/\/[^\s<>()]+|\bmailto:[^\s<>()]+|[^\s@<>()[\]]+@[^\s@<>()[\]]+\.[A-Za-z]{2,}/g;
// The vendored renderer's inline patterns (page-blocks.generated.ts), so we cut where it does.
const IL_BOLD = /\*\*([^*\n]{1,600}?)\*\*/y;
const IL_EM = /\*([^*\s][^*\n]{0,600}?)\*/y;
const IL_EM2 = /_([^_\s][^_\n]{0,600}?)_(?![\p{L}\p{N}])/uy;
const IL_CODE = /`([^`\n]{1,600})`/y;
const IL_LINK = /\[([^[\]\n]{1,600})\]\(([^()\s]{1,2048})\)/y;
const at = (re: RegExp, s: string, i: number): RegExpExecArray | null => {
   re.lastIndex = i;
   return re.exec(s);
};

class Builder {
   parts: (string | number)[] = [];
   pieces: string[] = [];
   keep(s: string): void {
      if (!s) return;
      const last = this.parts.length - 1;
      if (last >= 0 && typeof this.parts[last] === "string") this.parts[last] += s;
      else this.parts.push(s);
   }
   /** Plain text: pieces where there are letters, links and addresses kept, whitespace kept around. */
   text(s: string): void {
      let i = 0;
      for (const m of s.matchAll(KEEP)) {
         this.words(s.slice(i, m.index));
         this.keep(m[0]);
         i = m.index + m[0].length;
      }
      this.words(s.slice(i));
   }
   private words(s: string): void {
      if (!LETTER.test(s)) return this.keep(s);
      const lead = /^\s*/.exec(s)![0];
      const trail = /\s*$/.exec(s)![0];
      this.keep(lead);
      for (const [j, piece] of splitLong(s.trim()).entries()) {
         if (j) this.keep(" ");
         this.parts.push(this.pieces.length);
         this.pieces.push(piece);
      }
      this.keep(trail);
   }
   /** Inline markdown: markers kept, their text recursed into; code spans and link targets kept. */
   inline(s: string): void {
      let text = 0;
      let i = 0;
      while (i < s.length) {
         const ch = s.charCodeAt(i);
         if (ch !== 42 && ch !== 95 && ch !== 96 && ch !== 91) {
            i += 1;
            continue;
         }
         let m: RegExpExecArray | null = null;
         let emit: (() => void) | null = null;
         if (ch === 42 && (m = at(IL_BOLD, s, i))) {
            const inner = m[1] ?? "";
            emit = () => (this.keep("**"), this.inline(inner), this.keep("**"));
         } else if (ch === 42 && (m = at(IL_EM, s, i))) {
            const inner = m[1] ?? "";
            emit = () => (this.keep("*"), this.inline(inner), this.keep("*"));
         } else if (ch === 95 && (i === 0 || !/[\p{L}\p{N}]/u.test(s.charAt(i - 1))) && (m = at(IL_EM2, s, i))) {
            const inner = m[1] ?? "";
            emit = () => (this.keep("_"), this.inline(inner), this.keep("_"));
         } else if (ch === 96 && (m = at(IL_CODE, s, i))) {
            const whole = m[0];
            emit = () => this.keep(whole);
         } else if (ch === 91 && (m = at(IL_LINK, s, i))) {
            const label = m[1] ?? "";
            const href = m[2] ?? "";
            emit = () => (this.keep("["), this.inline(label), this.keep(`](${href})`));
         }
         if (!m || !emit) {
            i += 1;
            continue;
         }
         if (i > text) this.text(s.slice(text, i));
         emit();
         i += m[0].length;
         text = i;
      }
      if (s.length > text) this.text(s.slice(text));
   }
}

/** A long piece cut after sentence ends (. ! ? ؟ ۔ and newlines never occur here), each under PIECE_MAX. */
function splitLong(s: string): string[] {
   if (s.length <= PIECE_MAX) return [s];
   const out: string[] = [];
   let rest = s;
   while (rest.length > PIECE_MAX) {
      const head = rest.slice(0, PIECE_MAX);
      let cut = -1;
      for (const m of head.matchAll(/[.!?؟۔](?=\s)/g)) cut = m.index + 1;
      if (cut < PIECE_MAX / 3) cut = head.lastIndexOf(" ");
      if (cut <= 0) cut = PIECE_MAX;
      out.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
   }
   if (rest) out.push(rest);
   return out;
}

/** One line of block markdown: its structural prefix kept, the rest inline. */
function markdownLine(b: Builder, line: string): void {
   if (!line.trim() || /^::video\[[A-Za-z0-9_-]{1,128}\]\s*$/.test(line) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return b.keep(line);
   const prefix = /^\s*(?:>\s?)*(?:#{1,4}[ \t]+|[-*+]\s+|\d{1,3}[.)]\s+)?/.exec(line)![0];
   b.keep(prefix);
   let rest = line.slice(prefix.length);
   // "## Title ##": the closing hashes are markup too.
   const close = /^#/.test(prefix.trimStart().replace(/^(?:>\s?)*/, "")) ? /\s+#+\s*$/.exec(rest) : null;
   const tail = close ? close[0] : "";
   if (tail) rest = rest.slice(0, -tail.length);
   b.inline(rest);
   b.keep(tail);
}

export function segment(value: string, markdown: boolean): Segmented {
   const b = new Builder();
   const lines = value.replace(/\r\n?/g, "\n").split("\n");
   lines.forEach((line, i) => {
      if (i) b.keep("\n");
      if (markdown) markdownLine(b, line);
      else b.text(line);
   });
   return { parts: b.parts, pieces: b.pieces };
}

export function rebuild(s: Segmented, translated: readonly string[]): string {
   return s.parts.map((p) => (typeof p === "number" ? (translated[p] ?? s.pieces[p] ?? "") : p)).join("");
}

/* ── Packing: one request per chunk of pieces ────────────────────────────────────────────────── */

export interface Chunk {
   /** Indexes into the caller's piece list. */
   ids: number[];
   /** What is sent: the piece itself, or numbered lines "[1] …". */
   text: string;
}

export function pack(pieces: readonly string[], max = CHUNK_MAX): Chunk[] {
   const out: Chunk[] = [];
   let ids: number[] = [];
   let size = 0;
   const flush = () => {
      if (!ids.length) return;
      out.push({ ids, text: ids.length === 1 ? pieces[ids[0]!]! : ids.map((id, n) => `[${n + 1}] ${pieces[id]}`).join("\n") });
      ids = [];
      size = 0;
   };
   pieces.forEach((p, id) => {
      const cost = p.length + 8;
      if (ids.length && size + cost > max) flush();
      ids.push(id);
      size += cost;
   });
   flush();
   return out;
}

const DIGITS: Record<string, string> = { "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9" };
const ascii = (s: string) => s.replace(/[٠-٩]/g, (d) => DIGITS[d] ?? d);

/** The translated pieces of `chunk` in order, or null when the answer doesn't map back one to one. */
export function unpack(chunk: Chunk, answer: string): string[] | null {
   if (chunk.ids.length === 1) return answer.trim() ? [answer.trim()] : null;
   const got = new Map<number, string>();
   let cur: number | null = null;
   for (const raw of answer.replace(/\r\n?/g, "\n").split("\n")) {
      const m = /^\s*[[［]\s*([0-9٠-٩]{1,3})\s*[\]］]\s?(.*)$/.exec(raw);
      if (m) {
         cur = Number(ascii(m[1]!));
         if (got.has(cur)) return null;
         got.set(cur, (m[2] ?? "").trim());
      } else if (raw.trim()) {
         if (cur === null) return null;
         got.set(cur, `${got.get(cur)} ${raw.trim()}`.trim());
      }
   }
   const out: string[] = [];
   for (let n = 1; n <= chunk.ids.length; n++) {
      const v = got.get(n);
      if (!v) return null;
      out.push(v);
   }
   return got.size === chunk.ids.length ? out : null;
}
