/**
 * Translation flags: where a flag points (docs/TRANSLATION_FLAGS.md §2). Pure functions, shared by the
 * Worker and the editor's client script.
 *
 * An anchor is a text quote with up to CONTEXT characters before (prefix) and after (suffix), plus the
 * offsets it had when it was made (the W3C Web Annotation TextQuote + TextPosition selectors). The
 * offsets alone break on the first edit above the span; the quote alone is ambiguous when the same
 * words occur twice. resolveAnchor uses all three, so a flag survives edits elsewhere in the field,
 * text added before it, reflowed whitespace, and repeated phrases. When the flagged words themselves
 * were changed, it returns null: the flagged text is gone (the editor offers to mark the flag resolved).
 */

export const CONTEXT = 32;
/** The longest span a flag can hold (a sentence or two; a whole body is not a flag). */
export const QUOTE_MAX = 2000;

export interface Anchor {
   quote: string;
   prefix: string;
   suffix: string;
   start: number;
   end: number;
}

export interface Range {
   start: number;
   end: number;
}

/**
 * The anchor for text[start, end), with surrounding whitespace moved out of the selection (a double-click
 * on a word often takes the space after it). Null when the selection is empty, only whitespace, or longer
 * than QUOTE_MAX.
 */
export function makeAnchor(text: string, start: number, end: number): Anchor | null {
   let s = Math.max(0, Math.min(start, end, text.length));
   let e = Math.min(text.length, Math.max(start, end));
   while (s < e && /\s/.test(text[s])) s++;
   while (e > s && /\s/.test(text[e - 1])) e--;
   if (e <= s || e - s > QUOTE_MAX) return null;
   return { quote: text.slice(s, e), prefix: text.slice(Math.max(0, s - CONTEXT), s), suffix: text.slice(e, e + CONTEXT), start: s, end: e };
}

/** Length of the common ending of a and b. */
function commonTail(a: string, b: string): number {
   let n = 0;
   while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
   return n;
}

/** Length of the common beginning of a and b. */
function commonHead(a: string, b: string): number {
   let n = 0;
   while (n < a.length && n < b.length && a[n] === b[n]) n++;
   return n;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every place the quote occurs: exactly, else with any run of whitespace standing for any other. */
function candidates(text: string, quote: string): Range[] {
   const out: Range[] = [];
   for (let i = text.indexOf(quote); i !== -1; i = text.indexOf(quote, i + 1)) out.push({ start: i, end: i + quote.length });
   if (out.length) return out;
   const words = quote.split(/\s+/).filter(Boolean);
   if (!words.length) return out;
   const re = new RegExp(words.map(escape).join("\\s+"), "gu");
   for (const m of text.matchAll(re)) out.push({ start: m.index!, end: m.index! + m[0].length });
   return out;
}

/**
 * Where the anchor is in `text` now, or null when its quote is no longer there. Among several matches
 * the one whose surroundings best match prefix/suffix wins; ties go to the one nearest the old offset.
 */
export function resolveAnchor(text: string, a: Pick<Anchor, "quote" | "prefix" | "suffix" | "start">): Range | null {
   if (!a.quote) return null;
   const found = candidates(text, a.quote);
   if (!found.length) return null;
   if (found.length === 1) return found[0];
   let best = found[0];
   let bestScore = -1;
   let bestDistance = Infinity;
   for (const r of found) {
      const score = commonTail(text.slice(Math.max(0, r.start - a.prefix.length), r.start), a.prefix) + commonHead(text.slice(r.end, r.end + a.suffix.length), a.suffix);
      const distance = Math.abs(r.start - a.start);
      if (score > bestScore || (score === bestScore && distance < bestDistance)) {
         best = r;
         bestScore = score;
         bestDistance = distance;
      }
   }
   return best;
}

/** The anchor again at its current place (fresh offsets and context), or null when its quote is gone. */
export function reanchor(text: string, a: Anchor): Anchor | null {
   const r = resolveAnchor(text, a);
   return r ? makeAnchor(text, r.start, r.end) : null;
}

// ---- source alignment (best effort) ----

export type SourceScope = "sentence" | "paragraph" | "field" | "none";

interface Piece {
   start: number;
   end: number;
}

/** Paragraphs (blank-line separated), with their offsets. */
export function paragraphs(text: string): Piece[] {
   const out: Piece[] = [];
   const re = /\n[ \t]*\n+/g;
   let at = 0;
   for (const m of text.matchAll(re)) {
      if (m.index! > at) out.push({ start: at, end: m.index! });
      at = m.index! + m[0].length;
   }
   if (at < text.length) out.push({ start: at, end: text.length });
   return out.filter((p) => text.slice(p.start, p.end).trim());
}

/** Sentences of text[from, to): split after . ! ? ؟ … and line breaks, with their absolute offsets. */
export function sentences(text: string, from = 0, to = text.length): Piece[] {
   const out: Piece[] = [];
   const re = /(?<=[.!?؟…。])\s+|\n+/gu;
   const part = text.slice(from, to);
   let at = 0;
   for (const m of part.matchAll(re)) {
      if (part.slice(at, m.index!).trim()) out.push({ start: from + at, end: from + m.index! });
      at = m.index! + m[0].length;
   }
   if (part.slice(at).trim()) out.push({ start: from + at, end: to });
   return out;
}

const indexOf = (pieces: Piece[], pos: number) => {
   const i = pieces.findIndex((p) => pos < p.end);
   return i === -1 ? pieces.length - 1 : i;
};

/** The paragraph of the target that holds the span (what the editor's alternatives are asked in). */
export function paragraphAround(text: string, r: Range): Range {
   const ps = paragraphs(text);
   if (!ps.length) return { start: 0, end: text.length };
   const a = ps[indexOf(ps, r.start)];
   const b = ps[indexOf(ps, Math.max(r.start, r.end - 1))];
   return { start: Math.min(a.start, r.start), end: Math.max(b.end, r.end) };
}

/**
 * The part of the source that the target span translates. Paragraphs are matched by position (the same
 * index when both have as many, else proportionally); inside a matched paragraph, sentences are matched
 * when both have as many. Short fields (a title) map to the whole source field.
 */
export function alignSource(target: string, r: Range, source: string): { text: string; scope: SourceScope } {
   const src = source.trim();
   if (!src) return { text: "", scope: "none" };
   const tps = paragraphs(target);
   const sps = paragraphs(source);
   if (tps.length <= 1 && sps.length <= 1) {
      const sentence = matchSentences(target, tps[0] ?? { start: 0, end: target.length }, r, source, sps[0] ?? { start: 0, end: source.length });
      return sentence ?? { text: src, scope: "field" };
   }
   const ti = indexOf(tps, r.start);
   const tj = indexOf(tps, Math.max(r.start, r.end - 1));
   const map = (i: number) => (tps.length === sps.length ? i : Math.round((i * (sps.length - 1)) / Math.max(1, tps.length - 1)));
   const si = map(ti);
   const sj = Math.max(si, map(tj));
   if (ti === tj) {
      const sentence = matchSentences(target, tps[ti], r, source, sps[si]);
      if (sentence) return sentence;
   }
   return { text: source.slice(sps[si].start, sps[sj].end).trim(), scope: "paragraph" };
}

function matchSentences(target: string, tp: Piece, r: Range, source: string, sp: Piece): { text: string; scope: SourceScope } | null {
   const ts = sentences(target, tp.start, tp.end);
   const ss = sentences(source, sp.start, sp.end);
   if (ts.length < 2 || ts.length !== ss.length) return null;
   const a = indexOf(ts, r.start);
   const b = indexOf(ts, Math.max(r.start, r.end - 1));
   return { text: source.slice(ss[a].start, ss[b].end).trim(), scope: "sentence" };
}

// ---- Quran ----

export interface QuranRef {
   surah: number;
   ayah: number | null;
}

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const toLatin = (s: string) => s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));

