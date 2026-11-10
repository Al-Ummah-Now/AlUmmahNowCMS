import { defineConfig, devices } from "@playwright/test";

/**
 * Local E2E for AI writing assist (docs/AI_ASSIST_SPEC.md §9): two `wrangler dev` CMS instances
 * (AI configured / not configured) against a mock auth issuer and a mock Workers AI. No Cloudflare
 * account, no real key, no real accounts. Runs in CI on every PR (ci.yml, job "E2E (local)").
 *
 *   npx playwright test -c playwright.local.config.ts
 */
const MOCK = Number(process.env.MOCK_PORT ?? 8798);
const ON = Number(process.env.CMS_ON_PORT ?? 8595);
const OFF = Number(process.env.CMS_OFF_PORT ?? 8596);
const env = { ...process.env, MOCK_PORT: String(MOCK) } as Record<string, string>;

export default defineConfig({
   testDir: "e2e/local",
   testMatch: /\.local\.spec\.ts$/,
   timeout: 90_000,
   expect: { timeout: 15_000 },
   fullyParallel: false,
   workers: 1,
   retries: process.env.CI ? 1 : 0,
   reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report-local" }]] : "list",
   outputDir: "test-results-local",
   use: { baseURL: `http://localhost:${ON}`, trace: "retain-on-failure", screenshot: "only-on-failure" },
   webServer: [
      { command: "node --experimental-strip-types --no-warnings e2e/local/mock-server.ts", url: `http://127.0.0.1:${MOCK}/healthz`, reuseExistingServer: !process.env.CI, env },
      { command: `bash e2e/local/cms.sh on ${ON}`, url: `http://localhost:${ON}/healthz`, timeout: 180_000, reuseExistingServer: !process.env.CI, env },
      { command: `bash e2e/local/cms.sh off ${OFF}`, url: `http://localhost:${OFF}/healthz`, timeout: 180_000, reuseExistingServer: !process.env.CI, env },
   ],
   projects: [
      { name: "desktop", use: { ...devices["Desktop Chrome"] } },
      { name: "mobile", use: { ...devices["Pixel 7"] } },
   ],
});
