/**
 * SSO journey through the CMS (SSO audit 2026-11-10), in en and ar.
 *
 * A signed-out editor opens a CMS deep link, signs in once on auth's sign-in page (in the page's
 * language) and lands back on the deep link as a CMS admin; auth now has the browser's account, so
 * the other apps sign in without a password. Single sign-out from the CMS ends it everywhere, and a
 * copy of the CMS session cookie taken before the sign-out is refused (it used to keep working for
 * its 8 hours).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ACCOUNTS, AUTH_URL, CMS_URL, hasCredentials } from "./support/env.ts";

test.skip(!hasCredentials, "QA_SEED_PASSWORD is not set");
// Types the seed password on auth's form: traces would hold it
test.use({ trace: "off" });

/** Sets an input's value without it reaching the report (fill() records it in the step title). */
async function fillSecret(locator: Locator, value: string): Promise<void> {
   await locator.evaluate((el, v) => {
      const input = el as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
   }, value);
}

async function onAuthSignIn(page: Page): Promise<boolean> {
   if (new URL(page.url()).origin !== new URL(AUTH_URL).origin) return false;
   return page.locator('input[name="password"]').isVisible().catch(() => false);
}

async function authAccounts(page: Page): Promise<number> {
   const res = await page.context().request.get(`${AUTH_URL}/session/accounts`, { failOnStatusCode: false });
   if (!res.ok()) return 0;
   return (((await res.json()) as { accounts?: unknown[] }).accounts ?? []).length;
}

for (const lang of ["en", "ar"] as const) {
   test(`one sign-in from a CMS deep link, single sign-out ends copied sessions (${lang})`, async ({ page, context, browser }) => {
      const deepLink = `/videos?lang=${lang}`;
      await page.goto(deepLink);
      await page.waitForURL((u) => u.origin === new URL(AUTH_URL).origin, { timeout: 30_000 });
      await expect(page.locator('input[name="email"]')).toBeVisible();
      // auth's sign-in page follows the CMS page's language
      await expect(page.locator("html")).toHaveAttribute("lang", lang);

      await page.fill('input[name="email"]', ACCOUNTS.admin.email);
      await fillSecret(page.locator('input[name="password"]'), ACCOUNTS.admin.password);
      await page.click('button[data-component="button"]');
      await page.waitForURL((u) => u.origin === new URL(CMS_URL).origin && !u.pathname.startsWith("/sso/"), { timeout: 45_000 });
      expect(new URL(page.url()).pathname + new URL(page.url()).search, "sign-in did not come back to the deep link").toBe(deepLink);

      const me = await page.request.get(`${CMS_URL}/api/auth/me`);
      expect(((await me.json()) as { user?: { role?: string } }).user?.role).toBe("admin");
      expect(await authAccounts(page), "auth has no browser session after the sign-in").toBeGreaterThan(0);

      // A copy of the session cookie, taken while signed in
      const copied = (await context.cookies(CMS_URL)).filter((c) => c.name === "auth");
      expect(copied.length).toBe(1);

      // Single sign-out from the CMS walks every app and comes back
      await page.goto("/sso/logout");
      await page.waitForURL((u) => u.origin !== new URL(AUTH_URL).origin, { timeout: 60_000 });
      expect(await authAccounts(page), "auth still has the account after sign-out").toBe(0);
      await page.goto("/");
      await page.waitForURL((u) => u.origin === new URL(AUTH_URL).origin, { timeout: 30_000 });
      expect(await onAuthSignIn(page), `the CMS did not ask to sign in again (${page.url()})`).toBe(true);

      // The copy no longer opens the CMS
      const other = await browser.newContext();
      await other.addCookies(copied);
      const screen = await other.request.get(`${CMS_URL}/posts`, { maxRedirects: 0, failOnStatusCode: false });
      expect(screen.status(), "a copied session cookie still opens the CMS after single sign-out").toBe(302);
      const api = await other.request.get(`${CMS_URL}/picker/api/search?kind=video&q=ab`, { failOnStatusCode: false });
      expect(api.status()).toBe(401);
      await other.close();
   });
}
