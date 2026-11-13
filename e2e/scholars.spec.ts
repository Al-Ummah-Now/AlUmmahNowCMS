/**
 * Scholars E2E (docs/SCHOLARS.md) against a deployed CMS. Scholars write in Studio (§7, SS18): the CMS
 * gives a scholar "Write in Studio" and their profile, and refuses post writes; editors feature scholar
 * posts on the Featuring screen. The screens in en/ar, desktop/phone, with axe. Nothing is created.
 *
 * The community post → reference → www chain is covered by the Worker tests
 * (test/worker/scholar-refs.test.ts) and the videos platform's release suite.
 *
 * Needs the scholar account (E2E_SCHOLAR_EMAIL, default the seeded qa-creator: Scholar role, one channel).
 */
import { expect, test } from "@playwright/test";
import { expectNoAxeViolations, sessionPage, shot } from "./support/browser.ts";
import { ACCOUNTS, CMS_URL, hasCredentials } from "./support/env.ts";
import { sessionCookie } from "./support/sessions.ts";

test.describe.configure({ mode: "serial" });
test.use({ reducedMotion: "reduce" });
test.skip(!hasCredentials, "QA_SEED_PASSWORD is not set");

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

test.describe("scholars write in Studio", () => {
   test("a scholar signs in and has a profile", async () => {
      // Without the Scholar role the account can't sign in to the CMS at all (the no-access page).
      const me = await as("scholar", "GET", "/admin/api/scholars/me").catch((error: unknown) => ({ status: 0, json: null, error: String(error) }));
      test.skip(me.status === 0 || me.status === 401 || me.status === 403, "the scholar E2E account is missing or lacks the Scholar role");
      expect(me.status).toBe(200);
      scholar = me.json!.data as { slug: string; channel_ids: string[] };
      expect(scholar.slug).toMatch(/^[a-z0-9-]+$/);
   });

   test("the CMS refuses their post writes and sends them to Studio", async () => {
      test.skip(!scholar, "no scholar profile");
      const res = await as("scholar", "POST", "/api/data/entity/posts", { slug: "never", locale: "en", title: "Never", status: "draft", tags: [] });
      expect(res.status).toBe(403);
      const cookie = await sessionCookie(ACCOUNTS.scholar);
      const home = await fetch(`${CMS_URL}/`, { headers: { cookie }, redirect: "manual" });
      expect(home.headers.get("location")).toBe("/write");
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
         await sessionPage(context, page, ACCOUNTS.scholar, `/write?lang=${lang}`);
         await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
         await expect(page.locator("[data-write-in-studio]")).toBeVisible();
         await expectNoAxeViolations(page);
         await shot(page, `scholar-write-${lang}-${w}`);
         await page.goto(`/scholars/me?lang=${lang}`);
         await expect(page.locator("form[data-scholar-form]")).toBeVisible();
         await expectNoAxeViolations(page);
         await shot(page, `scholar-profile-${lang}-${w}`);
      });
   }

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
