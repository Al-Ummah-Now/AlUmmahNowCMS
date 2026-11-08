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
      trace: "retain-on-failure",
      screenshot: "only-on-failure",
   },
   projects: [
      { name: "desktop", use: { ...devices["Desktop Chrome"] } },
      { name: "mobile", use: { ...devices["Pixel 7"] } },
   ],
});
