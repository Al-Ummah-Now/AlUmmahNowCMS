import { describe, expect, it } from "vitest";
import { NAV_CSS } from "../../src/admin/theme/vendor.generated.ts";
import { ADMIN_CSS } from "../../src/admin/ui/styles.ts";
import { HEADER_GLUE_CSS } from "../../src/lib/header.ts";
import { NAV_FONTS_CSS } from "../../src/lib/nav-fonts.generated.ts";

// One typeface in every app's header (AlUmmahNow docs/design/NAV.md "Header", round 3): the contract
// sets it on .aun-header (system-ui; Noto Naskh Arabic for Arabic, then system-ui so Latin text in it renders as in English) and no app overrides it.
describe("the header's typeface is the contract's", () => {
   it("the contract sets the header font, Latin and Arabic", () => {
      expect(NAV_CSS).toMatch(/\.aun-header\{[^}]*font-family:var\(--aun-header-font,system-ui,/);
      expect(NAV_CSS).toMatch(/\.aun-header:lang\(ar\)\{font-family:var\(--aun-header-font-ar,'Noto Naskh Arabic','Geeza Pro',system-ui,'Segoe UI',Tahoma,sans-serif\)/);
   });

   it("nothing in the CMS sets a font on the header or its pieces", () => {
      const rules = [...(HEADER_GLUE_CSS + ADMIN_CSS).matchAll(/([^{}]+)\{([^{}]*)\}/g)];
      const header = /\.(?:cms-hd|hd|aun-[a-z-]+)\b|header/;
      const offenders = rules.filter((m) => header.test(m[1]!) && /font-family|(?:^|;)font:/.test(m[2]!)).map((m) => m[1]!.trim());
      expect(offenders).toEqual([]);
      expect(HEADER_GLUE_CSS).not.toContain("--aun-header-font");
   });

   // The band, edge, blur and control font are the contract's theme header block (NAV.md "Theme"), the
   // same in every app: the CMS sets none of them.
   it("the bar's theme comes from the contract, with no CMS override", () => {
      expect(NAV_CSS).toContain("--aun-header-band:");
      expect(NAV_CSS).toMatch(/html\[data-theme='nahas'\] \.aun-header button,html\[data-theme='nahas'\] \.aun-header summary,[^{]*\{font-family:/);
      expect(HEADER_GLUE_CSS).not.toMatch(/--aun-header-bg|backdrop-filter|box-shadow|--m-header/);
      expect(NAV_FONTS_CSS).toMatch(/@font-face\{[^}]*src:url\('\/aun-nav\/fonts\//);
   });
});
