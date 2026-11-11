/**
 * URL slugs for pages and posts, generated from the title (admin editor, data API, AI translate).
 *
 * - Latin only: the schema's pattern is `^[a-z0-9]+(?:-[a-z0-9]+)*$` (src/schema.ts). www would serve a
 *   Unicode slug, but percent-encoded Arabic addresses are long and unreadable when shared, so an
 *   Arabic title is transliterated: «إن الدين عند الله الإسلام» → `inna-al-din-inda-allah-al-islam`.
 * - Transliteration is a small table, no dependency: common words from a word list, the article
 *   "ال" as `al-`, long vowels from و / ي between consonants, short vowels when the title has
 *   harakat. Unvowelled words keep their consonants ("كتب" → `ktb`): readable enough for a link.
 * - At most SLUG_TARGET characters, cut at a word boundary.
 * - Unique per (table, locale), the pair the database keeps unique: `-2`, `-3`, … (freeSlug).
 *
 * Shared by the Worker and the admin client bundle: no Worker-only imports here.
 */

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Generated slugs stay this short; editors may type up to the field's 120. */
export const SLUG_TARGET = 80;
export const SLUG_MAX = 120;

/** Whole words (harakat removed) whose letter-by-letter reading would be wrong or ugly. */
const WORDS: Record<string, string> = {
   الله: "allah",
   لله: "lillah",
   بالله: "billah",
   والله: "wallah",
   إن: "inna",
   أن: "anna",
   إنما: "innama",
   عند: "inda",
   محمد: "muhammad",
   أحمد: "ahmad",
   بسم: "bismi",
   رسول: "rasul",
   صلى: "salla",
   عليه: "alayhi",
   وسلم: "wa-sallam",
   قرآن: "quran",
   القرآن: "al-quran",
   سورة: "surat",
   آية: "aya",
   في: "fi",
   من: "min",
   على: "ala",
   إلى: "ila",
   إلا: "illa",
   ألا: "alla",
   إياه: "iyyahu",
   إياك: "iyyaka",
   عن: "an",
   مع: "maa",
   ما: "ma",
   لا: "la",
   لم: "lam",
   لن: "lan",
   هو: "huwa",
   هي: "hiya",
   هم: "hum",
   نحن: "nahnu",
   أنت: "anta",
   هذا: "hadha",
   هذه: "hadhihi",
   ذلك: "dhalika",
   تلك: "tilka",
   الذي: "alladhi",
   التي: "allati",
   الذين: "alladhina",
   كل: "kull",
   يا: "ya",
   أو: "aw",
   ثم: "thumma",
   إذا: "idha",
   قد: "qad",
   كيف: "kayfa",
   لماذا: "limadha",
   ماذا: "madha",
   متى: "mata",
   أين: "ayna",
   عبد: "abd",
   رمضان: "ramadan",
   صلاة: "salah",
   الصلاة: "al-salah",
   زكاة: "zakah",
   الزكاة: "al-zakah",
   حج: "hajj",
   الحج: "al-hajj",
   جمعة: "jumuah",
   الجمعة: "al-jumuah",
   عيد: "eid",
   سنة: "sunnah",
   السنة: "al-sunnah",
   حديث: "hadith",
   الحديث: "al-hadith",
   إسلام: "islam",
   الإسلام: "al-islam",
   مسلم: "muslim",
   المسلم: "al-muslim",
   مسلمين: "muslimin",
   المسلمين: "al-muslimin",
   أمة: "ummah",
   الأمة: "al-ummah",
   نبي: "nabi",
   النبي: "al-nabi",
   رب: "rabb",
   دعاء: "dua",
   الدعاء: "al-dua",
};

const LETTERS: Record<string, string> = {
   ء: "",
   أ: "a",
   إ: "i",
   آ: "aa",
   ٱ: "a",
   ا: "a",
   ب: "b",
   ت: "t",
   ث: "th",
   ج: "j",
   ح: "h",
   خ: "kh",
   د: "d",
   ذ: "dh",
   ر: "r",
   ز: "z",
   س: "s",
   ش: "sh",
   ص: "s",
   ض: "d",
   ط: "t",
   ظ: "z",
   ع: "a",
   غ: "gh",
   ف: "f",
   ق: "q",
   ك: "k",
   ل: "l",
   م: "m",
   ن: "n",
   ه: "h",
   ة: "a",
   ى: "a",
   ئ: "",
   ؤ: "",
   // Persian / Urdu letters that turn up in names.
   پ: "p",
   چ: "ch",
   ژ: "zh",
   گ: "g",
   ک: "k",
   ی: "y",
};
const HARAKAT: Record<string, string> = { "\u064E": "a", "\u064F": "u", "\u0650": "i", "\u064B": "an", "\u064C": "un", "\u064D": "in", "\u0670": "a", "\u0652": "" };
const SHADDA = "\u0651";
const MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g;
const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

const isVowel = (c: string | undefined) => !!c && "aeiou".includes(c);

