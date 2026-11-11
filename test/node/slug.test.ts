import { describe, expect, it } from "vitest";
import { fixSql, planFixes, type SlugRow } from "../../scripts/ops/fix-junk-slugs.ts";
import { firstFree, isJunkSlug, SLUG_RE, slugCandidates, slugify, transliterate, trimSlug } from "../../src/lib/slug.ts";

describe("slugify (src/lib/slug.ts)", () => {
   it("transliterates Arabic titles to Latin", () => {
      expect(slugify("إن الدين عند الله الإسلام")).toBe("inna-al-din-inda-allah-al-islam");
      expect(slugify("كتاب التوحيد")).toBe("ktab-al-tuhid");
      expect(slugify("والليل إذا يغشى")).toBe("wa-al-lil-idha-yghsha");
      expect(slugify("تفسير سورة البقرة")).toBe("tfsir-surat-al-bqra");
   });

   it("uses harakat when the title has them", () => {
      expect(slugify("سُورَةُ الفَاتِحَة")).toBe("surat-al-fatiha");
      expect(slugify("مُحَمَّد")).toBe("muhammad");
   });

   it("keeps numbers, Arabic-Indic digits included", () => {
      expect(slugify("الحلقة 1")).toBe("al-hlqa-1");
      expect(slugify("درس ١٢: فقه الصيام")).toBe("drs-12-fqh-al-syam");
      expect(transliterate("٢٠٢٦")).toBe("2026");
   });

   it("lowercases, drops accents and punctuation, joins with single dashes", () => {
      expect(slugify("  Hello, World! Café — Ramadan 2026  ")).toBe("hello-world-cafe-ramadan-2026");
      expect(slugify("Mixed: Zakat الزكاة guide")).toBe("mixed-zakat-al-zakah-guide");
   });

   it("is empty when nothing can be written in Latin letters", () => {
      expect(slugify("🌙🌙")).toBe("");
      expect(slugify("")).toBe("");
   });

   it("cuts long titles at a word boundary, about 80 characters", () => {
      const long = "العقيدة الطحاوية شرح مفصل للمبتدئين في علم التوحيد والعقيدة الإسلامية الصحيحة مع الأدلة";
      const slug = slugify(long);
      expect(slug.length).toBeLessThanOrEqual(80);
      expect(long.length).toBeGreaterThan(0);
      expect(slug).toMatch(SLUG_RE);
      expect(slug.endsWith("-")).toBe(false);
      expect(slugify("word ".repeat(40))).toBe(trimSlug("word-".repeat(40).slice(0, -1)));
      expect(trimSlug("aaaa-bbbb-cccc", 9)).toBe("aaaa-bbbb");
      expect(trimSlug("aaaa-bbbb-cccc", 11)).toBe("aaaa-bbbb");
      expect(trimSlug("a".repeat(100), 80)).toBe("a".repeat(80));
   });

   it("always gives a valid slug or nothing", () => {
      for (const t of ["ـــ", "؟!", "a--b", "ئؤء", "Ünïcödé", "پژوهش", "الله أكبر"]) {
         const s = slugify(t);
         if (s) expect(s, t).toMatch(SLUG_RE);
      }
   });
});

describe("unique slugs", () => {
   it("numbers a taken slug -2, -3, …", () => {
      const c = slugCandidates("zakat");
      expect(c.slice(0, 3)).toEqual(["zakat", "zakat-2", "zakat-3"]);
      expect(firstFree(c, [])).toBe("zakat");
      expect(firstFree(c, ["zakat"])).toBe("zakat-2");
      expect(firstFree(c, ["zakat", "zakat-2"])).toBe("zakat-3");
      expect(firstFree(["x"], ["x"])).toBeNull();
   });

   it("keeps numbered candidates within the target length", () => {
      const base = slugify("word ".repeat(40));
      for (const c of slugCandidates(base, 12)) {
         expect(c.length).toBeLessThanOrEqual(80);
         expect(c).toMatch(SLUG_RE);
      }
   });

   it("calls digit-only slugs junk", () => {
      expect(isJunkSlug("1")).toBe(true);
      expect(isJunkSlug("12-3")).toBe(true);
      expect(isJunkSlug("")).toBe(true);
      expect(isJunkSlug("ramadan-1")).toBe(false);
   });
});

describe("junk slug fix (scripts/ops/fix-junk-slugs.ts)", () => {
   const row = (id: number, slug: string, title: string, extra: Partial<SlugRow> = {}): SlugRow => ({ table: "posts", id, locale: "ar", slug, title, status: "published", translation_slug: null, ...extra });

   it("plans a title slug for digit-only slugs, unique among the rest and each other", () => {
      const taken = new Map([["posts:ar", new Set(["1", "2", "3", "inna-al-din-inda-allah-al-islam"])]]);
      const fixes = planFixes(
         [row(1, "1", "إن الدين عند الله الإسلام"), row(2, "2", "إن الدين عند الله الإسلام"), row(3, "3", "x", { translation_slug: "from-english" }), row(4, "ok-slug", "kept")],
         taken,
      );
      expect(fixes.map((f) => [f.id, f.to])).toEqual([
         [1, "inna-al-din-inda-allah-al-islam-2"],
         [2, "inna-al-din-inda-allah-al-islam-3"],
         [3, "from-english"],
      ]);
      expect(slugify("إن الحكم إلا لله")).toBe("inna-al-hkm-illa-lillah");
   });

   it("writes guarded updates and marks posts dirty for the timeline", () => {
      const sql = fixSql([{ ...row(7, "1", "t"), to: "it's" }], "2026-11-11T00:00:00.000Z");
      expect(sql).toContain("UPDATE posts SET slug = 'it''s', updated_at = '2026-11-11T00:00:00.000Z' WHERE id = 7 AND slug = '1';");
      expect(sql).toContain("INSERT INTO feed_dirty (item, created_at) VALUES ('p7', '2026-11-11T00:00:00.000Z');");
      expect(fixSql([{ ...row(8, "2", "t", { table: "pages" }), to: "p" }])).not.toContain("feed_dirty");
   });
});
