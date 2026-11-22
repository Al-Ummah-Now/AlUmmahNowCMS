import { describe, expect, it } from "vitest";
import { ADMIN_CSS } from "../../src/admin/ui/styles.ts";

// A list title in the other script (an Arabic page title on the English UI, an English one on the Arabic UI)
// starts at the UI's start edge, like every other title (AUDIT-2, CMS #154 head 3922a1c). The title keeps
// dir="auto" for its own bidi order; its alignment follows the list, not the title's script.
describe("list titles align to the page's start edge", () => {
   // text-align: start would follow the title's own dir="auto" script, and Chromium has no match-parent,
   // so the alignment is keyed on the page's direction (<html dir>)
   it("li-title aligns with the page's direction", () => {
      expect(ADMIN_CSS).toMatch(/\.li-title\{[^}]*text-align:left/);
      expect(ADMIN_CSS).toMatch(/html\[dir=rtl\] \.li-title\{text-align:right\}/);
      expect(ADMIN_CSS).not.toContain("match-parent");
   });
});
