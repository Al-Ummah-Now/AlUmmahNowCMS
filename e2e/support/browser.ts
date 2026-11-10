/** Browser helpers shared by the E2E specs: SSO into a browser context, axe, screenshots. */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { CMS_URL, type Account } from "./env.ts";
import { beginSignIn } from "./oauth.ts";

mkdirSync("e2e-artifacts", { recursive: true });
const cmsHost = new URL(CMS_URL).host;

export async function shot(page: Page, name: string): Promise<void> {
   await page.screenshot({ path: `e2e-artifacts/${name}-${test.info().project.name}.png`, fullPage: true });
}

export async function expectNoAxeViolations(page: Page): Promise<void> {
   const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
   expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** Signs `account` in headlessly up to the callback, then lets the browser finish it. */
export async function browserSignIn(context: BrowserContext, page: Page, account: Account, returnPath = "/") {
   const pending = await beginSignIn(account, returnPath);
   await context.addCookies(
      pending.jar.forHost(cmsHost).map((c) => ({ ...c, url: CMS_URL, secure: CMS_URL.startsWith("https:"), httpOnly: true, sameSite: "Lax" as const })),
   );
   return page.goto(pending.callbackUrl);
}

/** Opens `returnPath` with the account's CMS session (one sign-in per account per run, see sessions.ts). */
export async function sessionPage(context: BrowserContext, page: Page, account: Account, returnPath = "/") {
   const { sessionCookie } = await import("./sessions.ts");
   const cookies = (await sessionCookie(account))
      .split(/;\s*/)
      .filter(Boolean)
      .map((pair) => ({ name: pair.slice(0, pair.indexOf("=")), value: pair.slice(pair.indexOf("=") + 1) }));
   await context.addCookies(cookies.map((c) => ({ ...c, url: CMS_URL, secure: CMS_URL.startsWith("https:"), httpOnly: true, sameSite: "Lax" as const })));
   return page.goto(returnPath);
}