/**
 * Best-effort detection of Qur'an in a flagged span, or in the source sentence it translates
 * (docs/TRANSLATION_FLAGS.md §5): the ornate parentheses ﴿ ﴾ that set off ayat, "قال تعالى" /
 * "قال الله تعالى", or a reference such as "Quran 2:255", "Surah al-Baqarah 2:255", "[البقرة: ٢٥٥]".
 * The word "Quran" alone is not enough (an article about the Qur'an is not Qur'an text). Editors can
 * also mark a flag as Qur'an themselves. Detection only switches the fix to the official
 * text: Qur'an is never machine-translated, so a detected span gets no AI alternatives.
 */
export function detectQuran(...texts: string[]): { quran: boolean; ref: QuranRef | null } {
   const all = texts.join("\n");
   const ref = quranRef(all);
   const quran =
      /[﴿﴾]/.test(all) ||
      /قال\s+(?:الله\s+)?تعالى/.test(all) ||
      /\[\s*[\u0600-\u06FF ]{3,30}\s*:\s*[\d٠-٩]{1,3}\s*\]/.test(all) ||
      ref !== null;
   return { quran, ref };
}

/** True when text[r] sits between ﴿ and ﴾ (an ayah quoted in the text). */
export function insideOrnate(text: string, r: Range): boolean {
   const open = text.lastIndexOf("﴿", r.start);
   if (open === -1 || text.lastIndexOf("﴾", r.start - 1) > open) return false;
   const close = text.indexOf("﴾", Math.max(r.start, r.end - 1));
   return close !== -1 && (text.indexOf("﴿", r.start) === -1 || text.indexOf("﴿", r.start) > close);
}

export function quranRef(text: string): QuranRef | null {
   const t = toLatin(text);
   // "Quran 2:255", "Surah al-Baqarah 2:255". An Arabic reference ([البقرة: ٢٥٥]) names the surah, not its
   // number, so it counts as Qur'an (detectQuran) without a link to the ayah.
   const m = t.match(/\b(?:Qur'?ān|Qur'?an|Quran|Koran|Surah?|Sūrah)\b[^\d\n]{0,40}?(\d{1,3})\s*:\s*(\d{1,3})/i);
   if (m) {
      const surah = Number(m[1]);
      const ayah = Number(m[2]);
      if (surah >= 1 && surah <= 114 && ayah >= 1 && ayah <= 286) return { surah, ayah };
   }
   return null;
}

/** Where "Use official text" goes: the ayah on quran.com, else a quran.com search for the words. */
export function quranUrl(ref: QuranRef | null, words: string): string {
   if (ref) return `https://quran.com/${ref.surah}${ref.ayah ? `/${ref.ayah}` : ""}`;
   return `https://quran.com/search?q=${encodeURIComponent(words.replace(/[﴿﴾]/g, "").trim().slice(0, 200))}`;
}
