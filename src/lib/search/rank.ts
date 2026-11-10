/**
 * Ranking for the public search (docs/PUBLIC_API.md "Search"). Pure: the candidates and the query
 * are normalised with src/lib/search/normalize.ts, then each candidate gets a tier:
 *
 *   4  the title starts with the query
 *   3  every query word starts a title word
 *   2  the title contains the query, or every query word somewhere in it
 *   1  every query word is in the excerpt, tags or body
 *   0  no match (dropped)
 *
 * Words are compared with and without a leading Arabic article (الحديث ~ حديث). Ties go to the
 * newer item (published_at, then id).
 */
import { normalizeSearchText, stripArabicArticle } from "./normalize.ts";

export const TIER = { titlePrefix: 4, wordPrefix: 3, substring: 2, body: 1, none: 0 } as const;

export interface SearchDoc {
   id: number;
   /** Normalised title. */
   title: string;
   /** Normalised excerpt, tags and body (bounded). */
   text: string;
   /** Epoch ms; 0 when unknown. */
   publishedMs: number;
}

export interface SearchQuery {
   /** The normalised query. */
   norm: string;
   /** Its words, each with its article-stripped form when that differs. */
   words: string[][];
}

/** The query as ranked, or null when it has no searchable words. */
export function parseQuery(raw: string | null | undefined, maxWords = 8): SearchQuery | null {
   const norm = normalizeSearchText(raw);
   if (!norm) return null;
   const words = [...new Set(norm.split(" "))].slice(0, maxWords).map((w) => {
      const s = stripArabicArticle(w);
      return s === w ? [w] : [w, s];
   });
   return { norm, words };
}

/** A text's words plus their article-stripped forms. */
function wordForms(text: string): string[] {
   const out: string[] = [];
   for (const w of text.split(" ")) {
      if (!w) continue;
      out.push(w);
      const s = stripArabicArticle(w);
      if (s !== w) out.push(s);
   }
   return out;
}

/** `text` with its first word's article stripped (or `text` itself). */
function stripFirst(text: string): string {
   const i = text.indexOf(" ");
   const first = i < 0 ? text : text.slice(0, i);
   const s = stripArabicArticle(first);
   return s === first ? text : s + (i < 0 ? "" : text.slice(i));
}

export function tierOf(q: SearchQuery, doc: SearchDoc): number {
   const title = doc.title;
   const titles = [title, stripFirst(title)];
   const queries = [q.norm, stripFirst(q.norm)];
   if (titles.some((t) => queries.some((qq) => t.startsWith(qq)))) return TIER.titlePrefix;
   const titleWords = wordForms(title);
   if (q.words.every((forms) => forms.some((f) => titleWords.some((w) => w.startsWith(f))))) return TIER.wordPrefix;
   if (title.includes(q.norm) || q.words.every((forms) => forms.some((f) => title.includes(f)))) return TIER.substring;
   if (q.words.every((forms) => forms.some((f) => doc.text.includes(f)))) return TIER.body;
   return TIER.none;
}

/** Matching docs, best first; ties newest first. */
export function rank<T extends SearchDoc>(q: SearchQuery, docs: readonly T[]): T[] {
   const scored: { doc: T; tier: number }[] = [];
   for (const doc of docs) {
      const tier = tierOf(q, doc);
      if (tier > TIER.none) scored.push({ doc, tier });
   }
   scored.sort((a, b) => b.tier - a.tier || b.doc.publishedMs - a.doc.publishedMs || b.doc.id - a.doc.id);
   return scored.map((s) => s.doc);
}
