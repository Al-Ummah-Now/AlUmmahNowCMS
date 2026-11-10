/**
 * Scholars E2E (docs/SCHOLARS.md) against a deployed CMS: a scholar signs in, writes and publishes;
 * the article is on their www scholar page and their channel's Community tab, and NOT on the Articles
 * list; an editor features it from the Featuring screen; it reaches www's home timeline and Articles.
 * The screens in en/ar, desktop/phone, with axe. Everything made carries a stamp and is removed.
 *
 * Needs the scholar E2E account (E2E_SCHOLAR_EMAIL, Scholar role, one channel on the videos site).
 * www checks need WWW_URL. Every wait is a poll with a deadline, never a fixed sleep.
 */
import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, sessionPage, shot } from "./support/browser.ts";
import { ACCOUNTS, CMS_URL, hasCredentials, VIDEOS_API_URL, WWW_URL } from "./support/env.ts";
import { sessionCookie } from "./support/sessions.ts";

test.describe.configure({ mode: "serial" });
test.use({ reducedMotion: "reduce" });
test.skip(!hasCredentials, "QA_SEED_PASSWORD is not set");

const STAMP = `e2e${Date.now().toString(36)}`;
const SLUG = `sch-${STAMP}`;
const TITLE = `Scholar article ${STAMP}`;
let postId = 0;
let scholar: { slug: string; channel_ids: string[] } | null = null;

async function as(account: keyof typeof ACCOUNTS, method: string, path: string, body?: unknown) {
   const cookie = await sessionCookie(ACCOUNTS[account]);
   const res = await fetch(`${CMS_URL}${path}`, {
      method,
      headers: { cookie, origin: CMS_URL, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
   });
   return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}

async function until(what: string, check: () => Promise<boolean>, ms = 150_000): Promise<void> {
   const end = Date.now() + ms;
   while (Date.now() < end) {
      if (await check().catch(() => false)) return;
      await new Promise((r) => setTimeout(r, 5_000));
   }
   throw new Error(`timed out waiting for: ${what}`);
}

const text = async (url: string) => (await fetch(`${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`)).text();

test.afterAll(async () => {
   if (!postId) return;
   await as("moderator", "POST", `/admin/api/featuring/posts/${postId}`, { on: false }).catch(() => undefined);
   await as("scholar", "DELETE", `/api/data/entity/posts/${postId}`).catch(() => undefined);
});

test.describe("scholar publishing", () => {
   test("a scholar signs in and has a profile", async () => {
      const me = await as("scholar", "GET", "/admin/api/scholars/me");
      test.skip(me.status === 401 || me.status === 403, "the scholar E2E account is missing or lacks the Scholar role");
      expect(me.status).toBe(200);
      scholar = me.json!.data as { slug: string; channel_ids: string[] };
      expect(scholar.slug).toMatch(/^[a-z0-9-]+$/);
   });

   test("writes and publishes; it is theirs alone", async () => {
      test.skip(!scholar, "no scholar profile");
      const res = await as("scholar", "POST", "/api/data/entity/posts", { slug: SLUG, locale: "en", title: TITLE, status: "published", tags: [], excerpt: `Excerpt ${STAMP}`, body: `Body ${STAMP}` });
      expect(res.status, JSON.stringify(res.json)).toBe(201);
      postId = (res.json!.data as { id: number }).id;
      // Live at its own address, on the scholar page, not on the main Articles list.
      const post = (await (await fetch(`${CMS_URL}/api/public/v1/posts/${SLUG}?locale=en`)).json()) as { author?: { slug: string } };
      expect(post.author?.slug).toBe(scholar!.slug);
      expect(await text(`${CMS_URL}/api/public/v1/scholars/${scholar!.slug}?locale=en`)).toContain(TITLE);
      expect(await text(`${CMS_URL}/api/public/v1/posts?locale=en&limit=20`)).not.toContain(TITLE);
      // An editor's post is not reachable for the scholar.
      const staff = await as("moderator", "POST", "/api/data/entity/posts", { slug: `staff-${STAMP}`, locale: "en", title: `Staff ${STAMP}`, status: "draft", tags: [] });
      const staffId = (staff.json!.data as { id: number }).id;
      expect((await as("scholar", "GET", `/api/data/entity/posts/${staffId}`)).status).toBe(404);
      await as("admin", "DELETE", `/api/data/entity/posts/${staffId}`);
   });

   test("it is on the scholar's www page and their channel's Community tab", async () => {
      test.skip(!postId, "nothing published");
      if (WWW_URL) await until("www scholar page lists the article", async () => (await text(`${WWW_URL}/en/scholars/${scholar!.slug}/`)).includes(TITLE));
      const channel = scholar!.channel_ids[0];
      test.skip(!channel, "the scholar E2E account has no channel");
      await until("community post on the channel", async () => (await text(`${VIDEOS_API_URL}/api/community/channels/${channel}/posts?limit=20`)).includes(TITLE));
   });

   for (const [lang, w, h] of [
      ["en", 1280, 900],
      ["ar", 1280, 900],
      ["en", 390, 844],
      ["ar", 390, 844],
   ] as const) {
      test(`scholar screens in ${lang} at ${w}px: axe clean`, async ({ context, page }) => {
         test.skip(!scholar, "no scholar profile");
         await page.setViewportSize({ width: w, height: h });
         await sessionPage(context, page, ACCOUNTS.scholar, `/posts?lang=${lang}`);
         await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
         await expectNoAxeViolations(page);
         await shot(page, `scholar-articles-${lang}-${w}`);
         await page.goto(`/scholars/me?lang=${lang}`);
         await expect(page.locator("form[data-scholar-form]")).toBeVisible();
         await expectNoAxeViolations(page);
         await shot(page, `scholar-profile-${lang}-${w}`);
      });
   }

   test("an editor features it from the Featuring screen; it reaches the main site", async ({ context, page }) => {
      test.skip(!postId, "nothing published");
      await sessionPage(context, page, ACCOUNTS.moderator, `/featuring?q=${STAMP}&lang=en`);
      const row = page.locator(`li[data-candidate="${postId}"]`);
      await expect(row).toBeVisible();
      await expectNoAxeViolations(page);
      await shot(page, "featuring-before");
      await row.getByRole("button", { name: /Feature on main site/ }).click();
      await expect(page.locator(`li[data-candidate="${postId}"] .badge.published`)).toBeVisible({ timeout: 15_000 });
      await shot(page, "featuring-after");
      expect(await text(`${CMS_URL}/api/public/v1/posts?locale=en&limit=20`)).toContain(TITLE);
      if (WWW_URL) {
         await until("www Articles list", async () => (await text(`${WWW_URL}/en/articles/`)).includes(TITLE));
         await until("www home timeline", async () => (await text(`${WWW_URL}/en/`)).includes(TITLE));
      }
   });

   for (const lang of ["en", "ar"] as const) {
      test(`Featuring screen in ${lang} on a phone: axe clean`, async ({ context, page }) => {
         await page.setViewportSize({ width: 390, height: 844 });
         await sessionPage(context, page, ACCOUNTS.moderator, `/featuring?lang=${lang}`);
         await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
         await expectNoAxeViolations(page);
         await shot(page, `featuring-${lang}-phone`);
      });
   }
});
