import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against a deployed CMS (QA in CI, stage in the release).
 *   CMS_URL, AUTH_URL, CMS_CLIENT_ID, QA_SEED_PASSWORD (or SEED_PASSWORD), WWW_URL (optional)
 */
export default defineConfig({
   testDir: "e2e",
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
   projects: [
      { name: "desktop", use: { ...devices["Desktop Chrome"] } },
      { name: "mobile", use: { ...devices["Pixel 7"] } },
      // E2E_BROWSERS=all: the same suite in Firefox and WebKit, desktop and phone (QA verification).
      ...(process.env.E2E_BROWSERS === "all"
         ? [
              // Headless Firefox on CI runners crashes now and then ("Page crashed"; not reproducible locally,
              // see that issue): one extra retry on top of the global one.
              { name: "firefox", retries: process.env.CI ? 2 : 0, use: { ...devices["Desktop Firefox"] } },
              { name: "firefox-phone", retries: process.env.CI ? 2 : 0, use: { ...devices["Desktop Firefox"], viewport: { width: 390, height: 844 } } },
              { name: "webkit", use: { ...devices["Desktop Safari"] } },
              { name: "webkit-phone", use: { ...devices["iPhone 13"] } },
           ]
         : []),
   ],
});
