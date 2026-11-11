import { describe, expect, it } from "vitest";
import {
   alignSource,
   CONTEXT,
   detectQuran,
   insideOrnate,
   makeAnchor,
   paragraphAround,
   QUOTE_MAX,
   quranUrl,
   reanchor,
   resolveAnchor,
   sentences,
} from "../../src/lib/translation-flags/anchor.ts";

const at = (text: string, quote: string, n = 0) => {
   let i = -1;
   for (let k = 0; k <= n; k++) i = text.indexOf(quote, i + 1);
   return { start: i, end: i + quote.length };
};

describe("makeAnchor", () => {
   it("keeps the quote with its context and offsets", () => {
      const text = "The scholars agree that zakat is due on savings held for a lunar year.";
      const r = at(text, "zakat");
      expect(makeAnchor(text, r.start, r.end)).toEqual({ quote: "zakat", prefix: "The scholars agree that ", suffix: " is due on savings held for a lu", start: r.start, end: r.end });
   });
   it("moves surrounding whitespace out of the selection (double-click takes the space after a word)", () => {
      const text = "one two three";
      const a = makeAnchor(text, 3, 8)!;
      expect(a.quote).toBe("two");
      expect([a.start, a.end]).toEqual([4, 7]);
   });
   it("accepts a reversed selection", () => {
      expect(makeAnchor("abc def", 7, 4)?.quote).toBe("def");
   });
   it("refuses an empty, blank or oversized selection", () => {
      expect(makeAnchor("abc", 1, 1)).toBeNull();
      expect(makeAnchor("a    b", 1, 5)).toBeNull();
      const long = "x".repeat(QUOTE_MAX + 1);
      expect(makeAnchor(long, 0, long.length)).toBeNull();
   });
   it("caps the context at CONTEXT characters on each side", () => {
      const text = `${"a".repeat(100)}WORD${"b".repeat(100)}`;
      const a = makeAnchor(text, 100, 104)!;
      expect(a.prefix).toHaveLength(CONTEXT);
      expect(a.suffix).toHaveLength(CONTEXT);
   });
   it("works on Arabic text", () => {
      const text = "قال النبي ﷺ إن الدين يسر، ولن يشاد الدين أحد إلا غلبه.";
      const r = at(text, "الدين يسر");
      expect(makeAnchor(text, r.start, r.end)?.quote).toBe("الدين يسر");
   });
});

describe("resolveAnchor / reanchor after edits", () => {
   const text = "Zakat is a pillar. Zakat purifies wealth. Pay zakat on time.";
   const second = at(text, "Zakat", 1);
   const anchor = makeAnchor(text, second.start, second.end)!;

   it("finds the span unchanged", () => {
      expect(resolveAnchor(text, anchor)).toEqual(second);
   });
   it("follows the span when text is added before it", () => {
      const edited = `Introduction. ${text}`;
      expect(resolveAnchor(edited, anchor)).toEqual({ start: second.start + 14, end: second.end + 14 });
   });
   it("follows the span when text after it changes", () => {
      const edited = text.replace("Pay zakat on time.", "Pay it every year, on time.");
      expect(resolveAnchor(edited, anchor)).toEqual(second);
   });
   it("picks the right one of repeated words by context, not just the nearest offset", () => {
      // The flagged "Zakat" (the second) moves far; the first stays where the anchor's offset was.
      const edited = text.replace("Zakat is a pillar.", "Zakat is a pillar of Islam, the third of five, and it has been since the time of the Prophet ﷺ.");
      const r = resolveAnchor(edited, anchor)!;
      expect(edited.slice(r.end, r.end + 17)).toBe(" purifies wealth.");
   });
   it("survives reflowed whitespace inside the quote", () => {
      const t = "He said: the reward of fasting is with Allah alone.";
      const r = at(t, "the reward of fasting");
      const a = makeAnchor(t, r.start, r.end)!;
      const edited = t.replace("the reward of fasting", "the reward\nof  fasting");
      const found = resolveAnchor(edited, a)!;
      expect(edited.slice(found.start, found.end)).toBe("the reward\nof  fasting");
   });
   it("returns null once the flagged words themselves are edited", () => {
      expect(resolveAnchor(text.replace("Zakat purifies", "Charity purifies").replace("Zakat is", "Charity is"), anchor)).toBeNull();
   });
   it("reanchor refreshes offsets and context", () => {
      const edited = `New first line.\n\n${text}`;
      const a = reanchor(edited, anchor)!;
      expect(a.quote).toBe("Zakat");
      expect(a.start).toBe(second.start + 17);
      expect(a.suffix.startsWith(" purifies")).toBe(true);
   });
   it("handles the same word in Arabic, twice", () => {
      const t = "الصلاة عماد الدين. ومن أقام الصلاة فقد أقام الدين.";
      const r = at(t, "الصلاة", 1);
      const a = makeAnchor(t, r.start, r.end)!;
      const edited = `بسم الله. ${t}`;
      const found = resolveAnchor(edited, a)!;
      expect(edited.slice(found.start - 5, found.start)).toBe("أقام ");
   });
});

