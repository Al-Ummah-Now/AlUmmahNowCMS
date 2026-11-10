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
      expect([...covered].sort()).toEqual(["home", "page", "post", "posts", "site", "sitemap", "videos"]);
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
   });
});
