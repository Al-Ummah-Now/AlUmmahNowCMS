/**
 * The "Add a post" chooser's empty message (src/admin/client/timeline.ts emptyCandidates): no posts in
 * the language at all is never worded as "every post is already on the timeline" (owner report 2026-11-11).
 */
import { describe, expect, it } from "vitest";
import { emptyCandidates } from "../../src/admin/client/timeline.ts";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";

for (const lang of ["en", "ar"] as const) {
   const t = ADMIN_STRINGS[lang].timeline;
   const T = {
      candidatesNone: t.candidatesNone(ADMIN_STRINGS[lang].locales.en),
      candidatesAllOn: t.candidatesAllOn(-1).replace("-1", "{0}"),
      candidatesAllOnOne: t.candidatesAllOn(1),
      candidatesNoMatch: t.candidatesNoMatch,
   };
   describe(`emptyCandidates (${lang})`, () => {
      it("no published posts in the language", () => {
         expect(emptyCandidates(T, "", 0, 0)).toBe(T.candidatesNone);
         expect(emptyCandidates(T, "tafsir", 0, 0)).toBe(T.candidatesNone);
      });
      it("every published post already on the timeline, with the count", () => {
         expect(emptyCandidates(T, "", 3, 0)).toBe(t.candidatesAllOn(3));
         expect(emptyCandidates(T, "", 1, 0)).toBe(t.candidatesAllOn(1));
         expect(emptyCandidates(T, "tafsir", 3, 0)).toBe(t.candidatesAllOn(3));
      });
      it("a search that matches none of the switched-off posts", () => {
         expect(emptyCandidates(T, "tafsir", 3, 2)).toBe(T.candidatesNoMatch);
      });
   });
}
