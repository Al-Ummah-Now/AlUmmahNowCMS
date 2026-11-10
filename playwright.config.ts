import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against a deployed CMS (QA in CI, stage in the release).
 *   CMS_URL, AUTH_URL, CMS_CLIENT_ID, QA_SEED_PASSWORD (or SEED_PASSWORD), WWW_URL (optional)
 */
/** The SSO-flow suite tests sign-in itself (one sign-in per test): Chromium projects only. */
const SSO_FLOW = /cms\.spec\.ts/;

export default defineConfig({
   testDir: "e2e",
   globalSetup: "./e2e/support/sessions.ts",
   timeout: 120_000,
   expect: { timeout: 15_000 },
   fullyParallel: false,
   workers: 1,
   retries: process.env.CI ? 1 : 0,
   reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : "list",
   outputDir: "test-results",
   use: {
      baseURL: process.env.CMS_URL ?? "https://cms.qa.alummahnow.net",
      // Traces hold session cookies of the signed-in suite: local debugging only, never in CI.
      trace: process.env.CI ? "off" : "retain-on-failure",
      screenshot: "only-on-failure",
   },
   // @playwright/test is pinned to 1.64.1: 1.65.0's Firefox 159 segfaults when an element's
   // aria-labelledby is read from two JS realms (a getByLabel/getByRole lookup, then axe or
   // evaluateAll). microsoft/playwright#43967, Mozilla bug 2090055, AlUmmahNow#524.
   projects: [
      { name: "desktop", use: { ...devices["Desktop Chrome"] } },
      { name: "mobile", use: { ...devices["Pixel 7"] } },
      // E2E_BROWSERS=all: the same suite in Firefox and WebKit, desktop and phone (QA verification).
      ...(process.env.E2E_BROWSERS === "all"
         ? [
              { name: "firefox", testIgnore: SSO_FLOW, use: { ...devices["Desktop Firefox"] } },
              { name: "firefox-phone", testIgnore: SSO_FLOW, use: { ...devices["Desktop Firefox"], viewport: { width: 390, height: 844 } } },
              { name: "webkit", testIgnore: SSO_FLOW, use: { ...devices["Desktop Safari"] } },
              { name: "webkit-phone", testIgnore: SSO_FLOW, use: { ...devices["iPhone 13"] } },
           ]
         : []),
   ],
});
