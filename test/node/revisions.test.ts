import { describe, expect, it } from "vitest";
import { changedFields, lineDiff } from "../../src/lib/revisions.ts";

describe("revision diffs", () => {
   it("changedFields ignores bookkeeping and treats JSON text, dates, 0/1 and empty strings as their values", () => {
      const prev = { id: 1, title: "A", tags: '["x"]', show_in_sitemap: 1, summary: null, published_at: "2026-11-08T10:00:00.000Z", updated_at: "1" };
      const next = { id: 1, title: "A", tags: ["x"], show_in_sitemap: true, summary: "", published_at: new Date("2026-11-08T10:00:00.000Z"), updated_at: "2" };
      expect(changedFields(prev, next)).toEqual([]);
      expect(changedFields(prev, { ...next, title: "B", tags: [] })).toEqual(["tags", "title"]);
      expect(changedFields(null, { id: 2, title: "New", body: "", status: "draft", created_at: "x" })).toEqual(["status", "title"]);
   });
   it("lineDiff keeps common lines and marks removed and added ones in order", () => {
      expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
         { op: "same", text: "a" },
         { op: "del", text: "b" },
         { op: "add", text: "B" },
         { op: "same", text: "c" },
         { op: "add", text: "d" },
      ]);
      expect(lineDiff("", "x")).toEqual([
         { op: "del", text: "" },
         { op: "add", text: "x" },
      ]);
   });
   it("very long texts fall back to old-then-new instead of a quadratic diff", () => {
      const big = Array.from({ length: 1600 }, (_, i) => `l${i}`).join("\n");
      const out = lineDiff(big, `${big}\nmore`);
      expect(out.filter((l) => l.op === "del")).toHaveLength(1600);
   });
});
