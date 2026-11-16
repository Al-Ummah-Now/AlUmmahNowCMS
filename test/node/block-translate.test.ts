/**
 * Page-builder Translate, the pure part (src/lib/block-translate.ts): the field list matches the
 * vendored pageBlockTexts, markdown keeps its markup (only text goes out), and packed answers map
 * back one to one or not at all.
 */
import { describe, expect, it } from "vitest";
import { BLOCK_TEXT_FIELDS, blockFieldValue, pack, pathString, rebuild, segment, unpack } from "../../src/lib/block-translate.ts";
import { normalizePageBlocks, PAGE_BLOCK_TYPES, pageBlockTexts, type PageBlock } from "../../src/lib/page-blocks.generated.ts";
import { samplePageBlocks } from "../../src/lib/page-blocks.sample.generated.ts";

const specPaths = (b: PageBlock) => {
   const spec = BLOCK_TEXT_FIELDS[b.type];
   const out = new Map<string, boolean>();
   for (const [k, md] of spec.fields) out.set(`${b.id}.${k}`, md);
   for (const [list, fields] of Object.entries(spec.lists ?? {})) {
      const items = (b as unknown as Record<string, unknown[]>)[list] ?? [];
      items.forEach((_, j) => fields.forEach(([k, md]) => out.set(`${b.id}.${list}.${j}.${k}`, md)));
   }
   return out;
};

describe("block text fields", () => {
   it("covers every block type", () => {
      expect(Object.keys(BLOCK_TEXT_FIELDS).sort()).toEqual([...PAGE_BLOCK_TYPES].sort());
   });

   it("names exactly the fields pageBlockTexts treats as reader text, with the same markdown flag", () => {
      // Every listed field filled, one item per list: pageBlockTexts must report the same set.
      const raw = PAGE_BLOCK_TYPES.map((type, i) => {
         const spec = BLOCK_TEXT_FIELDS[type];
         const b: Record<string, unknown> = { id: `b${i}`, type };
         for (const [k] of spec.fields) b[k] = `Text ${k}`;
         for (const [list, fields] of Object.entries(spec.lists ?? {})) b[list] = [Object.fromEntries(fields.map(([k]) => [k, `Item ${k}`]))];
         if (type === "videos") (b.items as Record<string, unknown>[])[0]!.ref_id = "abc";
         if (type === "video") b.ref_id = "abc";
         return b;
      });
      const blocks = normalizePageBlocks(raw);
      for (const b of blocks) {
         const expected = specPaths(b);
         const got = new Map(pageBlockTexts([b]).map((t) => [t.path, t.markdown]));
         expect(got, b.type).toEqual(expected);
      }
   });

   it("finds every text of the sample page (both languages)", () => {
      for (const l of ["en", "ar"] as const) {
         const blocks = normalizePageBlocks(samplePageBlocks(l));
         const known = new Map(blocks.flatMap((b) => [...specPaths(b)]));
         for (const t of pageBlockTexts(blocks)) expect(known.get(t.path), t.path).toBe(t.markdown);
      }
   });

   it("reads a stored block's field by path", () => {
      const [b] = normalizePageBlocks([{ id: "h", type: "hero", title: "Hi", buttons: [{ label: "Go", url: "/x", variant: "primary" }] }]);
      expect(blockFieldValue(b, { key: "title" })).toBe("Hi");
      expect(blockFieldValue(b, { list: "buttons", index: 0, key: "label" })).toBe("Go");
      expect(blockFieldValue(b, { list: "buttons", index: 3, key: "label" })).toBe("");
      expect(pathString({ list: "buttons", index: 0, key: "label" })).toBe("buttons.0.label");
   });
});

describe("segment", () => {
   const md = [
      "## Our **videos** ##",
      "",
      "Watch [live streams](https://videos.test/live) and *Shorts*, or write to hello@alummah.test.",
      "- First `code stays` item",
      "1. Second item",
      "> A quoted line",
      "::video[abc_123]",
      "---",
      "See https://alummah.test/about for more.",
   ].join("\n");

   it("sends only text: no markup, URLs, emails, code or video lines", () => {
      const s = segment(md, true);
      const sent = s.pieces.join("\n");
      for (const bad of ["#", "**", "*", "](", "https://", "hello@", "`", "::video", "---", ">"]) expect(sent).not.toContain(bad);
      expect(s.pieces).toContain("live streams");
      expect(s.pieces).toContain("videos");
      expect(s.pieces).toContain("A quoted line");
   });

   it("puts translations back with every piece of markup where it was", () => {
      const s = segment(md, true);
      const out = rebuild(s, s.pieces.map((p) => `«${p}»`));
      expect(out).toBe(
         [
            "## «Our» **«videos»** ##",
            "",
            "«Watch» [«live streams»](https://videos.test/live) «and» *«Shorts»*«, or write to» hello@alummah.test.",
            "- «First» `code stays` «item»",
            "1. «Second item»",
            "> «A quoted line»",
            "::video[abc_123]",
            "---",
            "«See» https://alummah.test/about «for more.»",
         ].join("\n"),
      );
      expect(rebuild(s, [])).toBe(md);
   });

   it("plain fields: markdown characters are text, links still stay out", () => {
      const s = segment("Save 2 **now** at https://x.test", false);
      expect(s.pieces).toEqual(["Save 2 **now** at"]);
      expect(segment("50%", false).pieces).toEqual([]);
   });

   it("cuts a very long line at sentence ends", () => {
      const long = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
      const s = segment(long, false);
      expect(s.pieces.length).toBeGreaterThan(1);
      expect(Math.max(...s.pieces.map((p) => p.length))).toBeLessThanOrEqual(1500);
      expect(rebuild(s, s.pieces)).toBe(long);
   });
});

describe("pack / unpack", () => {
   it("one piece goes as plain text; several as numbered lines under the cap", () => {
      expect(pack(["Hello"])).toEqual([{ ids: [0], text: "Hello" }]);
      const chunks = pack(["a".repeat(900), "b".repeat(900), "c"], 1800);
      expect(chunks.map((c) => c.ids)).toEqual([[0], [1, 2]]);
      expect(chunks[1]!.text).toBe(`[1] ${"b".repeat(900)}\n[2] c`);
   });

   it("maps answers back, Arabic-Indic numbers and wrapped lines included", () => {
      const c = { ids: [4, 7], text: "[1] Hello\n[2] World" };
      expect(unpack(c, "[١] مرحبا\n[٢] بالعالم\nكله")).toEqual(["مرحبا", "بالعالم كله"]);
   });

   it("rejects an answer that drops, repeats or invents a piece", () => {
      const c = { ids: [0, 1], text: "[1] a\n[2] b" };
      expect(unpack(c, "[1] أ")).toBeNull();
      expect(unpack(c, "[1] أ\n[1] ب")).toBeNull();
      expect(unpack(c, "[1] أ\n[2] ب\n[3] ج")).toBeNull();
      expect(unpack(c, "أ ب")).toBeNull();
   });
});
