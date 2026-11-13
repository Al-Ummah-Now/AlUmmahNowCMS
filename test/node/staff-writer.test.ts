import { describe, expect, it } from "vitest";
import { scopeStaffListUrl, staffWriterApiVerdict, staffWriterScreenAllowed } from "../../src/lib/staff-writer.ts";

describe("staff writers (auth Writer, SS18)", () => {
   it.each([
      ["GET", "/api/data/entity/posts", "scope-list"],
      ["POST", "/api/data/entity/posts", "allow"],
      ["POST", "/api/data/entity/posts/fn/count", "scope-count"],
      ["GET", "/api/data/entity/posts/12", "staff-post"],
      ["PATCH", "/api/data/entity/posts/12", "staff-post"],
      ["POST", "/api/media/entity/posts/12/cover", "staff-post"],
      ["DELETE", "/api/data/entity/posts/12", "deny"],
      ["POST", "/api/data/entity/pages", "deny"],
      ["GET", "/api/data/entity/nav_items", "deny"],
      ["POST", "/api/media/upload", "allow"],
      ["GET", "/api/system/config", "deny"],
   ])("%s %s → %s", (method, path, kind) => expect(staffWriterApiVerdict(method, path).kind).toBe(kind));

   it("screens: posts, history, preview and tools; nothing of editors' or scholars'", () => {
      for (const p of ["/", "/posts", "/posts/new", "/posts/3", "/posts/3/history", "/library", "/admin/api/suggest", "/admin/api/ai/jobs", "/admin/api/translation-flags", "/preview/posts/3", "/picker/api/search"]) {
         expect(staffWriterScreenAllowed("GET", p), p).toBe(true);
      }
      for (const p of ["/pages", "/pages/1", "/timeline", "/featuring", "/scholars", "/scholars/me", "/write", "/navigation", "/site", "/people", "/deleted", "/glossary", "/admin/api/featuring/posts/1", "/admin/api/timeline/videos", "/preview/pages/1"]) {
         expect(staffWriterScreenAllowed("GET", p), p).toBe(false);
      }
   });

   it("lists are limited to posts without a scholar author, whatever the caller asks", () => {
      const url = scopeStaffListUrl(new URL(`https://cms.test/api/data/entity/posts?where=${encodeURIComponent(JSON.stringify({ locale: "en", author_sub: "someone", $or: [{ id: 1 }] }))}`));
      expect(JSON.parse(url.searchParams.get("where")!)).toEqual({ locale: "en", author_sub: { $isnull: true } });
   });
});
