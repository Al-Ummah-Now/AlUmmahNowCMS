import { describe, expect, it } from "vitest";
import { searchBody } from "../../src/lib/qaf/client.ts";
import { citation, citedQuotation, readerUrl, withoutQafQuotes } from "../../src/lib/qaf/model.ts";
import { guardQafTranslation } from "../../src/lib/qaf/translation.ts";
import { suggestedQuery } from "../../src/lib/qaf/query.ts";
import { openQafKey, sealQafKey } from "../../src/lib/qaf/settings.ts";
import { FAKE_QAF_KEY, QAF_INJECTED_NAME, QAF_MARKUP, QAF_PASSAGE } from "../support/qaf-mock.ts";

describe("Qaf request and citation boundaries", () => {
   it("uses canonical requests and validates every filter", () => {
      const a = searchBody({ query: "  حضانة   الطفل ", filters: { authorIds: [43, 21, 43], genres: ["hanbali-fiqh", "hadith-commentary"], deathYearAH: { lte: 1400, gte: 400 } } });
      const b = searchBody({ query: "حضانة الطفل", locale: "en", limit: 20, filters: { deathYearAH: { gte: 400, lte: 1400 }, genres: ["hadith-commentary", "hanbali-fiqh"], authorIds: [21, 43] } });
      expect(a).not.toBeNull();
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      for (const invalid of [
         { endpoint: "https://example.test" }, { limit: 21 }, { locale: "fr" }, { filterOperator: "||" },
         { query: "x".repeat(2001) }, { excludeIds: ["../foo"] }, { filters: { authorIds: [1.2] } },
         { filters: { bookIds: ["bad%2f"] } }, { filters: { genres: ["fake"] } }, { filters: { deathYearAH: { $where: "1=1" } } },
         { filters: { deathYearAH: { lte: "'; DROP TABLE qaf_settings; --" } } },
      ]) expect(searchBody({ query: "topic", ...invalid })).toBeNull();
   });

   it("includes all printed pages and formats Arabic metadata without grouping", () => {
      expect(citation(QAF_PASSAGE, "en")).toBe("Fayd al-Qadir — Abd al-Rauf al-Munawi, vol. 4, p. 1234; vol. 4, p. 1235");
      expect(citation(QAF_PASSAGE, "ar")).toBe("فيض القدير — عبد الرؤوف المناوي، ج ٤، ص ١٢٣٤؛ ج ٤، ص ١٢٣٥");
      expect(citedQuotation(QAF_PASSAGE, "en")).toBe(`~~~qaf-quote\n${QAF_PASSAGE.text}\n~~~\n\n[${citation(QAF_PASSAGE, "en")}](${QAF_PASSAGE.url})`);
   });

   it("keeps provider text inside a literal fence and rejects unsafe citation URLs", () => {
      const quote = citedQuotation({ ...QAF_PASSAGE, text: QAF_MARKUP, book: { ...QAF_PASSAGE.book, title: QAF_INJECTED_NAME } }, "en");
      expect(quote?.startsWith(`~~~~qaf-quote\n${QAF_MARKUP}\n~~~~\n\n[`)).toBe(true);
      expect(quote).toContain("\\](javascript:alert(1))");
      for (const url of ["javascript:alert(1)", "data:text/html,hi", "http://qaf.ai", "https://qaf.ai.evil.test/", "https://qaf.ai@evil.test/", "https://evil.test@qaf.ai/"]) {
         expect(citedQuotation({ ...QAF_PASSAGE, url }, "en")).toBeNull();
      }
      expect(readerUrl(QAF_PASSAGE.turathUrl, "turath")).toBe(QAF_PASSAGE.turathUrl);
   });

   it("checks the model output before using it as a query", () => {
      expect(suggestedQuery({ query: "<b>الصبر</b>\u0000عند المصيبة" })).toBe("الصبر عند المصيبة");
      expect(suggestedQuery({ query: "<img src=x onerror=alert(1)> Here is your ruling." })).toBeNull();
      expect(suggestedQuery({ query: "ص".repeat(201) })).toBeNull();
      expect(suggestedQuery({ ruling: "الصبر" })).toBeNull();
   });

   it("seals with a fresh nonce and rejects a different root or tampered ciphertext", async () => {
      const cipher = await sealQafKey("fixture root", FAKE_QAF_KEY);
      expect(cipher).not.toContain(FAKE_QAF_KEY);
      expect(await sealQafKey("fixture root", FAKE_QAF_KEY)).not.toBe(cipher);
      expect(await openQafKey("fixture root", cipher)).toBe(FAKE_QAF_KEY);
      await expect(openQafKey("other root", cipher)).rejects.toThrow();
      await expect(openQafKey("fixture root", cipher + "ABCD")).rejects.toThrow();
   });
});

it("keeps Qaf text out of model input and restores it only at an intact marker", () => {
   const quote = citedQuotation({ ...QAF_PASSAGE, text: QAF_MARKUP }, "en")!;
   const draft = `Before\n\n${quote}\n\nAfter`;
   const guarded = guardQafTranslation(draft);
   expect(guarded.body).not.toContain(QAF_MARKUP);
   expect(guarded.restore(guarded.body)).toBe(draft);
   expect(guarded.restore(guarded.body.replace("[QAF_LITERAL_0]", "altered"))).toBeNull();
   expect(guarded.restore(guarded.body + "\n[QAF_LITERAL_0]")).toBeNull();
   expect(withoutQafQuotes(draft)).not.toContain(QAF_MARKUP);
   const start = draft.indexOf(QAF_MARKUP);
   expect(withoutQafQuotes(draft, start, start + QAF_MARKUP.length)).toBe("");
});
