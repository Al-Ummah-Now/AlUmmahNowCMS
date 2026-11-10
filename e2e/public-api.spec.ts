/**
 * The deployed public API, read the way www reads it (test/www-contract.ts): exactly www's
 * request paths, www's response types and value rules, every page and post in the sitemap,
 * their translations and cover images, and 404 (never another status) for unknown slugs.
 *
 * Reads are signed out, exactly as www makes them: no browser, one project. The sitemap test
 * cannot rely on the environment already having content (stage starts empty), so it publishes its
 * own page and post, each with a translation and the page with a cover, through the staff API as
 * the E2E admin, and deletes them afterwards (crash leftovers older than an hour go first).
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { ACCOUNTS, CMS_URL, hasCredentials } from "./support/env.ts";
import { sessionCookie } from "./support/sessions.ts";
import { LOCALES, NEWS_PAGE_SIZE, RSS_ITEMS, wwwPaths, wwwViolations, type Locale, type WwwEndpoint } from "../test/www-contract.ts";

test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "HTTP only: desktop Chromium is enough");

const CMS = new URL(CMS_URL).origin;
const API = `${CMS}/api/public/v1`;
const ENV = new URL(CMS).hostname;

/** Seeded rows: `sitemap-e2e-<base-36 time>`, so a crashed run's leftovers can be dated and swept. */
const SEED_PREFIX = "sitemap-e2e-";
const SEED_SLUG = `${SEED_PREFIX}${Date.now().toString(36)}`;
const SEED_KEY = `e2e-${SEED_SLUG}`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const seeded: { entity: "pages" | "posts"; id: number }[] = [];

let adminCookie = "";
async function staff(method: string, path: string, body?: unknown) {
   if (!adminCookie) adminCookie = await sessionCookie(ACCOUNTS.admin);
   const form = body instanceof FormData;
   const res = await fetch(`${CMS}${path}`, {
      method,
      headers: { cookie: adminCookie, origin: CMS, accept: "application/json", ...(body && !form ? { "content-type": "application/json" } : {}) },
      body: form ? body : body === undefined ? undefined : JSON.stringify(body),
   });
   const text = await res.text();
   expect(res.status, `${method} ${path}: ${text.slice(0, 200)}`).toBeLessThan(300);
   return (text ? JSON.parse(text) : null) as { data?: unknown; result?: unknown } | null;
}

/** Deletes seeded rows from runs that crashed before cleaning up (older than an hour, so a parallel run's rows stay). */
async function sweepLeftovers() {
   const cutoff = Date.now() - 60 * 60_000;
   for (const entity of ["pages", "posts"] as const) {
      const where = encodeURIComponent(JSON.stringify({ slug: { $like: `${SEED_PREFIX}*` } }));
      const res = await staff("GET", `/api/data/entity/${entity}?where=${where}&select=id,slug&limit=100`);
      for (const row of (res?.data as { id: number; slug: string }[] | undefined) ?? []) {
         const made = parseInt(row.slug.slice(SEED_PREFIX.length), 36);
         if (Number.isFinite(made) && made < cutoff) await staff("DELETE", `/api/data/entity/${entity}/${row.id}`);
      }
   }
}

async function create(entity: "pages" | "posts", data: Record<string, unknown>) {
   const res = await staff("POST", `/api/data/entity/${entity}`, data);
   const id = (res?.data as { id: number }).id;
   seeded.push({ entity, id });
   return id;
}

