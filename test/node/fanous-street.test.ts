import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkTile, lightMaterials, STREET_DTS_OUT, STREET_JS_OUT, STREET_TILE_MAX_BYTES, STREET_TILES_DIR, streetTileFiles, streetTokens } from "../../scripts/sync-fanous.ts";
import { pickStreetVariant } from "../../src/admin/client/fanous-street.generated.js";
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

   it("keeps the street tile and its variants only as our own WebP files under /fanous/street/", () => {
      const tile = (f: string) => `image-set(url("/fanous/street/${f}") 2x)`;
      const css = `html[data-theme='fawanees']:not(.dark) { --fanous-street-on: 1; --fanous-street-tile: ${tile("street-tile-1.webp")}; --fanous-street-tile-4: ${tile("street-tile-4.webp")}; }
html[data-theme='fawanees'].dark { --fanous-street-on: 1; --fanous-street-tile-2: ${tile("street-tile-dark-2.webp")}; }`;
      const out = streetTokens(css, "fawanees");
      expect(out).toContain(`--fanous-street-tile-4:${tile("street-tile-4.webp")}`);
      expect(streetTileFiles([out])).toEqual(["street-tile-1.webp", "street-tile-4.webp", "street-tile-dark-2.webp"]);
      expect(() => streetTokens(css.replace(tile("street-tile-1.webp"), 'image-set(url("https://evil.test/t.webp") 2x)'), "fawanees")).toThrow(/unexpected value/);
      expect(() => streetTokens(css.replace("--fanous-street-tile-4", "--fanous-street-tile-9"), "fawanees")).toThrow(/unexpected value/);
      expect(() => streetTokens(css.replace("--fanous-street-tile-4", "--fanous-street-glow"), "fawanees")).toThrow(/unexpected value/);
   });

   it("takes only WebP tiles under the size cap", () => {
      const webp = (n: number) => { const b = new Uint8Array(n); b.set(new TextEncoder().encode("RIFF"), 0); b.set(new TextEncoder().encode("WEBP"), 8); return b; };
      expect(() => checkTile("a.webp", webp(1000))).not.toThrow();
      expect(() => checkTile("a.webp", webp(STREET_TILE_MAX_BYTES + 1))).toThrow(/over/);
      expect(() => checkTile("a.webp", new TextEncoder().encode("<svg/>"))).toThrow(/not a WebP/);
   });

   it("serves exactly the tiles the vendored themes name, each locked and under 300 KB, four variants per mode", () => {
      const lock = JSON.parse(readFileSync("fanous.lock.json", "utf8")) as { streetTiles: Record<string, string> };
      const named = streetTileFiles(Object.values(THEMES).map((t) => t.css));
      expect(named).toEqual([1, 2, 3, 4].flatMap((n) => [`street-tile-${n}.webp`, `street-tile-dark-${n}.webp`]).sort());
      expect(readdirSync(STREET_TILES_DIR).sort()).toEqual(named);
      expect(Object.keys(lock.streetTiles).sort()).toEqual(named.map((f) => `${STREET_TILES_DIR}/${f}`));
      for (const f of named) expect(statSync(`${STREET_TILES_DIR}/${f}`).size).toBeLessThanOrEqual(STREET_TILE_MAX_BYTES);
   });

   it("the vendored module picks the variant on the server (no inline head script)", async () => {
      const mod = await import("../../src/admin/client/fanous-street.generated.js");
      expect("STREET_VARIANT_SCRIPT" in mod).toBe(false);
      expect(pickStreetVariant("aun_street_variant=2", () => 0)).toBe(2);
      expect(pickStreetVariant(null, () => 0.99)).toBe(4);
   });
});
