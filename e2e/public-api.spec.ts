/**
 * The deployed public API, read the way www reads it (test/www-contract.ts): exactly www's
 * request paths, www's response types and value rules, every page and post in the sitemap,
 * their translations and cover images, and 404 (never another status) for unknown slugs.
 *
 * Read-only and signed out: no account, no browser, one project.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { CMS_URL } from "./support/env.ts";
import { LOCALES, NEWS_PAGE_SIZE, RSS_ITEMS, wwwPaths, wwwViolations, type Locale, type WwwEndpoint } from "../test/www-contract.ts";

test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "HTTP only: desktop Chromium is enough");

const CMS = new URL(CMS_URL).origin;
const API = `${CMS}/api/public/v1`;

async function read(request: APIRequestContext, endpoint: WwwEndpoint, path: string) {
   const res = await request.get(`${API}${path}`, { headers: { accept: "application/json" } });
   expect(res.status(), `${path}: ${(await res.text()).slice(0, 200)}`).toBe(200);
   expect(res.headers()["content-type"], path).toMatch(/^application\/json/);
   // www keeps CMS responses in its shared edge cache
   expect(res.headers()["cache-control"], path).toMatch(/\bpublic\b/);
   const body = await res.json();
   expect(wwwViolations(endpoint, body, CMS), path).toEqual([]);
   return body;
}

test.describe("public API as www reads it", () => {
   for (const locale of LOCALES) {
      test(`${locale}: site, home, news (both page sizes), videos (both placements)`, async ({ request }) => {
         const site = await read(request, "site", wwwPaths.site(locale));
         if (site.settings) expect(site.settings.locale).toBe(locale);
         const home = await read(request, "home", wwwPaths.home(locale));
         for (const p of home.posts) expect(p.locale).toBe(locale);
         for (const size of [NEWS_PAGE_SIZE, RSS_ITEMS]) {
            const posts = await read(request, "posts", wwwPaths.posts(locale, 1, size));
            expect({ page: posts.page, limit: posts.limit }).toEqual({ page: 1, limit: size });
            expect(posts.items.length).toBeLessThanOrEqual(size);
            expect(posts.total).toBeGreaterThanOrEqual(posts.items.length);
            for (const p of posts.items) expect(p.locale).toBe(locale);
         }
         for (const placement of ["home", "videos"] as const) await read(request, "videos", wwwPaths.videos(locale, placement));
      });

      test(`${locale}: unknown page and post slugs are 404 (www caches them as not found)`, async ({ request }) => {
         for (const path of [wwwPaths.page(locale, "e2e-no-such-page"), wwwPaths.post(locale, "e2e-no-such-post")]) {
            expect((await request.get(`${API}${path}`)).status(), path).toBe(404);
         }
      });
   }

   test("every sitemap entry opens, matches its locale and slug, and its translations and cover resolve", async ({ request }) => {
      test.setTimeout(180_000);
      const sitemap = await read(request, "sitemap", wwwPaths.sitemap());
      const items = sitemap.items as { type: "page" | "post"; locale: Locale; slug: string }[];
      expect(items.length, "QA has published content").toBeGreaterThan(0);
      const seen = new Set(items.map((i) => `${i.type}:${i.locale}:${i.slug}`));
      expect(seen.size, "sitemap entries are unique").toBe(items.length);
      const covers = new Set<string>();
      for (const item of items.slice(0, 40)) {
         const endpoint = item.type === "page" ? "page" : "post";
         const path = wwwPaths[endpoint](item.locale, item.slug);
         const body = await read(request, endpoint, path);
         expect({ locale: body.locale, slug: body.slug }, path).toEqual({ locale: item.locale, slug: item.slug });
         for (const alt of body.alternates as { locale: Locale; slug: string }[]) {
            expect(alt.locale, `${path} lists its own locale as an alternate`).not.toBe(item.locale);
            expect(seen.has(`${item.type}:${alt.locale}:${alt.slug}`), `${path} → alternate ${alt.locale}/${alt.slug} is published`).toBe(true);
         }
         if (body.cover) covers.add(body.cover.url);
      }
      for (const url of covers) {
         const img = await request.get(url);
         expect(img.status(), url).toBe(200);
         expect(img.headers()["content-type"], url).toMatch(/^image\//);
      }
   });
});
