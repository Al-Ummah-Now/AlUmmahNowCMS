import { expect, it } from "vitest";
import { BUILDER_CSS } from "../../src/admin/ui/builder-styles.ts";

it("uses the nav foreground token for the title on the open builder header", () => {
   expect(BUILDER_CSS).toMatch(/\.bld-open \.bld-title h2\{[^}]*\bcolor:var\(--fanous-c-nav-text\)[;}]/);
});

it("uses nav colors for the block-count pill on the open builder header", () => {
   const pill = BUILDER_CSS.match(/\.bld-open \.bld-title \.badge\.loc\{[^}]*\}/)?.[0];
   expect(pill).toContain("color:var(--fanous-c-nav-text)");
   expect(pill).toContain("background:var(--fanous-c-nav-search-bg)");
   expect(pill).toContain("box-shadow:inset 0 0 0 1px var(--fanous-c-nav-search-border)");
});

it("uses the nav icon token for the builder's theme picker", () => {
   expect(BUILDER_CSS).toMatch(/\.bld-theme\{[^}]*\bcolor:var\(--fanous-c-nav-icon\)[;}]/);
});
