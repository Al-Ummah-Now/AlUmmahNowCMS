import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";
import { citedQuotation } from "../../src/lib/qaf/model.ts";
import { FAKE_QAF_BLOCKED_KEY, FAKE_QAF_KEY, QAF_AI_QUERY, QAF_INJECTED_NAME, QAF_MARKUP, QAF_PASSAGE } from "../../test/support/qaf-mock.ts";

const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 8798}`;
const ON = `http://localhost:${process.env.CMS_ON_PORT ?? 8595}`;
const endpoint = "/admin/api/ai/qaf";

async function signIn(page: Page, role: "Admin" | "Moderator", suffix: string) {
   const id = `e2e-qaf-${role}-${suffix}`;
   await fetch(`${MOCK}/__as`, { method: "POST", body: JSON.stringify({ id, email: `${id}@example.test`, roles: [role] }) });
   await page.goto(`${ON}/sso/login?return=%2F`);
   await expect(page).toHaveURL(`${ON}/`);
}

async function setKey(page: Page, key: string | null) {
   const response = await page.request.put(`${ON}${endpoint}/settings`, { data: { key }, headers: { origin: ON } });
   expect(response.status(), await response.text()).toBe(200);
}

for (const lang of ["en", "ar"] as const) {
   const t = ADMIN_STRINGS[lang].qaf;
   test(`${lang}: set a write-only key, search selected text, review context, and insert verbatim`, async ({ page, browser }, info) => {
      await signIn(page, "Admin", lang);
      await setKey(page, null);
      const { viewport, deviceScaleFactor, isMobile, hasTouch, userAgent } = info.project.use;
      const capture = process.env.QAF_CAPTURE === "1" && info.project.name === "desktop";
      const editor = await browser.newPage({
         viewport: capture ? { width: 1360, height: 1000 } : viewport,
         deviceScaleFactor, isMobile, hasTouch, userAgent,
      });
      try {
         await signIn(editor, "Moderator", lang);
         await editor.goto(`${ON}/posts/new?lang=${lang}&locale=${lang}&mode=dark`);
         await expect(editor.locator("[data-qaf-card]")).toHaveCount(0);
         await page.goto(`${ON}/ai-settings?lang=${lang}&mode=dark`);
         const settings = page.getByRole("form", { name: t.settings });
         await expect(settings.getByText(t.notSet, { exact: true })).toBeVisible();
         if (capture) await page.setViewportSize({ width: 1100, height: 900 });
         await settings.getByLabel(t.key, { exact: true }).fill(FAKE_QAF_KEY);
         await settings.getByRole("button", { name: t.saveKey }).click();
         await expect(settings.getByText(t.connected, { exact: true })).toBeVisible();
         await expect(settings.getByLabel(t.replaceKey)).toHaveValue("");
         expect(await page.content()).not.toContain(FAKE_QAF_KEY);
         await editor.reload();
         await expect(editor.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
         const body = editor.locator("#f-body");
         const draft = lang === "ar" ? "الصبر عند المصيبة" : "Patience through hardship";
         await body.fill(draft);
         await body.selectText();
         await editor.getByRole("button", { name: t.open, exact: true }).click();
         const dialog = editor.getByRole("dialog", { name: t.title });
         const query = dialog.getByLabel(t.topic);
         await expect(query).toHaveValue(draft);
         await dialog.getByRole("button", { name: t.suggest }).click();
         await expect(query).toHaveValue(QAF_AI_QUERY);
         await dialog.getByText(t.filters, { exact: true }).click();
         await dialog.getByLabel(t.genre).selectOption("hanbali-fiqh");
         await dialog.getByLabel(t.author, { exact: true }).fill("Munawi");
         await dialog.getByRole("button", { name: t.lookupAuthor }).click();
         await dialog.getByLabel(t.chooseAuthor).selectOption("423");
         await dialog.getByLabel(t.book, { exact: true }).fill("Fayd");
         await dialog.getByRole("button", { name: t.lookupBook }).click();
         await dialog.getByLabel(t.chooseBook).selectOption("31f522f9-b85c-5c78-a8ff-dc48ebce183c");
         await dialog.getByLabel(t.fromYear).fill(lang === "ar" ? "١٠٠٠" : "1000");
         await dialog.getByLabel(t.toYear).fill("1100");
         const request = editor.waitForRequest((req) => req.url().endsWith("/search") && req.method() === "POST");
         await dialog.getByRole("button", { name: t.search }).click();
         expect((await request).postDataJSON()).toMatchObject({
            query: QAF_AI_QUERY, locale: lang,
            filters: { genres: ["hanbali-fiqh"], authorIds: [423], bookIds: ["31f522f9-b85c-5c78-a8ff-dc48ebce183c"], deathYearAH: { gte: 1000, lte: 1100 } },
         });
         const result = dialog.locator(".qaf-result");
         const quotation = result.locator(".qaf-excerpt").first();
         await expect(quotation).toHaveAttribute("dir", "rtl");
         expect(await quotation.textContent()).toBe(QAF_PASSAGE.text);
         await expect(result.getByRole("link").first()).toHaveAttribute("rel", "noopener noreferrer nofollow");
         await expect(result.getByRole("link").first()).toContainText(lang === "ar" ? "ص ١٢٣٤" : "p. 1234");
         // The same search is served from D1 and does not consume another search.
         const hit = editor.waitForResponse((res) => res.url().endsWith("/search"));
         await dialog.getByRole("button", { name: t.search }).click();
         expect((await hit).headers()["x-qaf-cache"]).toBe("hit");
         await expect(result).toBeVisible();
         if (capture) {
            await editor.locator(".qaf-filters summary").click();
            await dialog.locator(".dlg-b").evaluate((body) => body.scrollTo(0, 0));
            await dialog.screenshot({ path: `e2e-artifacts/qaf-panel-${lang}-dark.png`, animations: "disabled" });
            await page.reload();
            await expect(settings).toContainText(lang === "ar" ? "٢٤٩٩" : "2499");
            await settings.screenshot({ path: `e2e-artifacts/qaf-settings-${lang}-dark.png`, animations: "disabled" });
         }
         await result.getByText(t.context, { exact: true }).click();
         await expect(result.getByText("السياق السابق.")).toBeVisible();
         await expect(result.getByText("حاشية الطبعة.")).toBeVisible();
         await result.getByRole("button", { name: t.insert }).click();
         await expect(dialog).not.toBeVisible();
         await expect(body).toHaveValue(`${draft}\n\n${citedQuotation(QAF_PASSAGE, lang)}`);
         await expect(editor.locator("[data-dirty]")).toBeVisible();
         await expect(editor).toHaveURL(/\/posts\/new/);
      } finally {
         await editor.close();
         await setKey(page, null);
      }
   });
}

test("shows rate-limit errors and provider incidents without echoing upstream data", async ({ page }, info) => {
   await signIn(page, "Admin", "errors");
   const t = ADMIN_STRINGS.en.qaf;
   await setKey(page, FAKE_QAF_KEY);
   try {
      await page.goto(`${ON}/posts/new?lang=en`);
      await page.getByRole("button", { name: t.open, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: t.title });
      async function search(query: string, status: number) {
         await dialog.getByLabel(t.topic).fill(`${query}-${info.project.name}`);
         const response = page.waitForResponse((res) => res.url().endsWith("/search"));
         await dialog.getByRole("button", { name: t.search }).click();
         const res = await response;
         expect(res.status()).toBe(status);
         expect(await res.text()).not.toContain("Private upstream error");
      }
      const message = dialog.locator("[data-qaf-message]");
      await search("fixture-422", 422);
      await expect(message).toHaveText(t.errors.validation);
      await search("fixture-minute", 200);
      await expect(dialog.locator(".qaf-result")).toBeVisible();
      await search("fixture-minute-always", 429);
      await expect(message).toContainText(t.errors.minute.split("{n}")[0]);
      await search("fixture-week", 429);
      await expect(message).toContainText(t.errors.week);
      await page.goto(`${ON}/?lang=en`);
      await expect(page.locator("[data-qaf-failure]")).toContainText(t.errors.week);
      await setKey(page, FAKE_QAF_BLOCKED_KEY);
      await page.goto(`${ON}/posts/new`);
      await page.getByRole("button", { name: t.open, exact: true }).click();
      await search("new-topic", 429);
      await expect(message).toHaveText(t.errors.invalid_keys);
      await page.goto(`${ON}/?lang=en`);
      await expect(page.locator("[data-qaf-failure]")).toContainText(t.errors.invalid_keys);
      await expect(page.locator("[data-qaf-failure]")).not.toContainText(FAKE_QAF_BLOCKED_KEY);
   } finally {
      await setKey(page, null);
   }
});

test("inserts into a page block and keeps injected source text inert in CMS previews", async ({ page }) => {
   await signIn(page, "Admin", "literal");
   const t = ADMIN_STRINGS.en.qaf;
   await setKey(page, FAKE_QAF_KEY);
   try {
      await page.goto(`${ON}/pages/new?lang=en`);
      await page.locator("[data-qaf-card]").getByRole("button", { name: t.open }).click();
      const dialog = page.getByRole("dialog", { name: t.title });
      await dialog.getByLabel(t.topic).fill("fixture-xss");
      await dialog.getByRole("button", { name: t.search }).click();
      const results = dialog.locator(".qaf-result");
      await expect(results).toHaveCount(2);
      await expect(results.first().getByRole("link").first()).toContainText(QAF_INJECTED_NAME);
      expect(await results.first().locator(".qaf-excerpt").textContent()).toBe(QAF_MARKUP);
      await expect(results.locator("script,img,[onerror]")).toHaveCount(0);
      await expect(results.nth(1).getByRole("link")).toHaveCount(0);
      await expect(results.nth(1).getByRole("button", { name: t.insert })).toBeDisabled();
      await results.first().getByRole("button", { name: t.insert }).click();
      await expect(page.locator("[data-block-type=markdown] textarea")).toHaveValue(new RegExp(QAF_MARKUP.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      await expect(page.locator("[data-dirty]")).toBeVisible();
      await page.locator("[data-builder-open]").click();
      const preview = page.frameLocator("[data-pv-frame]");
      await expect(preview.locator(".pb-qaf-quote")).toHaveAttribute("dir", "rtl");
      expect(await preview.locator(".pb-qaf-quote").textContent()).toBe(QAF_MARKUP);
      await expect(preview.locator(".pb-qaf-quote").locator("script,img,[onerror]")).toHaveCount(0);
      expect(await page.evaluate(() => (globalThis as { qafXss?: boolean }).qafXss)).toBeUndefined();
   } finally {
      await setKey(page, null);
   }
});
