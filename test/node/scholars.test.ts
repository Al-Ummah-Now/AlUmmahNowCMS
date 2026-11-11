import { describe, expect, it } from "vitest";
import { writerScreenAllowed } from "../../src/lib/scholars/access.ts";
import { backoffMs, externalIdOf } from "../../src/lib/scholars/community.ts";
import { scopeListUrl, scopeWhere, writerApiVerdict } from "../../src/lib/scholars/ownership.ts";
import { scholarName, slugify, validateScholarInput } from "../../src/lib/scholars/profiles.ts";

describe("writerApiVerdict", () => {
   it.each([
      ["GET", "/api/data/entity/posts", "scope-list"],
      ["POST", "/api/data/entity/posts", "create-post"],
      ["POST", "/api/data/entity/posts/fn/count", "scope-count"],
      ["GET", "/api/data/entity/posts/12", "own-post"],
      ["PATCH", "/api/data/entity/posts/12", "own-post"],
      ["DELETE", "/api/data/entity/posts/12", "own-post"],
      ["POST", "/api/media/entity/posts/12/cover", "own-post"],
      ["GET", "/api/data/entity/media", "allow"],
      ["POST", "/api/media/upload", "allow"],
      ["GET", "/api/auth/me", "allow"],
      ["PATCH", "/api/data/entity/posts", "deny"],
      ["GET", "/api/data/entity/pages", "deny"],
      ["POST", "/api/data/entity/curated_videos", "deny"],
      ["GET", "/api/data/entity/users", "deny"],
      ["GET", "/api/data/entity/posts/12/cover", "deny"],
      ["DELETE", "/api/media/file/a.png", "deny"],
      ["POST", "/api/media/entity/pages/3/cover", "deny"],
      ["GET", "/api/system/config", "deny"],
   ])("%s %s → %s", (method, path, kind) => expect(writerApiVerdict(method, path).kind).toBe(kind));
});

describe("scoping a writer's filters", () => {
   it("forces author_sub and drops top-level operators", () => {
      expect(scopeWhere({ status: "draft", author_sub: "other", $or: [{ id: 1 }] }, "me")).toEqual({ status: "draft", author_sub: "me" });
      const url = scopeListUrl(new URL('https://cms.test/api/data/entity/posts?where={"locale":"en"}&limit=5'), "me");
      expect(JSON.parse(url.searchParams.get("where")!)).toEqual({ locale: "en", author_sub: "me" });
      expect(url.searchParams.get("limit")).toBe("5");
      expect(JSON.parse(scopeListUrl(new URL("https://cms.test/api/data/entity/posts?where=nope"), "me").searchParams.get("where")!)).toEqual({ author_sub: "me" });
   });
});

describe("writerScreenAllowed", () => {
   it("allows their articles, profile and tools; nothing of staff's", () => {
      for (const p of ["/", "/posts", "/posts/new", "/posts/3", "/posts/3/history", "/scholars/me", "/admin/api/scholars/me", "/admin/api/suggest", "/admin/api/ai/jobs", "/picker/api/search", "/preview/posts/3", "/admin/api/revisions/9/restore"]) {
         expect(writerScreenAllowed("GET", p), p).toBe(true);
      }
      for (const p of ["/pages", "/pages/1", "/timeline", "/featuring", "/scholars", "/scholars/3", "/navigation", "/site", "/library", "/people", "/deleted", "/admin/api/timeline/videos", "/admin/api/featuring/posts/1", "/admin/api/trash", "/preview/pages/1"]) {
         expect(writerScreenAllowed("GET", p), p).toBe(false);
      }
   });
});

describe("profiles", () => {
   it("slugify makes url slugs and avoids reserved words", () => {
      expect(slugify("Dr. Aisha Al-Amin")).toBe("dr-aisha-al-amin");
      expect(slugify("yusuf.ali@example.com")).toBe("yusuf-ali");
      expect(slugify("Émile Zola")).toBe("emile-zola");
      expect(slugify("محمد بن صالح")).toBe("muhammad-bn-salh");
      expect(slugify("🌙")).toBe("scholar");
      expect(slugify("rss")).toBe("scholar");
   });
   it("scholarName falls back to the other language, then the slug", () => {
      expect(scholarName({ name_en: "A", name_ar: "ب", slug: "a" }, "ar")).toBe("ب");
      expect(scholarName({ name_en: "A", name_ar: null, slug: "a" }, "ar")).toBe("A");
      expect(scholarName({ name_en: null, name_ar: null, slug: "a" }, "en")).toBe("a");
   });
   it("validates edits; channels must be the scholar's own", () => {
      expect(validateScholarInput({ name_en: "  Aisha  ", bio_ar: "", slug: "aisha" }, [])).toEqual({ name_en: "Aisha", bio_ar: null, slug: "aisha" });
      expect(validateScholarInput({ channel_ids: ["c1", "c1"] }, ["c1"])).toEqual({ channel_ids: '["c1"]' });
      expect(() => validateScholarInput({ channel_ids: ["c2"] }, ["c1"])).toThrow("not_your_channel");
      expect(() => validateScholarInput({ channel_ids: ["c1"] }, null)).toThrow("channels_unavailable");
      expect(() => validateScholarInput({ slug: "Not OK" }, [])).toThrow("bad_slug");
      expect(() => validateScholarInput({ slug: "rss" }, [])).toThrow("bad_slug");
      expect(() => validateScholarInput({ name_en: "x".repeat(121) }, [])).toThrow("too_long_name");
      expect(() => validateScholarInput({ avatar_media_id: "abc" }, [])).toThrow("bad_avatar");
   });
});

describe("community sync", () => {
   it("backs off 1, 2, 4 … minutes up to 6 hours, keyed by the post", () => {
      expect(backoffMs(1)).toBe(60_000);
      expect(backoffMs(3)).toBe(240_000);
      expect(backoffMs(20)).toBe(6 * 60 * 60 * 1000);
      expect(externalIdOf(42)).toBe("cms-42");
   });
});
