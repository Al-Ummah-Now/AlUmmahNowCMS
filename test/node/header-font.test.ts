import { describe, expect, it } from "vitest";
import { NAV_CSS } from "../../src/admin/theme/vendor.generated.ts";
import { ADMIN_CSS } from "../../src/admin/ui/styles.ts";
import { HEADER_GLUE_CSS } from "../../src/lib/header.ts";

// One typeface in every app's header (AlUmmahNow docs/design/NAV.md "Header", round 3): the contract
// sets it on .aun-header (system-ui; Noto Naskh Arabic for Arabic) and no app overrides it.
describe("the header's typeface is the contract's", () => {
   it("the contract sets the header font, Latin and Arabic", () => {
      expect(NAV_CSS).toMatch(/\.aun-header\{[^}]*font-family:var\(--aun-header-font,system-ui,/);
      expect(NAV_CSS).toMatch(/\.aun-header:lang\(ar\)\{font-family:var\(--aun-header-font-ar,'Noto Naskh Arabic'/);
   });

   it("nothing in the CMS sets a font on the header or its pieces", () => {
      const rules = [...(HEADER_GLUE_CSS + ADMIN_CSS).matchAll(/([^{}]+)\{([^{}]*)\}/g)];
      const header = /\.(?:cms-hd|hd|aun-[a-z-]+)\b|header/;
      const offenders = rules.filter((m) => header.test(m[1]!) && /font-family|(?:^|;)font:/.test(m[2]!)).map((m) => m[1]!.trim());
      expect(offenders).toEqual([]);
      expect(HEADER_GLUE_CSS).not.toContain("--aun-header-font");
   });
});
