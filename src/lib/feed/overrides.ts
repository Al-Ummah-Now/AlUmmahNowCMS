/**
 * "Title on the site" of a home timeline video entry, per language (docs/LOCALIZED_FIELDS.md).
 *
 * A row shown in one language (locale 'en' or 'ar') has one override, `title_override`, in that
 * language. A row shown in both (locale 'all') has a pair: `title_override` is the English one and
 * `title_override_ar` (migration 0023) the Arabic one. Saving one without the other is refused
 * (setVideoFields), so a pair is either both or neither.
 *
 * Legacy rows (written before 0023): an 'all' row with `title_override` and no `title_override_ar`.
 * Its one text belongs to the language it is written in (Arabic script and no Latin letters → Arabic,
 * else English), and the other language is MISSING. Missing never borrows the other language: www
 * shows the video's own title there, and the Timeline screen marks the row "Arabic missing" /
 * "English missing" with a Translate action.
 */
import { hasArabic } from "../slug.ts";

export type L = "en" | "ar";
export interface OverridePair {
   en: string | null;
   ar: string | null;
}

type Row = Record<string, unknown>;
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const LATIN = /[A-Za-z]/;

/** The language a legacy single text is written in. */
export const langOf = (s: string): L => (hasArabic(s) && !LATIN.test(s) ? "ar" : "en");

/** The pair of an 'all' row (legacy rows resolved as above). */
export function overridePair(r: Row): OverridePair {
   const base = text(r.title_override);
   const ar = text(r.title_override_ar);
   if (base && !ar && r.title_override_ar == null) return langOf(base) === "ar" ? { en: null, ar: base } : { en: base, ar: null };
   return { en: base, ar };
}

/** The override shown in language `l`, or null (the video's own title is shown). */
export function overrideFor(r: Row, l: L | undefined): string | null {
   if (r.locale === "all" && l) return overridePair(r)[l];
   if (r.locale === "en" || r.locale === "ar") return l && r.locale !== l ? null : text(r.title_override);
   // Rows without a language of their own (a curated page's entries: the page has one language).
   return text(r.title_override);
}

/** The language a pair lacks: set on one side only. Rows in one language never lack one. */
export function missingLocale(r: Row): L | null {
   if (r.locale !== "all") return null;
   const p = overridePair(r);
   if (p.en && !p.ar) return "ar";
   if (p.ar && !p.en) return "en";
   return null;
}
