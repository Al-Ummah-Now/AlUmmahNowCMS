/**
 * Light / Dark and menus that fit the screen (owner decisions 2026-11-13), against the local
 * `wrangler dev` CMS (playwright.local.config.ts).
 *  - Mode: no "System" option; with nothing saved the page follows the device (emulated
 *    prefers-color-scheme) before paint; a click saves the choice (cms_mode cookie) across reloads.
 *  - Menus: the account menu, the Create menu and the search suggestions stay inside the viewport
 *    at 320 / 375 / 414 px and a landscape phone, English (LTR) and Arabic (RTL).
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";

// Browser globals used inside page.evaluate / addInitScript (the CMS typechecks e2e without the DOM lib)
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any, window: any, MutationObserver: any;

const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 8798}`;
const ON = `http://localhost:${process.env.CMS_ON_PORT ?? 8595}`;
const RUN = `vp${Date.now().toString(36)}`;

const VIEWPORTS = [
   { width: 320, height: 640 },
   { width: 375, height: 667 },
   { width: 414, height: 896 },
   { width: 844, height: 390 },
] as const;

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, suffix: string) {
   const as = { id: `e2e-admin-${suffix}`, email: `e2e-admin+${suffix}@example.test`, roles: ["Admin"] };
   await fetch(`${MOCK}/__as`, { method: "POST", body: JSON.stringify(as) });
   await page.goto(`${ON}/sso/login?return=%2F`);
   await expect(page).toHaveURL(`${ON}/`);
}

/** html.dark when the <body> first exists: what the first paint shows. */
async function recordDarkAtBody(page: Page) {
   await page.addInitScript(() => {
      const seen: boolean[] = [];
      (window as unknown as { __darkAtBody: boolean[] }).__darkAtBody = seen;
      new MutationObserver((_: unknown, obs: any) => {
         if (document.body) {
            seen.push(document.documentElement.classList.contains("dark"));
            obs.disconnect();
         }
      }).observe(document, { childList: true, subtree: true });
   });
}
const darkAtBody = (page: Page) => page.evaluate(() => (window as unknown as { __darkAtBody: boolean[] }).__darkAtBody);

async function expectInViewport(page: Page, popup: Locator, what: string) {
   await expect(popup, what).toBeVisible();
   await page.waitForTimeout(150);
   const box = (await popup.boundingBox())!;
   const vp = page.viewportSize()!;
   expect.soft(box.x, `${what}: left edge`).toBeGreaterThanOrEqual(-1);
   expect.soft(box.y, `${what}: top edge`).toBeGreaterThanOrEqual(-1);
   expect.soft(box.x + box.width, `${what}: right edge`).toBeLessThanOrEqual(vp.width + 1);
   expect.soft(box.y + box.height, `${what}: bottom edge`).toBeLessThanOrEqual(vp.height + 1);
   expect.soft(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${what}: page scrolls sideways`).toBeLessThanOrEqual(0);
}

test.describe("light / dark", () => {
   test.skip(({ isMobile }) => isMobile, "one project is enough");

   for (const scheme of ["light", "dark"] as const) {
      test(`first load follows the device (${scheme}) before paint, no System option`, async ({ page, context }) => {
         await context.clearCookies({ name: "cms_mode" });
         await signIn(page, `${RUN}-first-${scheme}`);
         await page.emulateMedia({ colorScheme: scheme });
         await recordDarkAtBody(page);
         await page.goto("/?lang=en");
         expect(await darkAtBody(page)).toEqual([scheme === "dark"]);
         await expect(page.locator("html")).not.toHaveAttribute("data-mode", /./);
         // the one visible control switches to the other mode
         const target = scheme === "dark" ? "light" : "dark";
         await expect(page.getByRole("link", { name: `Switch to ${target} mode` })).toBeVisible();
         await expect(page.getByRole("link", { name: `Switch to ${scheme} mode` })).toBeHidden();
         await expect(page.getByText(/^(System|Device)$/)).toHaveCount(0);
      });
   }

   test("a click saves the choice; it persists across reloads and the device no longer decides", async ({ page, context }) => {
      await context.clearCookies({ name: "cms_mode" });
      await signIn(page, `${RUN}-persist`);
      await page.emulateMedia({ colorScheme: "light" });
      await page.goto("/?lang=en");
      await page.getByRole("link", { name: "Switch to dark mode" }).click();
      await expect(page.locator("html")).toHaveAttribute("data-mode", "dark");
      await expect(page.locator("html")).toHaveClass(/dark/);
      await page.emulateMedia({ colorScheme: "light" });
      await recordDarkAtBody(page);
      await page.goto("/posts?lang=en");
      expect(await darkAtBody(page)).toEqual([true]);
      // Arabic, keyboard: the link is reachable and named
      await page.goto("/?lang=ar");
      const toLight = page.getByRole("link", { name: ADMIN_STRINGS.ar.prefs.toLight });
      await toLight.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.reload();
      await expect(page.locator("html")).not.toHaveClass(/dark/);
      await page.goto("/?lang=en");
   });

   test('a "system" saved by an older release is cleared: the device decides again', async ({ page, context }) => {
      await signIn(page, `${RUN}-legacy`);
      await context.addCookies([{ name: "cms_mode", value: "system", url: ON }]);
      await page.emulateMedia({ colorScheme: "dark" });
      await page.goto("/?lang=en");
      await expect(page.locator("html")).toHaveClass(/dark/);
      expect((await context.cookies(ON)).find((c) => c.name === "cms_mode")).toBeUndefined();
   });
});

test.describe("menus stay inside the viewport", () => {
   test.skip(({ isMobile }) => isMobile, "viewports are set per test");

   for (const vp of VIEWPORTS) {
      for (const lang of ["en", "ar"] as const) {
         test(`${vp.width}×${vp.height} ${lang}`, async ({ page }) => {
            await signIn(page, `${RUN}-${vp.width}-${lang}`);
            const title = `Viewport ${RUN} ${lang} ${vp.width} with a long title to make the row wide`;
            const res = await page.request.post(`${ON}/api/data/entity/posts`, { data: { status: "draft", slug: `vp-${RUN}-${lang}-${vp.width}`, locale: lang, title }, headers: { origin: ON } });
            expect(res.status(), await res.text()).toBe(201);
            const id = ((await res.json()) as { data: { id: number } }).data.id;
            try {
               await page.setViewportSize(vp);
               await page.goto(`/posts?lang=${lang}`);

               // the account menu
               await page.locator("header .pop summary.who").click();
               await expectInViewport(page, page.locator("header .pop[open] .aun-menu"), "account menu");
               await page.keyboard.press("Escape");

               // the Create menu
               const create = page.locator("header .pop summary.btn");
               if (await create.isVisible()) {
                  await create.click();
                  await expectInViewport(page, page.locator("header .pop[open] .aun-menu"), "create menu");
                  await page.keyboard.press("Escape");
               }

               // search suggestions: the list's own box, and the header's where it shows
               const box = page.locator("main input[role=combobox]").first();
               await box.fill(`Viewport ${RUN}`);
               await expectInViewport(page, page.locator("main .ac-list").first(), "list search suggestions");
               await box.press("Escape");
               const global = page.locator("#global-q");
               if (await global.isVisible()) {
                  await global.fill(`Viewport ${RUN}`);
                  await expectInViewport(page, page.locator("#global-q-list"), "header search suggestions");
               }
            } finally {
               await page.request.delete(`${ON}/api/data/entity/posts/${id}`, { headers: { origin: ON } });
            }
         });
      }
   }
});
