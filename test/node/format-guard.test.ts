/**
 * Every display call goes through the one formatter (src/lib/format.ts), so Arabic always shows
 * Eastern Arabic (Hindi) numerals ٠–٩ the same way on the server and in every browser.
 * Fails on Intl.NumberFormat / DateTimeFormat / RelativeTimeFormat / toLocale*String outside it,
 * and on region or numbering-system locale literals (ar-SA, ar-EG, nu-latn) anywhere in src/.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../..");
const FORMATTER = "src/lib/format.ts";
// Vendored or generated bundles: their sources live in other repos (page-blocks: AlUmmahNowUI) or are built from src/.
const SKIP = /\.generated\.(ts|js)$|\.d\.ts$/;

function files(dir: string): string[] {
   return readdirSync(join(ROOT, dir)).flatMap((name) => {
      const rel = `${dir}/${name}`;
      if (statSync(join(ROOT, rel)).isDirectory()) return files(rel);
      return /\.(ts|tsx|js)$/.test(name) && !SKIP.test(name) ? [rel] : [];
   });
}

describe("one formatter", () => {
   const src = files("src");

   it("no Intl number/date formatting or toLocale*String outside src/lib/format.ts", () => {
      const bad = src
         .filter((f) => f !== FORMATTER)
         .flatMap((f) =>
            readFileSync(join(ROOT, f), "utf8")
               .split("\n")
               .map((line, i) => [f, i + 1, line] as const)
               .filter(([, , line]) => /\bIntl\.(NumberFormat|DateTimeFormat|RelativeTimeFormat|PluralRules|ListFormat)\b|\.toLocale(Date|Time)?String\(/.test(line))
               .map(([file, n]) => `${file}:${n}`),
         );
      expect(bad).toEqual([]);
   });

   it("no ar-SA / ar-EG / nu-latn locale literals in src/", () => {
      const bad = src.filter((f) => /["'`](ar-SA|ar-EG)["'`]|nu-latn/.test(readFileSync(join(ROOT, f), "utf8")));
      expect(bad).toEqual([]);
   });
});
