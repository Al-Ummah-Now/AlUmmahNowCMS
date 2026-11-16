/**
 * Arabic shows Eastern Arabic (Hindi) numerals ٠–٩ in every formatted value; English shows Arabic
 * numerals 0–9 (owner decision 2026-11-15, AlUmmahNow #1488 / #1496). src/lib/format.ts is the one
 * formatter; test/node/format-guard.test.ts keeps every other display call going through it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fill, formatCompact, formatDate, formatDateTime, formatDuration, formatMoney, formatNumber, formatPercent, formatRelative, formatTime, intlLocale, num, toAsciiDigits, toAsciiNumber } from "../../src/lib/format.ts";
import { absolute, bytes, relative } from "../../src/admin/format.ts";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";
import { LocalTime } from "../../src/admin/ui/parts.tsx";

const ASCII = /[0-9]/;
const EASTERN = /[٠-٩]/;
const at = Date.UTC(2026, 10, 15, 14, 5, 9);

describe("the formatter", () => {
   it("pins the numbering system, so Node and every browser agree", () => {
      expect(intlLocale("ar")).toBe("ar-u-nu-arab");
      expect(intlLocale("en")).toBe("en-GB");
   });

   const arabic: [string, string][] = [
      ["number", formatNumber(1234567.5, "ar")],
      ["negative", formatNumber(-3, "ar")],
      ["compact", formatCompact(12_500, "ar")],
      ["percent", formatPercent(0.25, "ar")],
      ["money", formatMoney(1234.5, "USD", "ar")],
      ["date", formatDate(at, "ar", { dateStyle: "long", timeZone: "UTC" })],
      ["time", formatTime(at, "ar", { timeZone: "UTC" })],
      ["date and time", formatDateTime(at, "ar", { timeZone: "UTC" })],
      ["relative minutes", formatRelative(at - 5 * 60_000, "ar", at)],
      ["relative days", formatRelative(at - 3 * 86_400_000, "ar", at)],
      ["relative old", formatRelative(at - 90 * 86_400_000, "ar", at)],
      ["duration m:ss", formatDuration(65, "ar")],
      ["duration h:mm:ss", formatDuration(3 * 3600 + 7, "ar")],
      ["placeholder", fill("الصفحة {page} من {pages}", { page: 2, pages: 12 }, "ar")],
      ["admin relative", relative(at - 5 * 3600_000, "ar", at)],
      ["admin absolute", absolute(at, "ar")],
      ["admin bytes", bytes(5_300_000, "ar")],
   ];
   it.each(arabic)("Arabic %s has Eastern Arabic (Hindi) numerals only", (_, out) => {
      expect(out).toMatch(EASTERN);
      expect(out).not.toMatch(ASCII);
   });

   it("money in Arabic names the currency, never «US$»", () => {
      const out = formatMoney(1.5, "USD", "ar");
      expect(out).toContain("دولار");
      expect(out).not.toContain("$");
      expect(formatMoney(1.5, "USD", "en")).toBe("US$1.50");
   });

   it("English keeps Arabic numerals 0–9", () => {
      expect(formatNumber(1234, "en")).toBe("1,234");
      expect(formatDuration(3 * 3600 + 7, "en")).toBe("3:00:07");
      expect(formatDuration(65, "en")).toBe("1:05");
      expect(absolute(at, "en")).toBe("15 Nov 2026, 14:05 UTC");
      expect(fill("Page {page} of {pages}", { page: 2, pages: 12 }, "en")).toBe("Page 2 of 12");
   });

   it("placeholders and words pass through untouched", () => {
      expect(num("{0}", "ar")).toBe("{0}");
      expect(fill("{0} · {1}", ["a@b.c", 3], "ar")).toBe("a@b.c · ٣");
   });

   it("inputs: Eastern Arabic (Hindi) and Persian numerals become 0–9", () => {
      expect(toAsciiDigits("٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹ abc-12")).toBe("0123456789 0123456789 abc-12");
      expect(toAsciiNumber("١٬٢٣٤٫٥")).toBe("1234.5");
   });
});

describe("Arabic admin strings", () => {
   const ar = ADMIN_STRINGS.ar as unknown as Record<string, unknown>;
   // Code the editor types or reads as code: JSON paths and template placeholders keep 0–9.
   const code = (s: string) => s.replace(/choices\[0\]/g, "").replace(/\{\d\}/g, "");

   function* walk(v: unknown, path: string): Generator<[string, unknown]> {
      if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) yield* walk(x, `${path}.${k}`);
      else yield [path, v];
   }

   it("no hard-coded 0–9 in any Arabic string", () => {
      const bad = [...walk(ar, "ar")].filter(([, v]) => typeof v === "string" && ASCII.test(code(v)));
      expect(bad).toEqual([]);
   });

   // Sentence functions whose parameters are all numbers (read from the source: types are gone at runtime).
   const source = readFileSync(join(import.meta.dirname, "../../src/admin/i18n.ts"), "utf8");
   const arSource = source.slice(source.indexOf("const ar: Strings"));
   const numeric = new Set([...arSource.matchAll(/(\w+): \(([^)]*)\) =>/g)].filter(([, , p]) => p.split(",").every((x) => /:\s*number\s*$/.test(x))).map(([, k]) => k));

   it("every Arabic sentence function formats its numbers", () => {
      const bad: string[] = [];
      expect(numeric.size).toBeGreaterThan(20);
      for (const [path, f] of walk(ar, "ar")) {
         if (typeof f !== "function" || !numeric.has(path.split(".").pop()!)) continue;
         for (const n of [0, 1, 2, 3, 11, 1234]) {
            const out = String((f as (...a: number[]) => string)(n, n + 5));
            if (ASCII.test(code(out))) bad.push(`${path}(${n}) → ${out}`);
         }
      }
      expect(bad).toEqual([]);
   });

   it("a rendered time in Arabic", () => {
      const html = String(LocalTime({ iso: new Date(at).toISOString(), lang: "ar" }));
      const text = html.split(/<[^>]*>/).join(""); // text between tags (a test reading markup, not a sanitizer)
      expect(text).toMatch(EASTERN);
      expect(text).not.toMatch(ASCII);
   });
});