/** An English page with a cover and its Arabic translation, and the same pair of posts, all published. */
async function seedContent() {
   const page = await create("pages", { slug: SEED_SLUG, locale: "en", title: "Sitemap E2E", summary: "E2E", body: "Created by the CMS E2E suite.", show_in_sitemap: true, status: "published", translation_key: SEED_KEY });
   await create("pages", { slug: SEED_SLUG, locale: "ar", title: "اختبار خريطة الموقع", body: "أنشأته اختبارات الـ CMS.", show_in_sitemap: true, status: "published", translation_key: SEED_KEY });
   const fd = new FormData();
   fd.append("file", new File([PNG], "cover.png", { type: "image/png" }));
   const up = await staff("POST", `/api/media/entity/pages/${page}/cover?overwrite=true`, fd);
   await staff("PATCH", `/admin/api/media/${(up?.result as { id: number }).id}/alt`, { alt: "E2E cover" });
   await create("posts", { slug: SEED_SLUG, locale: "en", title: "Sitemap E2E", excerpt: "E2E", body: "Created by the CMS E2E suite.", status: "published", translation_key: SEED_KEY });
   await create("posts", { slug: SEED_SLUG, locale: "ar", title: "اختبار خريطة الموقع", body: "أنشأته اختبارات الـ CMS.", status: "published", translation_key: SEED_KEY });
}

async function removeSeeded() {
   for (const { entity, id } of seeded.splice(0).reverse()) await staff("DELETE", `/api/data/entity/${entity}/${id}`).catch(() => undefined);
}

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

   test.describe("with published content", () => {
      test.skip(!hasCredentials, "seeding needs QA_SEED_PASSWORD / SEED_PASSWORD");
      test.beforeAll(async () => {
         await sweepLeftovers();
         await seedContent();
      });
      test.afterAll(removeSeeded);

      test("every sitemap entry opens, matches its locale and slug, and its translations and cover resolve", async ({ request }) => {
         test.setTimeout(180_000);
         const sitemap = await read(request, "sitemap", wwwPaths.sitemap());
         const items = sitemap.items as { type: "page" | "post"; locale: Locale; slug: string }[];
         const seen = new Set(items.map((i) => `${i.type}:${i.locale}:${i.slug}`));
         expect(seen.size, "sitemap entries are unique").toBe(items.length);
         const mine = items.filter((i) => i.slug === SEED_SLUG);
         expect(mine.map((i) => `${i.type}:${i.locale}`).sort(), `${ENV} sitemap lists the page and post this test published`).toEqual(["page:ar", "page:en", "post:ar", "post:en"]);
         const covers = new Set<string>();
         let seededCover = "";
         // The seeded entries always, plus the environment's own content up to 40 entries.
         for (const item of [...mine, ...items.filter((i) => i.slug !== SEED_SLUG).slice(0, 40)]) {
            const endpoint = item.type === "page" ? "page" : "post";
            const path = wwwPaths[endpoint](item.locale, item.slug);
            const body = await read(request, endpoint, path);
            expect({ locale: body.locale, slug: body.slug }, path).toEqual({ locale: item.locale, slug: item.slug });
            const alternates = body.alternates as { locale: Locale; slug: string }[];
            for (const alt of alternates) {
               expect(alt.locale, `${path} lists its own locale as an alternate`).not.toBe(item.locale);
               expect(seen.has(`${item.type}:${alt.locale}:${alt.slug}`), `${path} → alternate ${alt.locale}/${alt.slug} is published`).toBe(true);
            }
            if (item.slug === SEED_SLUG) {
               expect(alternates, `${path} lists its seeded translation`).toEqual([{ locale: item.locale === "en" ? "ar" : "en", slug: SEED_SLUG }]);
            }
            if (body.cover) covers.add(body.cover.url);
            if (item.slug === SEED_SLUG && item.type === "page" && item.locale === "en") {
               expect(body.cover, `${path} has the cover this test uploaded`).toMatchObject({ alt: "E2E cover" });
               seededCover = body.cover.url;
            }
         }
         expect(covers.has(seededCover), "the seeded cover is among the covers checked").toBe(true);
         for (const url of covers) {
            const img = await request.get(url);
            expect(img.status(), url).toBe(200);
            expect(img.headers()["content-type"], url).toMatch(/^image\//);
         }
      });
   });
});
