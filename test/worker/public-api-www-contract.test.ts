/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed JSON responses in assertions */
/**
 * The committed public API snapshot (fixtures/public-api-contract.json, written through the
 * staff screens' own API calls) must satisfy what www reads (test/www-contract.ts). The snapshot
 * test only says "nothing changed"; this one says "www can still render it", so regenerating the
 * snapshot after an API change cannot silently break www.
 */
import { describe, expect, it } from "vitest";
import snapshot from "./fixtures/public-api-contract.json";
import { endpointOf, wwwViolations } from "../www-contract.ts";

const CMS = "https://cms.test"; // PUBLIC_URL in vitest.config.ts

type Entry = { status: number; cache: string | null; etag: boolean; body: unknown };
const entries = Object.entries(snapshot as Record<string, Entry>);

/** The snapshot's placeholders back to values of the real types. */
function restore(v: unknown, key?: string): unknown {
   if (Array.isArray(v)) return v.map((x) => restore(x));
   if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, restore(x, k)]));
   if (v === "<iso-date>") return "2026-01-01T00:00:00.000Z";
   if (v === "<id>" && key === "id") return 1;
   return v;
}

describe("public API satisfies www's contract", () => {
   it("covers every endpoint www reads", () => {
      const covered = new Set(entries.filter(([, e]) => e.status === 200).map(([p]) => endpointOf(p)));
      expect([...covered].sort()).toEqual(["cards", "home", "page", "post", "posts", "site", "sitemap", "videos"]);
   });

   for (const [path, entry] of entries) {
      const endpoint = endpointOf(path);
      if (!endpoint) continue;
      it(`${path} → ${entry.status}`, () => {
         if (entry.status === 200) {
            expect(wwwViolations(endpoint, restore(entry.body), CMS)).toEqual([]);
            // www keeps CMS responses in its edge cache; they must be shared-cacheable
            expect(entry.cache).toMatch(/\bpublic\b/);
         } else if (endpoint === "page" || endpoint === "post") {
            // www caches exactly 404 as "not found"; any other status reads as a CMS outage
            expect(entry.status).toBe(404);
         } else {
            // Only invalid input (www never sends it) may fail on list endpoints
            expect(path).toMatch(/locale=(?!en|ar)/);
            expect(entry.status).toBe(400);
         }
      });
   }

   it("the schema rejects what would break www (it is not vacuous)", () => {
      const home = restore((snapshot as Record<string, Entry>)["/api/public/v1/home?locale=en"].body) as {
         settings: Record<string, unknown>;
         videos: Record<string, unknown>[];
         posts: Record<string, unknown>[];
      };
      const page = restore((snapshot as Record<string, Entry>)["/api/public/v1/pages/about?locale=en"].body) as Record<string, unknown>;
      const site = restore((snapshot as Record<string, Entry>)["/api/public/v1/site?locale=en"].body) as { nav: { header: Record<string, unknown>[] } };
      const clone = <T>(x: T): T => structuredClone(x);
      const h1 = clone(home);
      delete h1.posts[0].published_at;
      expect(wwwViolations("home", h1, CMS)).toEqual(["home.posts[0].published_at: expected ISO date-time, got undefined"]);
      const h2 = clone(home);
      h2.videos[0].kind = "short";
      expect(wwwViolations("home", h2, CMS)[0]).toMatch(/^home\.videos\[0\]\.kind: expected video\|playlist\|channel/);
      const h3 = clone(home);
      h3.settings.locale = "fr";
      expect(wwwViolations("home", h3, CMS)[0]).toMatch(/^home\.settings\.locale/);
      const p1 = clone(page);
      p1.cover = { ...(p1.cover as object), url: "https://elsewhere.example/x.png" };
      expect(wwwViolations("page", p1, CMS)[0]).toMatch(/^page\.cover\.url: expected URL on https:\/\/cms\.test/);
      const p2 = clone(page);
      p2.alternates = "ar";
      expect(wwwViolations("page", p2, CMS)[0]).toMatch(/^page\.alternates: expected array/);
      const s1 = clone(site);
      s1.nav.header[0].url = "//evil.example/";
      expect(wwwViolations("site", s1, CMS)[0]).toMatch(/^site\.nav\.header\[0\]\.url/);
      // Additive fields are fine
      expect(wwwViolations("page", { ...page, new_field: 1 }, CMS)).toEqual([]);

      // Blocks and slides (the composed page and the card post)
      const built = restore((snapshot as Record<string, Entry>)["/api/public/v1/pages/built?locale=en"].body) as { blocks: Record<string, any>[] };
      expect(built.blocks.map((b) => b.type)).toEqual(["markdown", "image", "gallery", "posts", "posts", "cards", "videos", "video", "cta", "columns", "quote", "divider"]);
      const b1 = clone(built);
      b1.blocks[1].image.url = "https://elsewhere.example/x.png";
      expect(wwwViolations("page", b1, CMS)[0]).toMatch(/^page\.blocks\[1\]<image>\.image\.url/);
      const b2 = clone(built);
      b2.blocks[8].url = "javascript:alert(1)";
      expect(wwwViolations("page", b2, CMS)[0]).toMatch(/^page\.blocks\[8\]<cta>\.url/);
      const b3 = clone(built);
      b3.blocks[2].columns = 7;
      expect(wwwViolations("page", b3, CMS)[0]).toMatch(/<gallery>\.columns/);
      // An unknown future block type is skipped by www, so it is not a violation
      expect(wwwViolations("page", { ...built, blocks: [...built.blocks, { id: "z", type: "future" }] }, CMS)).toEqual([]);
      // A page from a CMS that predates blocks is still valid (www renders the body)
      const { blocks: _b, ...noBlocks } = built;
      expect(wwwViolations("page", noBlocks, CMS)).toEqual([]);
      const story = restore((snapshot as Record<string, Entry>)["/api/public/v1/posts/story?locale=en"].body) as { slides: Record<string, any>[] };
      const s2 = clone(story);
      s2.slides[0].position = "left";
      expect(wwwViolations("post", s2, CMS)[0]).toMatch(/^post\.slides\[0\]\.position/);
      const grid = restore((snapshot as Record<string, Entry>)["/api/public/v1/cards?locale=en"].body) as { items: Record<string, any>[] };
      const g1 = clone(grid);
      g1.items[0].kind = "article";
      expect(wwwViolations("cards", g1, CMS)[0]).toMatch(/^cards\.items\[0\]\.kind/);
   });
});
