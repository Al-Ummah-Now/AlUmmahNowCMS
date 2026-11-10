import { describe, expect, it } from "vitest";
import {
   BLOCK_TYPES,
   BlockError,
   blockMediaIds,
   blockPostIds,
   blockTexts,
   blockVideoRefs,
   blocksToMarkdown,
   bodyAsBlocks,
   emptyBlock,
   isComplete,
   MAX_BLOCKS,
   normalizeBlocks,
   normalizeSlides,
   slidesToMarkdown,
   slideTexts,
   storedBlocks,
   validBlockUrl,
   withBlockTexts,
} from "../../src/lib/blocks.ts";

const full = [
   { id: "a", type: "markdown", text: "# Hi\r\n\nBody" },
   { id: "b", type: "image", media_id: 3, alt: "Lantern", caption: "At night", size: "wide" },
   { id: "c", type: "gallery", columns: 2, items: [{ media_id: 4, alt: "x", caption: "" }, { media_id: "5", alt: "", caption: "y" }] },
   { id: "d", type: "posts", heading: "News", mode: "picked", post_ids: [9, 9, 7], limit: 3 },
   { id: "e", type: "videos", heading: "Watch", items: [{ kind: "playlist", ref_id: "pl-1", title_override: "" }] },
   { id: "f", type: "video", kind: "video", ref_id: "vid-1", caption: "A talk" },
   { id: "g", type: "cta", heading: "Join", text: "Be part", label: "Sign up", url: "/join", tone: "quiet" },
   { id: "h", type: "columns", text: "Left", media_id: 6, alt: "", caption: "", image_side: "start" },
   { id: "i", type: "quote", variant: "callout", text: "Note\nthis", cite: "Editor" },
   { id: "j", type: "divider", style: "line", size: "l" },
   { id: "k", type: "cards", heading: "Stories", tag: "seerah", page_size: 9, filter: false },
];

describe("normalizeBlocks", () => {
   it("accepts every type, fills defaults and drops unknown keys", () => {
      const out = normalizeBlocks([...full, { id: "z", type: "divider", extra: "nope" }]);
      expect(out.map((b) => b.type)).toEqual([...full.map((b) => b.type), "divider"]);
      expect(out[0]).toEqual({ id: "a", type: "markdown", text: "# Hi\n\nBody" });
      expect(out[2]).toMatchObject({ items: [{ media_id: 4 }, { media_id: 5 }] });
      expect(out[3]).toMatchObject({ post_ids: [9, 7], tag: "" });
      expect(out.at(-1)).toEqual({ id: "z", type: "divider", style: "line", size: "m" });
      expect(new Set(BLOCK_TYPES)).toEqual(new Set(out.map((b) => b.type)));
   });

   it("accepts a JSON string and null", () => {
      expect(normalizeBlocks(JSON.stringify([full[0]]))).toHaveLength(1);
      expect(normalizeBlocks(null)).toEqual([]);
   });

   it.each([
      [{}, "not_list"],
      [Array.from({ length: MAX_BLOCKS + 1 }, (_, i) => ({ id: `x${i}`, type: "divider" })), "too_many"],
      [[{ id: "a", type: "nope" }], "bad_type"],
      [[{ id: "A B", type: "divider" }], "bad_id"],
      [[{ id: "a", type: "divider" }, { id: "a", type: "divider" }], "duplicate_id"],
      [[{ id: "a", type: "markdown", text: "x".repeat(20_001) }], "too_long"],
      [[{ id: "a", type: "cta", label: "Go", url: "javascript:alert(1)" }], "bad_url"],
      [[{ id: "a", type: "cta", label: "Go", url: "//evil.test" }], "bad_url"],
      [[{ id: "a", type: "cta", label: "Go", url: "http://insecure.test" }], "bad_url"],
      [[{ id: "a", type: "video", ref_id: "../x" }], "bad_ref"],
      [[{ id: "a", type: "image", media_id: -1 }], "bad_ref"],
      [[{ id: "a", type: "gallery", items: Array.from({ length: 25 }, () => ({ media_id: 1 })) }], "too_many_items"],
      [[{ id: "a", type: "posts", limit: 50 }], "bad_value"],
      [[{ id: "a", type: "divider", style: "dots" }], "bad_value"],
      [[{ id: "a", type: "cards", page_size: 1 }], "bad_value"],
   ])("rejects %j with %s", (input, code) => {
      try {
         normalizeBlocks(input);
         throw new Error("accepted");
      } catch (e) {
         expect(e).toBeInstanceOf(BlockError);
         expect((e as BlockError).code).toBe(code);
      }
   });

   it("stored blocks never throw", () => {
      expect(storedBlocks("{not json")).toEqual([]);
      expect(storedBlocks([{ id: "a", type: "nope" }])).toEqual([]);
   });
});

