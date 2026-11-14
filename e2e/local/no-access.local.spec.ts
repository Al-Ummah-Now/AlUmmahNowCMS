/**
 * The "No access" page (2026-11-14), against the local `wrangler dev` CMS and the mock auth
 * (playwright.local.config.ts): a real refusal through /sso/callback, never a hand-made page.
 *  - It wears the site theme like the staff screens, in Light/Dark and en/ar (RTL), with no axe
 *    violations, and names the refused account and every role that opens the CMS.
 *  - "Active" on the current account retries the sign-in with it: once auth gives that account a
 *    CMS role, the click lands on the dashboard.
 *  - Reopened later (no fresh refusal), the same URL signs in again instead of showing a stale page.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Browser globals used inside page.evaluate (the CMS typechecks e2e without the DOM lib)
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any, getComputedStyle: any;

const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 8798}`;
const ON = `http://localhost:${process.env.CMS_ON_PORT ?? 8595}`;
const RUN = `na${Date.now().toString(36)}`;
mkdirSync("e2e-artifacts", { recursive: true });

test.describe.configure({ mode: "serial" });

const tester = { id: `${RUN}-tester`, email: `tester+${RUN}@example.test`, roles: ["Member"] };
const owner = { id: `${RUN}-owner`, email: `owner+${RUN}@example.test`, roles: ["Member", "Super Admin", "Admin"] };

async function as(who: { id: string; email: string; roles: string[] }) {
   await fetch(`${MOCK}/__as`, { method: "POST", body: JSON.stringify(who) });
}

/** Auth's list for this browser: the refused account is the active one. */
async function accountsList() {
   await fetch(`${MOCK}/__accounts`, {
      method: "POST",
      body: JSON.stringify({
         accounts: [
            { userId: tester.id, isActive: true, email: tester.email, name: "Tester" },
            { userId: owner.id, isActive: false, email: owner.email, name: "Mahmoud Darwish" },
         ],
      }),
   });
}

async function refused(page: Page, query = "") {
   await as(tester);
   await accountsList();
   await page.goto(`${ON}/sso/login?return=%2F`);
   await expect(page).toHaveURL(`${ON}/sso/no-access`);
   if (query) await page.goto(`${ON}/sso/no-access?${query}`);
   await expect(page.locator("#accounts-list li")).toHaveCount(2);
}

for (const lang of ["en", "ar"] as const) {
   for (const mode of ["dark", "light"] as const) {
      test(`themed, names the refused account, axe clean (${lang}, ${mode})`, async ({ page }, info) => {
         await refused(page, `lang=${lang}&mode=${mode}`);
         const html = page.locator("html");
         await expect(html).toHaveAttribute("lang", lang);
         await expect(html).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
         await expect(html).toHaveAttribute("data-theme", "fawanees");
         if (mode === "dark") await expect(html).toHaveClass(/\bdark\b/);
         else await expect(html).not.toHaveClass(/\bdark\b/);
         // The theme's stylesheets are applied: the card has the theme's material, not a white page
         const card = page.getByTestId("no-access");
         await expect(card).toBeVisible();
         const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundImage + "|" + getComputedStyle(document.body).backgroundColor);
         expect(bg).not.toBe("none|rgba(0, 0, 0, 0)");
         await expect(page.locator(".gate-lead")).toContainText(tester.email);
         await expect(card).toContainText(lang === "ar" ? "المشرف العام والمشرف والمراقب والكاتب والعالِم" : "Super Admin, Admin, Moderator, Writer and Scholar");
         const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
         expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
         const size = await page.evaluate(() => document.documentElement.scrollHeight);
         await page.setViewportSize({ width: page.viewportSize()!.width, height: Math.max(size, page.viewportSize()!.height) });
         await page.screenshot({ path: `e2e-artifacts/no-access-${lang}-${mode}-${info.project.name}.png` });
      });
   }
}

test("Active retries the sign-in with the current account; with a CMS role it lands on the dashboard", async ({ page }) => {
   await refused(page);
   // auth now gives the active account a CMS role (e.g. an admin granted it, or auth's account changed)
   await as(owner);
   await page.locator("#accounts-list li").first().getByRole("button", { name: /^Active/ }).click();
   await expect(page).toHaveURL(`${ON}/`);
   const me = (await (await page.request.get(`${ON}/api/auth/me`)).json()) as { user?: { role?: string } };
   expect(me.user?.role).toBe("admin");
});

test("reopened without a fresh refusal, /sso/no-access signs in again instead of showing a stale page", async ({ page, context }) => {
   await refused(page);
   await context.clearCookies();
   await as(owner);
   await page.goto(`${ON}/sso/no-access`);
   await expect(page).toHaveURL(`${ON}/`);
});
