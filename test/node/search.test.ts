import { describe, expect, it } from "vitest";
import { normalizeArabic, normalizeSearchText, stripArabicArticle, tokenizeSearchText } from "../../src/lib/search/normalize.ts";
import { parseQuery, rank, tierOf, TIER, type SearchDoc } from "../../src/lib/search/rank.ts";
import { docOf } from "../../src/lib/search/source.ts";

describe("normalizeSearchText (port of the monorepo's packages/shared-types/src/search/normalize.ts)", () => {
   it("strips tashkeel, Quranic marks, superscript alef and tatweel", () => {
      expect(normalizeSearchText("أَحْمَد")).toBe("احمد");
      expect(normalizeSearchText("مُحَمَّدٌ")).toBe("محمد");
      expect(normalizeSearchText("الرَّحْمٰنِ")).toBe("الرحمن");
      expect(normalizeSearchText("ذَٰلِكَ ٱلْكِتَٰبُ لَا رَيْبَۛ فِيهِۛ")).toBe("ذلك الكتب لا ريب فيه");
      expect(normalizeSearchText("مـــحـــمـــد")).toBe("محمد");
   });
   it("folds alef forms, yeh forms, keheh, taa marbuta and hamza carriers; drops a standalone hamza", () => {
      expect(normalizeSearchText("أ إ آ ٱ ٲ ٳ")).toBe("ا ا ا ا ا ا");
      expect(normalizeSearchText("مصطفى")).toBe("مصطفي");
      expect(normalizeSearchText("کتاب")).toBe("كتاب");
      expect(normalizeSearchText("یوم")).toBe("يوم");
      expect(normalizeSearchText("مدرسة")).toBe("مدرسه");
      expect(normalizeSearchText("مؤمن")).toBe("مومن");
      expect(normalizeSearchText("مسائل")).toBe("مسايل");
      expect(normalizeSearchText("سماء")).toBe("سما");
   });
   it("folds Arabic-Indic and Extended Arabic-Indic digits", () => {
      expect(normalizeSearchText("٢٠٢٦ ۱۲۳")).toBe("2026 123");
   });
   it("NFKC, lower case, accents, punctuation and invisibles", () => {
      expect(normalizeSearchText("Café  RÉSUMÉ")).toBe("cafe resume");
      expect(normalizeSearchText("ﬁle Ｆｕｌｌ")).toBe("file full");
      expect(normalizeSearchText("hello, world! (test)")).toBe("hello world test");
      expect(normalizeSearchText("a​b‏c")).toBe("abc");
      expect(normalizeSearchText("ﻻ")).toBe("لا");
   });
   it("empty input", () => {
      expect(normalizeSearchText("")).toBe("");
      expect(normalizeSearchText(null)).toBe("");
      expect(normalizeSearchText(undefined)).toBe("");
      expect(normalizeSearchText(" ؟ ، ")).toBe("");
      expect(tokenizeSearchText("")).toEqual([]);
   });
   it("normalizeArabic keeps case and punctuation", () => {
      expect(normalizeArabic("Ahmad: أحمد!")).toBe("Ahmad: احمد!");
   });
   it("tokenizes", () => expect(tokenizeSearchText("الحديث، النبوي")).toEqual(["الحديث", "النبوي"]));
   it("stripArabicArticle", () => {
      expect(stripArabicArticle("الحديث")).toBe("حديث");
      expect(stripArabicArticle("والكتاب")).toBe("كتاب");
      expect(stripArabicArticle("بالعلم")).toBe("علم");
      expect(stripArabicArticle("للعلم")).toBe("علم");
      expect(stripArabicArticle("الله")).toBe("الله");
      expect(stripArabicArticle("الذي")).toBe("الذي");
      expect(stripArabicArticle("الم")).toBe("الم");
      expect(stripArabicArticle("كتاب")).toBe("كتاب");
      expect(stripArabicArticle("")).toBe("");
   });
});

const doc = (id: number, title: string, text = "", day = id): SearchDoc => ({
   id,
   title: normalizeSearchText(title),
   text: normalizeSearchText(text),
   publishedMs: Date.UTC(2026, 0, day),
});

describe("ranking", () => {
   it("parseQuery: normalised words with article-stripped forms; null when nothing searchable", () => {
      expect(parseQuery("  ")).toBeNull();
      expect(parseQuery("!!")).toBeNull();
      expect(parseQuery("الحديث نبي")).toEqual({ norm: "الحديث نبي", words: [["الحديث", "حديث"], ["نبي"]] });
      expect(parseQuery("a b c d e f g h i j")?.words).toHaveLength(8);
   });
   it("tiers: title prefix > word prefix > substring > body", () => {
      const q = parseQuery("pray")!;
      expect(tierOf(q, doc(1, "Prayer times"))).toBe(TIER.titlePrefix);
      expect(tierOf(q, doc(1, "Times of prayer"))).toBe(TIER.wordPrefix);
      expect(tierOf(q, doc(1, "Unprayed"))).toBe(TIER.substring);
      expect(tierOf(q, doc(1, "Ramadan", "we pray at night"))).toBe(TIER.body);
      expect(tierOf(q, doc(1, "Ramadan", "fasting"))).toBe(TIER.none);
   });
   it("matches across spelling variants and the Arabic article", () => {
      expect(tierOf(parseQuery("احمد")!, doc(1, "أَحمد شوقي"))).toBe(TIER.titlePrefix);
      expect(tierOf(parseQuery("حديث")!, doc(1, "الحديث النبوي"))).toBe(TIER.titlePrefix);
      expect(tierOf(parseQuery("الحديث")!, doc(1, "حديث اليوم"))).toBe(TIER.titlePrefix);
      expect(tierOf(parseQuery("نبوي")!, doc(1, "الحديث النبوي"))).toBe(TIER.wordPrefix);
      expect(tierOf(parseQuery("مدرسة")!, doc(1, "المدرسه"))).toBe(TIER.titlePrefix);
   });
   it("multi-word queries need every word", () => {
      const q = parseQuery("times prayer")!;
      expect(tierOf(q, doc(1, "Prayer times"))).toBe(TIER.wordPrefix);
      expect(tierOf(q, doc(1, "Prayer"))).toBe(TIER.none);
   });
   it("orders by tier, then newest first", () => {
      const docs = [doc(1, "Ramadan", "pray"), doc(2, "Times of prayer"), doc(3, "Prayer"), doc(4, "Prayers at night"), doc(5, "Other"), doc(6, "Times to pray")];
      expect(rank(parseQuery("pray")!, docs).map((d) => d.id)).toEqual([4, 3, 6, 2, 1]);
   });
   it("docOf normalises title, excerpt, tags and body", () => {
      const d = docOf({ id: "7", title: "أَحمد", excerpt: "Café", tags: '["Fiqh"]', body: "# Héllo", published_at: "2026-01-02T00:00:00.000Z" });
      expect(d).toMatchObject({ id: 7, title: "احمد", text: "cafe fiqh hello", publishedMs: Date.UTC(2026, 0, 2) });
      expect(docOf({ id: 8, title: null, tags: "{bad", body: null }).text).toBe("");
   });
});
