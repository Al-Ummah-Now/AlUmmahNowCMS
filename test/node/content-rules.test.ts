import { describe, expect, it } from "vitest";
import { publishState } from "../../src/lib/schedule.ts";
import { applyRules, ContentRuleError, nextVersion, validNavUrl, versionCandidates } from "../../src/lib/content-rules.ts";

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
   it("validates social links, curated ref ids and snapshot thumbnails", () => {
      expect(() => applyRules("site_settings", { social: [{ kind: "x", url: "https://x.com/a" }] }, "create")).not.toThrow();
      expect(() => applyRules("site_settings", { social: [{ kind: "x", url: "javascript:alert(1)" }] }, "create")).toThrow(/social/);
      expect(() => applyRules("site_settings", { social: "https://x.com" }, "create")).toThrow(/social/);
      expect(() => applyRules("curated_videos", { ref_id: "../x" }, "create")).toThrow(/ref_id/);
      expect(() => applyRules("curated_videos", { ref_id: "abc-123", snapshot: { title: "t", thumbnail_url: "javascript:x" } }, "create")).toThrow(/snapshot/);
      expect(() => applyRules("curated_videos", { ref_id: "abc-123", snapshot: { title: "t", thumbnail_url: null, channel_name: null } }, "create")).not.toThrow();
   });
   it("does not touch non-content entities", () => {
      const d: Record<string, unknown> = { email: "x" };
      applyRules("users", d, "create", null, now);
      expect(d).toEqual({ email: "x" });
   });
});

describe("scheduled publishing (publish_at, #7)", () => {
   const later = "2026-11-09T08:30:00.000Z";
   it("scheduling a draft: published_at is the go-live time, not the save time", () => {
      const d: Record<string, unknown> = { status: "published", publish_at: later };
      applyRules("posts", d, "update", { status: "draft", published_at: null }, now);
      expect(d.publish_at).toEqual(new Date(later));
      expect(d.published_at).toEqual(new Date(later));
      expect(publishState({ status: "published", publish_at: later }, now.getTime())).toBe("scheduled");
   });
   it("rescheduling before go-live moves published_at with it", () => {
      const d: Record<string, unknown> = { status: "published", publish_at: "2026-11-10T00:00:00.000Z" };
      applyRules("pages", d, "update", { status: "published", publish_at: later, published_at: later }, now);
      expect(d.published_at).toEqual(new Date("2026-11-10T00:00:00.000Z"));
   });
   it("publish now on a scheduled row: published_at becomes now", () => {
      const d: Record<string, unknown> = { status: "published", publish_at: null };
      applyRules("posts", d, "update", { status: "published", publish_at: later, published_at: later }, now);
      expect(d.publish_at).toBeNull();
      expect(d.published_at).toBe(now);
   });
   it("unscheduling clears the schedule and the go-live that never came", () => {
      const d: Record<string, unknown> = { status: "draft" };
      applyRules("posts", d, "update", { status: "published", publish_at: later, published_at: later }, now);
      expect(d.publish_at).toBeNull();
      expect(d.published_at).toBeNull();
   });
   it("once live, published_at never moves, even when scheduled again after an unpublish", () => {
      const d: Record<string, unknown> = { status: "published", publish_at: later, published_at: later };
      applyRules("posts", d, "update", { status: "draft", published_at: "2026-01-01T00:00:00.000Z" }, now);
      expect("published_at" in d).toBe(false);
      expect(d.publish_at).toEqual(new Date(later));
   });
   it("an edit that does not touch status keeps a scheduled row scheduled", () => {
      const d: Record<string, unknown> = { title: "New title" };
      applyRules("pages", d, "update", { status: "published", publish_at: later, published_at: later }, now);
      expect(d.published_at).toEqual(new Date(later));
      expect("publish_at" in d).toBe(false);
   });
   it("a draft never carries a schedule; a bad date is refused", () => {
      const d: Record<string, unknown> = { slug: "a", status: "draft", publish_at: later };
      applyRules("posts", d, "create", null, now);
      expect(d.publish_at).toBeNull();
      expect(() => applyRules("posts", { status: "published", publish_at: "next tuesday" }, "create", null, now)).toThrow(/publish_at/);
      const empty: Record<string, unknown> = { status: "published", publish_at: "" };
      applyRules("posts", empty, "create", null, now);
      expect(empty.publish_at).toBeNull();
      expect(empty.published_at).toBe(now);
   });
   it("publishState: draft, scheduled, published (an elapsed schedule is published)", () => {
      const t = now.getTime();
      expect(publishState({ status: "draft", publish_at: later }, t)).toBe("draft");
      expect(publishState({ status: "published", publish_at: null }, t)).toBe("published");
      expect(publishState({ status: "published", publish_at: "2026-11-08T09:59:59.000Z" }, t)).toBe("published");
      expect(publishState(null, t)).toBe("draft");
   });
});

describe("optimistic lock helpers", () => {
   it("nextVersion is now, but always after the version it replaces", () => {
      const t = "2026-11-08T10:00:00.000Z";
      expect(nextVersion(t, new Date("2026-11-08T10:00:05.000Z")).toISOString()).toBe("2026-11-08T10:00:05.000Z");
      expect(nextVersion(t, new Date(t)).toISOString()).toBe("2026-11-08T10:00:00.001Z");
      expect(nextVersion(t, new Date("2026-11-08T09:00:00.000Z")).toISOString()).toBe("2026-11-08T10:00:00.001Z");
      expect(nextVersion(null, now)).toBe(now);
   });
   it("versionCandidates accepts the stored string and its ISO form; null means a row never stamped", () => {
      expect(versionCandidates("2026-11-08T10:00:00.000Z")).toEqual(["2026-11-08T10:00:00.000Z"]);
      expect(versionCandidates(Date.parse("2026-11-08T10:00:00Z"))).toEqual(["2026-11-08T10:00:00.000Z"]);
      expect(versionCandidates(null)).toBeNull();
      expect(versionCandidates("")).toBeNull();
      expect(() => versionCandidates({})).toThrow(ContentRuleError);
   });
});