describe("helpers", () => {
   const blocks = normalizeBlocks(full);

   it("the URL rule matches the navigation rule", () => {
      expect(validBlockUrl("/about")).toBe(true);
      expect(validBlockUrl("https://x.test/a")).toBe(true);
      expect(validBlockUrl("/a b")).toBe(false);
      expect(validBlockUrl("mailto:x@y")).toBe(false);
   });

   it("collects references", () => {
      expect(blockMediaIds(blocks)).toEqual([3, 4, 5, 6]);
      expect(blockPostIds(blocks)).toEqual([9, 7]);
      expect(blockVideoRefs(blocks)).toEqual([{ kind: "playlist", ref_id: "pl-1" }, { kind: "video", ref_id: "vid-1" }]);
   });

   it("an empty block of each type is valid and incomplete unless it needs nothing", () => {
      for (const t of BLOCK_TYPES) {
         const b = emptyBlock(t, "x1");
         expect(normalizeBlocks([b])).toEqual([b]);
         expect(isComplete(b)).toBe(t === "divider" || t === "cards" || t === "posts");
      }
   });

   it("one rich-text block keeps the old body exactly", () => {
      const body = "# About\n\nText with **bold**\n\n::video[vid-1]\n";
      expect(blocksToMarkdown(bodyAsBlocks(body))).toBe(body.trim());
      expect(bodyAsBlocks("   ")).toEqual([]);
   });

   it("derives a markdown body for readers that predate blocks", () => {
      expect(blocksToMarkdown(blocks)).toBe(
         ["# Hi\n\nBody", "## News", "## Watch", "::video[vid-1]", "**Join**\n\nBe part\n\n[Sign up](/join)", "Left", "> Note\n> this\n>\n> — Editor", "---", "## Stories"].join("\n\n"),
      );
   });

   it("exposes every reader-facing text for translation and puts it back", () => {
      const texts = blockTexts(blocks);
      expect(texts.map((t) => t.path)).toEqual(["a.text", "b.alt", "b.caption", "c.items.0.alt", "c.items.1.caption", "d.heading", "e.heading", "f.caption", "g.heading", "g.text", "g.label", "h.text", "i.text", "i.cite", "k.heading"]);
      expect(texts.find((t) => t.path === "a.text")?.markdown).toBe(true);
      const ar = withBlockTexts(blocks, { "b.caption": "في الليل", "c.items.1.caption": "ص", "g.label": "سجّل", "nope.text": "x" });
      expect(ar[1]).toMatchObject({ caption: "في الليل", media_id: 3 });
      expect((ar[2] as { items: { caption: string }[] }).items[1].caption).toBe("ص");
      expect(ar[6]).toMatchObject({ label: "سجّل", url: "/join" });
   });
});

describe("slides", () => {
   it("normalizes, defaults the position, and requires unique ids", () => {
      const s = normalizeSlides([{ id: "s1", media_id: 2, heading: " Title \n", body: "Short", position: "top" }, { id: "s2" }]);
      expect(s).toEqual([
         { id: "s1", media_id: 2, alt: "", heading: "Title", body: "Short", position: "top" },
         { id: "s2", media_id: null, alt: "", heading: "", body: "", position: "bottom" },
      ]);
      expect(() => normalizeSlides([{ id: "s1" }, { id: "s1" }])).toThrow(BlockError);
      expect(() => normalizeSlides([{ id: "s1", position: "left" }])).toThrow(/text position/);
      expect(() => normalizeSlides([{ id: "s1", body: "x".repeat(401) }])).toThrow(/longer/);
   });

   it("a card post's body comes from slides that have an image", () => {
      const s = normalizeSlides([{ id: "a", media_id: 1, heading: "One", body: "First" }, { id: "b", heading: "No image" }, { id: "c", media_id: 2, body: "Third" }]);
      expect(slidesToMarkdown(s)).toBe("## One\n\nFirst\n\nThird");
      expect(slideTexts(s).map((t) => t.path)).toEqual(["a.heading", "a.body", "b.heading", "c.body"]);
   });
});