/** One Arabic word, harakat kept (they give the short vowels when present). */
function word(raw: string): string {
   const bare = raw.replace(MARKS, "");
   if (WORDS[bare]) return WORDS[bare];
   // Conjunction و / particle ب ف ك ل + the article: "والدين" → wa-al-din.
   const lead = /^([وفبك])ال(.{2,})$/u.exec(bare);
   if (lead) return `${{ و: "wa", ف: "fa", ب: "bi", ك: "ka" }[lead[1]]}-al-${word(lead[2])}`;
   if (bare.startsWith("لل") && bare.length > 3) return `li-al-${word(bare.slice(2))}`;
   if (bare.startsWith("ال") && bare.length > 3) return `al-${word(raw.replace(/^\u0627[\u064B-\u065F\u0670]*\u0644[\u064B-\u065F\u0670]*/u, ""))}`;
   let out = "";
   const letters = [...raw];
   for (let i = 0; i < letters.length; i++) {
      const c = letters[i];
      if (c === SHADDA) {
         // Double the last consonant written ("sh" doubles as "shsh" reads badly: double its last letter).
         const last = out.at(-1);
         if (last && !isVowel(last)) out += last;
         continue;
      }
      if (c in HARAKAT) {
         out += HARAKAT[c];
         continue;
      }
      if (c === "و" || c === "ي" || c === "ی") {
         // A long vowel after a consonant, a glide at the start or after a vowel.
         const prevVowel = out === "" || isVowel(out.at(-1));
         const next = letters[i + 1];
         const glide = !!next && (next in HARAKAT || "اى".includes(next));
         if (prevVowel || glide) out += c === "و" ? "w" : "y";
         else out += c === "و" ? "u" : "i";
         continue;
      }
      if (c in LETTERS) {
         out += LETTERS[c];
         continue;
      }
      out += c;
   }
   // A haraka and its long vowel letter ("فَا", "ـَة") read as one vowel.
   return out.replace(/([aiu])\1+/g, "$1");
}

/** Arabic script → Latin letters; other text is kept as it is. Arabic-Indic digits become 0–9. */
export function transliterate(text: string): string {
   const digits = text.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
   if (!ARABIC.test(digits)) return digits;
   return digits
      .normalize("NFC")
      .replace(/\u0640/g, "") // tatweel
      .replace(/[\u0600-\u06FF\u0750-\u077F]+/g, (w) => ` ${word(w)} `);
}

/** Cuts `slug` to at most `max` characters at a dash, so no word is broken (unless one word is longer). */
export function trimSlug(slug: string, max = SLUG_TARGET): string {
   if (slug.length <= max) return slug;
   const cut = slug.slice(0, max + 1);
   const dash = cut.lastIndexOf("-");
   return (dash > 0 ? cut.slice(0, dash) : slug.slice(0, max)).replace(/-+$/g, "");
}

/** The slug for a title ("" when nothing in it can be written in Latin letters). */
export function slugify(title: string, max = SLUG_TARGET): string {
   const s = transliterate(title)
      .normalize("NFKD")
      .replace(/[\u0300-\u036F]/g, "")
      .toLowerCase()
      .replace(/['’`ʿʾ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
   return trimSlug(s, max);
}

/** A slug with no words in it (only digits): what the old form produced from "الحلقة 1". */
export function isJunkSlug(slug: unknown): boolean {
   return typeof slug !== "string" || slug === "" || /^[0-9-]+$/.test(slug);
}

/** `base`, `base-2`, `base-3`, … (`count` of them), each within SLUG_MAX. */
export function slugCandidates(base: string, count = 50): string[] {
   const out = [base];
   for (let n = 2; n <= count; n++) out.push(`${trimSlug(base, SLUG_TARGET - String(n).length - 1)}-${n}`);
   return out;
}

/** The first of `candidates` not in `taken`, or null. */
export function firstFree(candidates: string[], taken: Iterable<string>): string | null {
   const used = new Set(taken);
   return candidates.find((c) => !used.has(c)) ?? null;
}

/** The fallback base when a title gives no slug (emoji only, say). */
export const fallbackBase = (table: string) => (table === "pages" ? "page" : "post");

/** The part of D1 freeSlug uses (this file is also in the admin client bundle, which has no Workers types). */
interface SlugDb {
   prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }> } };
}

/**
 * A free slug in `table` for `locale`, from `base` (already slugified; "" uses the fallback):
 * `base`, else `base-2`, `base-3`, … `exceptId` is the row being saved (its own slug is free).
 */
export async function freeSlug(db: SlugDb, table: "pages" | "posts", locale: string, base: string, exceptId?: number | string | null): Promise<string> {
   const root = base || fallbackBase(table);
   const candidates = slugCandidates(root);
   const marks = candidates.map((_, i) => `?${i + 3}`).join(", ");
   const { results } = await db
      .prepare(`SELECT slug FROM "${table}" WHERE locale = ?1 AND id IS NOT ?2 AND slug IN (${marks})`)
      .bind(locale, exceptId == null ? null : Number(exceptId), ...candidates)
      .all<{ slug: string }>();
   return firstFree(candidates, results.map((r) => r.slug)) ?? `${trimSlug(root, SLUG_TARGET - 9)}-${crypto.randomUUID().slice(0, 8)}`;
}
