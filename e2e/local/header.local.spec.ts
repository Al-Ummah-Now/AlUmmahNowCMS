/**
 * The shared header (AlUmmahNow docs/design/NAV.md "Header"; owner 2026-11-14 "UNIFY") on the staff
 * shell and the signed-out pages, against the local `wrangler dev` CMS (playwright.local.config.ts):
 * order, 40px controls, the spec's breakpoints (1280 / 1024 / 768 / 640 / 400), language and
 * Light / Dark in the header (not the rail), the search under the bar below 1024px, and axe
 * (WCAG 2.2 AA) on the header in en/ar, light/dark, desktop and phone.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Browser globals used inside page.evaluate (the CMS typechecks e2e without the DOM lib)
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any, getComputedStyle: any;

const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 8798}`;
const ON = `http://localhost:${process.env.CMS_ON_PORT ?? 8595}`;
const RUN = `hd${Date.now().toString(36)}`;

test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "viewports are set per test");

async function signIn(page: Page, suffix: string) {
   const as = { id: `e2e-admin-${suffix}`, email: `e2e-admin+${suffix}@example.test`, roles: ["Admin"], name: "Header Tester" };
   await fetch(`${MOCK}/__as`, { method: "POST", body: JSON.stringify(as) });
   await page.goto(`${ON}/sso/login?return=%2F`);
   await expect(page).toHaveURL(`${ON}/`);
}

async function axeHeader(page: Page, what: string) {
   const r = await new AxeBuilder({ page }).include("header.aun-header").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      // experimental in axe, off with the WCAG tags alone: the language button's name must hold its visible label (WCAG 2.5.3)
      .options({ rules: { "label-content-name-mismatch": { enabled: true } } })
      .analyze();
   expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`), what).toEqual([]);
}

/** The visible header slots, in reading order, with their boxes. */
const slots = (page: Page) =>
   page.evaluate(() => {
      const hd = document.querySelector("header.aun-header");
      const pick = (sel: string) => {
         const el = hd.querySelector(sel);
         if (!el) return null;
         const r = el.getBoundingClientRect();
         return getComputedStyle(el).display === "none" || r.width <= 1 ? null : { x: r.x, w: r.width, h: r.height };
      };
      return {
         bar: hd.getBoundingClientRect().height,
         menu: pick("[data-open-drawer]"),
         brand: pick(".aun-brand"),
         logo: pick(".aun-brand-mark"),
         brandText: pick(".aun-brand-text"),
         env: pick(".aun-env"),
         search: pick(".aun-header-primary"),
         searchBtn: pick(".hd-search-btn"),
         create: pick(".btn.primary.sm"),
         apps: pick(".aun-apps"),
         appName: pick(".aun-app-name"),
         lang: pick(".aun-lang"),
         mode: pick(".mode-to-light") ?? pick(".mode-to-dark"),
         account: pick(".aun-acct-btn"),
         accountName: pick(".aun-acct-name"),
         scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
   });

test("staff shell: the shared header across the spec's breakpoints, en and ar", async ({ page }) => {
   await signIn(page, `${RUN}-bp`);
   await page.emulateMedia({ colorScheme: "dark" });
   for (const lang of ["en", "ar"] as const) {
      for (const width of [1440, 1100, 900, 700, 390, 360]) {
         await page.setViewportSize({ width, height: 800 });
         await page.goto(`/pages?lang=${lang}`);
         const s = await slots(page);
         const at = `${lang} ${width}px`;
         expect(s.scrollX, `${at}: no sideways scroll`).toBeLessThanOrEqual(0);
         expect(s.bar, `${at}: bar height`).toBeCloseTo(width < 640 ? 56 : 64, 0); // border-box: the 1px border is inside
         for (const k of ["lang", "mode", "account"] as const) {
            expect(s[k], `${at}: ${k} visible`).not.toBeNull();
            expect(s[k]!.h, `${at}: ${k} is 40px`).toBeCloseTo(40, 0);
         }
         expect(s.mode!.w, `${at}: sun/moon is 40×40`).toBeCloseTo(40, 0);
         expect(s.create!.h, `${at}: New is 40px`).toBeCloseTo(40, 0);
         expect(s.logo!.w, `${at}: logo`).toBe(width < 640 ? 32 : 36);
         expect(!!s.brandText, `${at}: wordmark`).toBe(width >= 400);
         expect(!!s.search, `${at}: search in the bar`).toBe(width >= 1024);
         expect(!!s.searchBtn, `${at}: search icon`).toBe(width < 1024 && width >= 640);
         expect(!!s.apps, `${at}: app links`).toBe(width >= 640);
         expect(!!s.appName, `${at}: app link names`).toBe(width >= 1280);
         expect(!!s.accountName, `${at}: account name`).toBe(width >= 768);
         expect(!!s.menu, `${at}: drawer toggle`).toBe(width < 768);
         // reading order: language first, then sun/moon, then the account (mirrored in Arabic)
         const order = [s.apps, s.lang, s.mode, s.account].filter(Boolean).map((b) => b!.x);
         const sorted = [...order].sort((a, b) => (lang === "ar" ? b - a : a - b));
         expect(order, `${at}: order`).toEqual(sorted);
      }
   }
   // the language button names the other language in its own script, keeps the screen and query
   await page.setViewportSize({ width: 1440, height: 800 });
   await page.goto("/pages?lang=en&q=zz");
   const langBtn = page.locator("header .aun-lang");
   await expect(langBtn).toHaveText("Switch to Arabic: العربية");
   await expect(langBtn.locator("span[lang=ar]")).toHaveText("العربية");
   await langBtn.click();
   await expect(page).toHaveURL(/\/pages\?lang=ar&q=zz$/);
   await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
   // and they are no longer in the rail
   await expect(page.locator("nav.rail .aun-lang, nav.rail [data-mode-toggle]")).toHaveCount(0);
   // the QA badge never shows outside QA / stage (this stack is ENVIRONMENT=local)
   await expect(page.locator("header .aun-env")).toHaveCount(0);
});

test("below 1024px the search opens under the bar from its icon, and Escape closes it", async ({ page }) => {
   await signIn(page, `${RUN}-search`);
   await page.setViewportSize({ width: 900, height: 800 });
   await page.goto("/?lang=en");
   const btn = page.getByRole("button", { name: "Search pages and posts" });
   await expect(btn).toHaveAttribute("aria-expanded", "false");
   await btn.click();
   await expect(btn).toHaveAttribute("aria-expanded", "true");
   await expect(page.locator("#global-q")).toBeFocused();
   await axeHeader(page, "search open");
   await page.keyboard.press("Escape");
   await expect(btn).toHaveAttribute("aria-expanded", "false");
   await expect(page.locator("#global-q")).toBeHidden();
   await expect(btn).toBeFocused();
});

test("axe on the header: en/ar, light/dark, desktop and phone", async ({ page }) => {
   await signIn(page, `${RUN}-axe`);
   for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 800 });
      for (const lang of ["en", "ar"] as const) {
         for (const mode of ["dark", "light"] as const) {
            await page.goto(`/?lang=${lang}&mode=${mode}`);
            await axeHeader(page, `shell ${lang} ${mode} ${width}`);
            await page.goto(`/sso/logged-out?lang=${lang}&mode=${mode}`);
            await expect(page.locator("header .aun-signin")).toBeVisible();
            await axeHeader(page, `signed out ${lang} ${mode} ${width}`);
         }
      }
   }
});

test("the signed-out pages wear the same header: same heights and controls as the shell", async ({ page }) => {
   await page.setViewportSize({ width: 1440, height: 800 });
   for (const path of ["/sso/logged-out?lang=en", "/sso/passkey-needed?return=%2F&lang=en", "/no-such-page?lang=en"]) {
      await page.goto(path);
      const s = await slots(page);
      expect(s.bar, path).toBeCloseTo(64, 0);
      expect(s.logo!.w, path).toBe(36);
      expect(s.lang!.h, path).toBeCloseTo(40, 0);
      expect(s.mode!.w, path).toBeCloseTo(40, 0);
      await expect(page.locator("header .aun-brand-app"), path).toHaveText("Content");
      await axeHeader(page, path);
   }
});
