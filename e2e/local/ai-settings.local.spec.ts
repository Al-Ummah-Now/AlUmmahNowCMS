/**
 * AI assist settings (docs/AI_PROVIDERS.md) against `wrangler dev` and the mock server: an admin adds a
 * generic HTTP provider pointing at the mock "third-party" API, picks the bound AI_KEY_ secret from the
 * autocomplete, runs Test connection, routes a feature to it and saves; removing a provider that a
 * feature still uses is refused with a readable error; the remove dialog is in-app. English (light) and
 * Arabic (RTL, dark), axe on every state.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";

const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 8798}`;
const ON = `http://localhost:${process.env.CMS_ON_PORT ?? 8595}`;

test.describe.configure({ mode: "serial" });

async function signInAdmin(page: Page) {
   await fetch(`${MOCK}/__as`, { method: "POST", body: JSON.stringify({ id: "e2e-ai-settings", email: "e2e-ai-settings@example.test", roles: ["Admin"] }) });
   await page.goto(`${ON}/sso/login?return=%2F`);
   await expect(page).toHaveURL(`${ON}/`);
}

async function axe(page: Page) {
   const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
   expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** Back to the defaults (Workers AI only) so other specs aren't affected. */
async function reset(page: Page) {
   const cur = (await (await page.request.get(`${ON}/admin/api/ai/settings`)).json()) as { version: number };
   const defaults = {
      providers: [{ id: "workers-ai", kind: "workers-ai", label: "Cloudflare Workers AI", enabled: true, models: ["@cf/deepseek-ai/deepseek-v4.1-flash-1017"] }],
      features: Object.fromEntries(["translate", "seo", "check"].map((f) => [f, { provider: "workers-ai", model: "@cf/deepseek-ai/deepseek-v4.1-flash-1017" }])),
      fallback: null,
      monthlyBudgetUsd: 50,
   };
   const res = await page.request.put(`${ON}/admin/api/ai/settings`, { data: { settings: defaults, version: cur.version }, headers: { origin: ON } });
   expect(res.status(), await res.text()).toBe(200);
}

for (const [lang, mode] of [
   ["en", "light"],
   ["ar", "dark"],
] as const) {
   const A = ADMIN_STRINGS[lang].aiSettings;
   const okPrefix = A.testOk("\u0000", "").split("\u0000")[0].trim();

   test(`${lang} ${mode}: add a generic HTTP provider, test it, route a feature, save; removal is guarded`, async ({ page }) => {
      await signInAdmin(page);
      await reset(page);
      await page.goto(`${ON}/ai-settings?lang=${lang}&mode=${mode}`);
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
      await expect(page.getByRole("heading", { level: 1, name: A.title })).toBeVisible();
      await expect(page.locator(`a[href="/ai-settings"]`).first()).toHaveAttribute("aria-current", "page");
      await axe(page);

      await page.getByRole("button", { name: A.addProvider }).click();
      const card = page.locator('[data-provider][data-kind="http"]').last();
      await expect(card.getByLabel(A.name, { exact: true })).toBeFocused();
      await card.getByLabel(A.name, { exact: true }).fill("E2E service");
      await card.getByLabel(A.url, { exact: true }).fill(`${MOCK}/v1/chat`);
      // The key: chosen from the bound AI_KEY_* names, never typed
      const secret = card.getByRole("combobox", { name: A.secret });
      await secret.fill("AI_KEY");
      await page.getByRole("option", { name: "AI_KEY_E2E" }).click();
      await expect(secret).toHaveValue("AI_KEY_E2E");
      await card.getByLabel(A.pText, { exact: true }).fill("choices[0].message.content");
      await card.getByLabel(A.pInput, { exact: true }).fill("usage.prompt_tokens");
      await card.getByLabel(A.pOutput, { exact: true }).fill("usage.completion_tokens");
      await card.getByLabel(A.pError, { exact: true }).fill("error.message");
      await card.getByLabel(A.priceIn, { exact: true }).fill("0.001");
      await card.getByLabel(A.priceOut, { exact: true }).fill("0.002");
      await card.getByLabel(A.models, { exact: true }).fill("e2e-model");
      await card.getByRole("combobox", { name: A.testModel }).fill("e2e-model");
      await card.getByRole("button", { name: A.test }).click();
      await expect(card.locator("[data-test-result]")).toContainText(okPrefix);
      await axe(page);

      // A wrong path fails the test with the raw response shown
      await card.getByLabel(A.pText, { exact: true }).fill("result.text");
      await card.getByRole("button", { name: A.test }).click();
      await expect(card.locator("[data-test-result]")).toContainText(A.results.invalid_output);
      await expect(card.locator("[data-test-result] pre")).toContainText("choices");
      await card.getByLabel(A.pText, { exact: true }).fill("choices[0].message.content");

      // Switch it on and route search & sharing to it
      await card.getByRole("checkbox", { name: A.enabled }).check();
      const seo = page.locator('[data-route="seo"]');
      await seo.getByLabel(A.provider, { exact: true }).selectOption({ label: "E2E service" });
      await seo.getByRole("combobox", { name: A.model }).fill("e2e-model");
      await page.getByRole("button", { name: A.save }).click();
      await expect(page.getByText(A.saved)).toBeVisible();
      await expect(page.locator("[data-history]")).toContainText("features.seo.provider");

      // Saved: after a reload the card is there and its id is locked
      await page.reload();
      const saved = page.locator('[data-provider][data-kind="http"]').last();
      await expect(saved.getByLabel(A.name, { exact: true })).toHaveValue("E2E service");
      await expect(saved.getByLabel(A.id, { exact: true })).toHaveJSProperty("readOnly", true);

      // Remove: in-app dialog; Cancel keeps it
      await saved.getByRole("button", { name: A.removeProvider }).click();
      const dlg = page.getByRole("dialog", { name: A.removeTitle });
      await expect(dlg).toBeVisible();
      await axe(page);
      await dlg.getByRole("button", { name: ADMIN_STRINGS[lang].common.cancel }).click();
      await expect(saved).toBeVisible();
      // Remove for real: a feature still uses it, so saving is refused with a readable error
      await saved.getByRole("button", { name: A.removeProvider }).click();
      await dlg.getByRole("button", { name: A.remove }).click();
      await expect(saved).toHaveCount(0);
      await page.getByRole("button", { name: A.save }).click();
      const errors = page.locator("[data-ai-errors]");
      await expect(errors).toBeVisible();
      await expect(errors).toContainText(A.codes.unknown_provider);
      await expect(page.locator('[data-route="seo"] select')).toHaveAttribute("aria-invalid", "true");
      await page.screenshot({ path: `e2e-artifacts/local-ai-settings-${lang}-${mode}-${test.info().project.name}.png`, fullPage: true });
      await reset(page);
   });
}
