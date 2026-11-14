import { describe, expect, it } from "vitest";
import { samePath, withQuery } from "../../src/lib/header";

// A request path is echoed into the header's language and light/dark links: it must never become a
// link to another site (security review, 2026-11-14).
describe("withQuery keeps self-links on this site", () => {
   it.each([
      ["//evil.example", "/evil.example"],
      ["///evil.example/x", "/evil.example/x"],
      ["/\\evil.example", "/evil.example"],
      ["\\\\evil.example", "/evil.example"],
      ["evil.example", "/"],
      ["/admin/posts", "/admin/posts"],
   ])("%s → %s", (path, expected) => {
      expect(samePath(path)).toBe(expected);
   });

   it("keeps the query and sets the parameter", () => {
      expect(withQuery("//evil.example", "q=a&lang=en", "lang", "ar")).toBe("/evil.example?q=a&lang=ar");
   });
});
