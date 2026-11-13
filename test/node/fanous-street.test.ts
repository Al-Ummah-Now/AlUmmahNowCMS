import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lightMaterials, STREET_DTS_OUT, STREET_JS_OUT, streetTokens } from "../../scripts/sync-fanous.ts";
import { STREET_CSS, THEMES } from "../../src/admin/theme/vendor.generated.ts";

const lights = 'url("data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E")';
const SITE = `html:not(.dark), html[data-theme='fawanees']:not(.dark) { --fanous-color-background: #f3eee5; --fanous-street-on: 1; --fanous-street-line: #d8cebdff; --fanous-street-lights: ${lights}; }
.dark, html[data-theme='fawanees'].dark { --fanous-street-on: 1; --fanous-street-lights: ${lights}; }
html[data-theme='lantern']:not(.dark) { --fanous-street-on: 0; }
html[data-theme='lantern'].dark { --fanous-street-on: 0; }`;

describe("the lantern street, vendored by scripts/sync-fanous.ts", () => {
   it("takes each theme's street tokens into html:not(.dark) and html.dark", () => {
      expect(streetTokens(SITE, "fawanees")).toBe(
         `html:not(.dark){--fanous-street-on:1;--fanous-street-line:#d8cebdff;--fanous-street-lights:${lights}}html.dark{--fanous-street-on:1;--fanous-street-lights:${lights}}`,
      );
      expect(streetTokens(SITE, "lantern")).toBe("html:not(.dark){--fanous-street-on:0}html.dark{--fanous-street-on:0}");
   });

   it("allows only an inline SVG for the lights and refuses a theme without the switch", () => {
      expect(() => streetTokens(SITE.replace(lights, 'url("https://evil.test/x.svg")'), "fawanees")).toThrow(/unexpected value/);
      expect(() => streetTokens(SITE, "zujaj")).toThrow(/no --fanous-street-on/);
   });

   it("takes a theme's light-only materials as html:not(.dark)", () => {
      const css = "html[data-theme='fawanees']{--m-page:radial-gradient(red,blue)}\nhtml[data-theme='fawanees']:not(.dark){--m-page:var(--fanous-color-background)}\n";
      expect(lightMaterials(css, "fawanees")).toBe("html:not(.dark){--m-page:var(--fanous-color-background)}");
      expect(lightMaterials(css, "lantern")).toBe("");
   });

   it("the vendored themes switch the street on for Fawanees only, and the module is the locked one", () => {
      expect(THEMES.fawanees.css).toContain("html:not(.dark){--fanous-street-on:1");
      for (const id of ["lantern", "zujaj", "nahas"] as const) expect(THEMES[id].css).toContain("--fanous-street-on:0");
      expect(STREET_CSS).toContain("html.fanous-street");
      const lock = JSON.parse(readFileSync("fanous.lock.json", "utf8")) as { refs: { tokens: string }; street: Record<string, string> };
      expect(Object.keys(lock.street).sort()).toEqual([STREET_DTS_OUT, STREET_JS_OUT].sort());
      expect(readFileSync(STREET_JS_OUT, "utf8")).toContain(`Al-Ummah-Now/AlUmmahNow@${lock.refs.tokens}`);
   });
});