describe("alignSource", () => {
   it("matches the same sentence when both paragraphs have as many", () => {
      const target = "Fasting is prescribed for you. It teaches patience. It ends at sunset.";
      const source = "كُتب عليكم الصيام. وهو يعلّم الصبر. وينتهي عند الغروب.";
      expect(alignSource(target, at(target, "patience"), source)).toEqual({ text: "وهو يعلّم الصبر.", scope: "sentence" });
   });
   it("falls back to the paragraph when sentence counts differ", () => {
      const target = "First para.\n\nOne. Two. Three.\n\nLast para.";
      const source = "الأولى.\n\nواحد واثنان. ثلاثة.\n\nالأخيرة.";
      expect(alignSource(target, at(target, "Two"), source)).toEqual({ text: "واحد واثنان. ثلاثة.", scope: "paragraph" });
   });
   it("maps paragraphs proportionally when their counts differ", () => {
      const target = "A.\n\nB.\n\nC.\n\nD.";
      const source = "أ.\n\nد.";
      expect(alignSource(target, at(target, "D."), source).text).toBe("د.");
      expect(alignSource(target, at(target, "A."), source).text).toBe("أ.");
   });
   it("uses the whole field for a short field (a title)", () => {
      expect(alignSource("The pillars of Islam", { start: 4, end: 11 }, "أركان الإسلام")).toEqual({ text: "أركان الإسلام", scope: "field" });
   });
   it("says none when there is no source", () => {
      expect(alignSource("x", { start: 0, end: 1 }, "  ")).toEqual({ text: "", scope: "none" });
   });
   it("splits Arabic sentences on ؟", () => {
      expect(sentences("ما الزكاة؟ هي حق المال.").length).toBe(2);
   });
   it("paragraphAround is the paragraph holding the span", () => {
      const t = "One.\n\nTwo three.\n\nFour.";
      const r = paragraphAround(t, at(t, "three"));
      expect(t.slice(r.start, r.end)).toBe("Two three.");
   });
});

describe("Qur'an detection", () => {
   it("detects ornate parentheses, قال تعالى and references", () => {
      expect(detectQuran("﴿إِنَّ مَعَ الْعُسْرِ يُسْرًا﴾").quran).toBe(true);
      expect(detectQuran("قال تعالى: إن مع العسر يسرا").quran).toBe(true);
      expect(detectQuran("as in [الشرح: ٦]").quran).toBe(true);
      expect(detectQuran("Indeed, with hardship comes ease (Quran 94:6).")).toEqual({ quran: true, ref: { surah: 94, ayah: 6 } });
      expect(detectQuran("Surah al-Baqarah 2:255").ref).toEqual({ surah: 2, ayah: 255 });
   });
   it("does not treat a mention of the Qur'an, or a hadith, as Qur'an text", () => {
      expect(detectQuran("Muslims read the Quran in Ramadan.").quran).toBe(false);
      expect(detectQuran("The Prophet ﷺ said: religion is ease.").quran).toBe(false);
   });
   it("insideOrnate: a span within ﴿ … ﴾", () => {
      const t = "قال تعالى ﴿فإن مع العسر يسرا﴾ ثم قال.";
      expect(insideOrnate(t, at(t, "العسر"))).toBe(true);
      expect(insideOrnate(t, at(t, "ثم قال"))).toBe(false);
   });
   it("quranUrl goes to the ayah, else to a quran.com search", () => {
      expect(quranUrl({ surah: 94, ayah: 6 }, "x")).toBe("https://quran.com/94/6");
      expect(quranUrl(null, "﴿فإن مع العسر يسرا﴾")).toBe(`https://quran.com/search?q=${encodeURIComponent("فإن مع العسر يسرا")}`);
   });
});
