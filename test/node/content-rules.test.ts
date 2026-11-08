import { describe, expect, it } from "vitest";
import { applyRules, ContentRuleError, validNavUrl } from "../../src/lib/content-rules.ts";

const now = new Date("2026-11-08T10:00:00Z");

describe("content rules", () => {
   it("sets published_at on first publish, timestamps on create", () => {
      const d: Record<string, unknown> = { slug: "a", status: "published" };
      applyRules("posts", d, "create", null, now);
      expect(d).toMatchObject({ published_at: now, created_at: now, updated_at: now });
   });
   it("defaults status to draft and leaves published_at empty for drafts", () => {
      const d: Record<string, unknown> = { slug: "a" };
      applyRules("pages", d, "create", null, now);
      expect(d.status).toBe("draft");
      expect(d.published_at).toBeUndefined();
   });
   it("publishing a draft later sets published_at; it never moves or clears afterwards", () => {
      const first: Record<string, unknown> = { status: "published" };
      applyRules("posts", first, "update", { status: "draft", published_at: null }, now);
      expect(first.published_at).toBe(now);
      const again: Record<string, unknown> = { status: "draft", published_at: null };
      applyRules("posts", again, "update", { status: "published", published_at: "2026-01-01T00:00:00Z" }, now);
      expect("published_at" in again).toBe(false);
      expect(again.updated_at).toBe(now);
   });
   it("never lets an update change created_at", () => {
      const d: Record<string, unknown> = { title: "x", created_at: "1999-01-01" };
      applyRules("nav_items", d, "update", null, now);
      expect("created_at" in d).toBe(false);
   });
   it("rejects the reserved page slug home", () => {
      expect(() => applyRules("pages", { slug: "Home" }, "create")).toThrow(ContentRuleError);
      expect(() => applyRules("posts", { slug: "home", status: "draft" }, "create")).not.toThrow();
   });
   it("validates nav URLs", () => {
      expect(validNavUrl("/about")).toBe(true);
      expect(validNavUrl("https://videos.alummahnow.net")).toBe(true);
      for (const bad of ["//evil.example", "javascript:alert(1)", "http://insecure.example", "", "/a b", "/\\x", 5]) {
         expect(validNavUrl(bad)).toBe(false);
      }
      expect(() => applyRules("nav_items", { url: "javascript:alert(1)" }, "create")).toThrow(/nav_items.url/);
   });
   it("requires tags to be strings", () => {
      expect(() => applyRules("posts", { tags: ["a", 1] }, "create")).toThrow(/tags/);
      expect(() => applyRules("posts", { tags: "a" }, "create")).toThrow(/tags/);
   });
   it("does not touch non-content entities", () => {
      const d: Record<string, unknown> = { email: "x" };
      applyRules("users", d, "create", null, now);
      expect(d).toEqual({ email: "x" });
   });
});
