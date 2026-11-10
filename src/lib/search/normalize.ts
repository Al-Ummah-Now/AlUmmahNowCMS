/**
 * Search text normalisation, ported from the AlUmmahNow monorepo
 * (packages/shared-types/src/search/normalize.ts, Story 29.9). That package is not published, so
 * this is a copy with the same behaviour; keep the two in step. Only the parts the CMS search
 * needs are ported (no FTS query builder, no index-text builder, no language detection).
 *
 * Applied identically to stored text and to the query so that spelling variants a reader treats
 * as "the same word" match each other:
 *
 * Arabic
 * - tashkeel / harakat, Quranic annotation marks and superscript alef are removed
 * - tatweel (kashida) is removed
 * - alef forms أ إ آ ٱ ٲ ٳ become bare alef ا
 * - alef maqsura ى and Farsi yeh ی become yeh ي; keheh ک becomes kaf ك
 * - taa marbuta ة becomes haa ه
 * - hamza carriers ؤ → و and ئ → ي; a standalone hamza ء is dropped
 * - Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits become 0-9
 *
 * Latin and everything else
 * - Unicode compatibility forms are folded (NFKC: ligatures, full-width, Arabic presentation forms)
 * - lower-cased, accents removed (é → e)
 * - zero-width and bidi control characters are removed
 *
 * The output of normalizeSearchText contains only letters, digits and single spaces.
 */

const ARABIC_MARKS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06dc\u06df-\u06e8\u06ea-\u06ed\u08d3-\u08ff]/g;
const TATWEEL = /\u0640/g;
const INVISIBLES = /[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\u00ad]/g;
const COMBINING_MARKS = /\p{M}+/gu;
const NON_WORD = /[^\p{L}\p{N}]+/gu;

const CHAR_MAP: Record<string, string> = {
   "\u0623": "\u0627", // أ → ا
   "\u0625": "\u0627", // إ → ا
   "\u0622": "\u0627", // آ → ا
   "\u0671": "\u0627", // ٱ (alef wasla) → ا
   "\u0672": "\u0627", // ٲ → ا
   "\u0673": "\u0627", // ٳ → ا
   "\u0649": "\u064a", // ى → ي
   "\u06cc": "\u064a", // ی (Farsi yeh) → ي
   "\u06a9": "\u0643", // ک (keheh) → ك
   "\u0629": "\u0647", // ة → ه
   "\u0624": "\u0648", // ؤ → و
   "\u0626": "\u064a", // ئ → ي
   "\u0621": "", // ء dropped
};

const CHAR_PATTERN = new RegExp(`[${Object.keys(CHAR_MAP).join("")}]`, "g");

function foldDigits(text: string): string {
   return text.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (ch) => {
      const code = ch.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
   });
}

/** Normalise Arabic letters only (no case folding or punctuation removal). */
export function normalizeArabic(text: string): string {
   if (!text) return "";
   return foldDigits(
      text
         .normalize("NFKC")
         .replace(INVISIBLES, "")
         .replace(ARABIC_MARKS, "")
         .replace(TATWEEL, "")
         .replace(CHAR_PATTERN, (ch) => CHAR_MAP[ch] ?? ch),
   );
}

/** Full search normalisation: Arabic folding + case/accent folding + punctuation to spaces. */
export function normalizeSearchText(text: string | null | undefined): string {
   if (!text) return "";
   return normalizeArabic(String(text))
      .toLowerCase()
      .normalize("NFD")
      .replace(COMBINING_MARKS, "")
      .normalize("NFC")
      .replace(NON_WORD, " ")
      .trim()
      .replace(/\s+/g, " ");
}

/** Split normalised text into tokens (words). */
export function tokenizeSearchText(text: string | null | undefined): string[] {
   const normalized = normalizeSearchText(text);
   return normalized ? normalized.split(" ") : [];
}

/** Arabic proclitic + definite-article prefixes, longest first. */
const ARTICLE_PREFIXES = ["وال", "بال", "كال", "فال", "لل", "ال"];
/** Words where the leading ال is part of the word itself. */
const ARTICLE_EXCEPTIONS = new Set(["الله", "اللهم", "الا", "الي", "التي", "الذي", "الذين"]);

/**
 * Strip a leading Arabic definite article (ال, وال, بال, كال, فال, لل) from a normalised token,
 * keeping at least two letters. Returns the token unchanged when it has no article, is too short
 * or is an exception (e.g. الله).
 */
export function stripArabicArticle(token: string): string {
   if (!token || ARTICLE_EXCEPTIONS.has(token)) return token;
   for (const prefix of ARTICLE_PREFIXES) {
      if (token.startsWith(prefix) && token.length - prefix.length >= 2) return token.slice(prefix.length);
   }
   return token;
}
