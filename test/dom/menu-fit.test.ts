/**
 * fitToViewport (src/admin/client/dom.ts, the same function as AlUmmahNow packages/fanous-tokens/nav/menu-fit.js):
 * on a phone the account menu is a fixed sheet, and it hangs under the header wherever the header is. The theme
 * preview and passkey banners sit above the header, so the sheet's CSS top (the bar's height) covered the bar
 * (AUDIT-2, #154).
 */
import { afterEach, describe, expect, it } from "vitest";
import { fitToViewport } from "../../src/admin/client/dom.ts";

const box = (left: number, top: number, width: number, height: number) =>
   ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

/** A header at `barTop` (56px tall) holding a fixed sheet that CSS put at 60px. */
function page(barTop: number, sheetHeight = 300) {
   document.body.innerHTML = `<div class="preview-bar"></div><header class="aun-header"><div class="aun-menu" style="position:fixed"></div></header>`;
   const header = document.querySelector<HTMLElement>(".aun-header")!;
   const menu = document.querySelector<HTMLElement>(".aun-menu")!;
   header.getBoundingClientRect = () => box(0, barTop, 375, 56);
   menu.getBoundingClientRect = () => box(8, 60, 359, sheetHeight);
   menu.getClientRects = () => [box(8, 60, 359, sheetHeight)] as unknown as DOMRectList;
   Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 375 });
   Object.defineProperty(window, "innerHeight", { configurable: true, value: 667 });
   return menu;
}

afterEach(() => {
   document.body.innerHTML = "";
});

describe("a phone sheet hangs under its header", () => {
   it("moves below a header that a banner pushed down", () => {
      const menu = page(40);
      fitToViewport(menu);
      // the bar ends at 96px: the sheet starts 4px under it, not at its CSS 60px
      expect(menu.style.translate).toBe("0px 40px");
   });

   it("caps its height from where it now starts", () => {
      const menu = page(40, 900);
      fitToViewport(menu);
      expect(menu.style.maxBlockSize).toBe(`${667 - 8 - 100}px`);
   });

   it("stays where its CSS put it under a header at the top", () => {
      const menu = page(0);
      fitToViewport(menu);
      expect(menu.style.translate).toBe("");
   });
});
