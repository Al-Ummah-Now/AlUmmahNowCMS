/**
 * Translation flags (docs/TRANSLATION_FLAGS.md), against `wrangler dev` with the mock auth issuer and the
 * mock Workers AI (playwright.local.config.ts): select a word → flag it → add to glossary → apply the
 * suggestion → save resolves it; re-translate selection (mocked alternatives); a manual edit of flagged
 * words asks in-app and resolves on save; the list badge. English and Arabic UI (RTL), axe on each state.
 * No paid AI: the mock answers every model call.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";

const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 8798}`;
const ON = `http://localhost:${process.env.CMS_ON_PORT ?? 8595}`;
const RUN = `trf${Date.now().toString(36)}`;
const stamp = () => `${RUN}${test.info().project.name.slice(0, 1)}`;

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, suffix: string) {
   await fetch(`${MOCK}/__as`, { method: "POST", body: JSON.stringify({ id: `e2e-mod-${suffix}`, email: `e2e-mod+${suffix}@example.test`, roles: ["Moderator"] }) });
   await page.goto(`${ON}/sso/login?return=%2F`);
   await expect(page).toHaveURL(`${ON}/`);
}

async function create(page: Page, row: Record<string, unknown>): Promise<number> {
   const res = await page.request.post(`${ON}/api/data/entity/posts`, { data: { status: "draft", ...row }, headers: { origin: ON } });
   expect(res.status(), await res.text()).toBe(201);
   return ((await res.json()) as { data: { id: number } }).data.id;
}

async function axe(page: Page) {
   const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
   expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function shot(page: Page, name: string) {
   await page.screenshot({ path: `e2e-artifacts/local-trflags-${name}-${test.info().project.name}.png`, fullPage: true });
}

/** The bits of a textarea the page scripts below use (the e2e tsconfig has no DOM lib). */
interface TextArea {
   value: string;
   selectionStart: number;
   selectionEnd: number;
   focus(): void;
   setSelectionRange(start: number, end: number): void;
   dispatchEvent(e: unknown): boolean;
}

/** Selects `quote` in a field the way a user would end up (focus + selection), which shows the popover. */
async function select(page: Page, selector: string, quote: string) {
   await page.locator(selector).evaluate((node, q) => {
      const f = node as unknown as TextArea;
      const i = f.value.indexOf(q);
      f.focus();
      f.setSelectionRange(i, i + q.length);
      const W = globalThis as unknown as { KeyboardEvent: new (type: string, init: object) => unknown };
      f.dispatchEvent(new W.KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
   }, quote);
}

const AR_BODY = "كُتب عليكم الصيام. وهو يعلّم الصبر. وينتهي عند الغروب.";
const EN_BODY = "Fasting is prescribed for you. It teaches endurance. It ends at sunset.";

for (const lang of ["en", "ar"] as const) {
   const T = ADMIN_STRINGS[lang];
   const F = T.trFlags;
   const mode = lang === "en" ? "light" : "dark";

   test(`select → flag → glossary → apply → save resolves (${lang} UI, ${mode})`, async ({ page }) => {
      await signIn(page, `${stamp()}-${lang}`);
      const key = crypto.randomUUID();
      await create(page, { slug: `trf-ar-${stamp()}-${lang}`, locale: "ar", title: "الصيام", body: AR_BODY, translation_key: key });
      const en = await create(page, { slug: `trf-en-${stamp()}-${lang}`, locale: "en", title: "Fasting", body: EN_BODY, translation_key: key });
      await page.goto(`${ON}/posts/${en}?lang=${lang}&mode=${mode}`);
      const card = page.getByRole("region", { name: F.card });
      await expect(card).toBeVisible();
      await expect(card.getByText(F.none)).toBeVisible();

      // Select a word → the popover → the dialog with the matching source sentence.
      await select(page, "#f-body", "endurance");
      const flagBtn = page.getByRole("button", { name: F.flag });
      await expect(flagBtn).toBeVisible();
      await shot(page, `popover-${lang}`);
      await flagBtn.click();
      const dlg = page.getByRole("dialog", { name: F.dialogTitle });
      await expect(dlg).toBeVisible();
      await expect(dlg.locator("[data-trf-quote]")).toHaveText("endurance");
      await expect(dlg.locator("[data-trf-src]")).toHaveText("وهو يعلّم الصبر.");
      await dlg.getByRole("radio", { name: F.reasons.term }).check();
      await dlg.getByLabel(F.suggestion).fill("patience");
      await axe(page);
      await shot(page, `dialog-${lang}`);
      await dlg.getByRole("button", { name: F.submit }).click();
      await expect(dlg).toBeHidden();

      // Listed in the card; highlighted in the field (tinted + underlined, aria-hidden layer).
      const item = card.locator("[data-trf-flag]").first();
      await expect(item).toContainText("endurance");
      await expect(item).toContainText(F.reasons.term);
      await expect(page.locator(".trf-mirror mark")).toHaveText("endurance");
      await expect(card.locator("[data-trf-count]")).toHaveText(F.openCount.replace("{0}", "1"));
      await axe(page);
      await shot(page, `flagged-${lang}`);

      // Show in text selects the span (keyboard path to the highlight).
      await item.getByRole("button", { name: F.jumpTo.replace("{0}", "endurance") }).click();
      expect(await page.locator("#f-body").evaluate((n) => {
               const f = n as unknown as TextArea;
               return f.value.slice(f.selectionStart, f.selectionEnd);
            })).toBe("endurance");

      // Add to glossary (wrong term + a correction).
      await item.getByRole("button", { name: F.addGlossary }).click();
      const gl = page.getByRole("dialog", { name: F.glossTitle });
      await expect(gl.getByLabel(F.glossTarget.replace("{0}", T.locales.en))).toHaveValue("patience");
      await gl.getByLabel(F.glossSource.replace("{0}", T.locales.ar)).fill(`الصبر ${stamp()}${lang}`); // unique: the local D1 lives across runs
      await gl.getByRole("button", { name: F.addGlossary }).click();
      await expect(page.getByText(F.glossAdded).first()).toBeVisible();

      // Apply the suggestion: pending until the save, then history.
      await card.locator("[data-trf-flag]").first().getByRole("button", { name: F.apply }).click();
      await expect(page.locator("#f-body")).toHaveValue(EN_BODY.replace("endurance", "patience"));
      await expect(card.getByText(F.pending)).toBeVisible();
      await page.getByRole("button", { name: T.common.saveDraft }).filter({ visible: true }).first().click();
      // The save reloads the editor (its ?done= toast parameter then leaves the address bar).
      await expect(page).toHaveURL(new RegExp(`/posts/${en}$`));
      await expect(card.getByText(F.none)).toBeVisible();
      await card.getByText(F.history).click();
      await expect(card.locator("[data-trf-history] li").first()).toContainText(F.resolutions.applied);

      // The glossary page lists the new term.
      await page.goto(`${ON}/glossary?lang=${lang}&mode=${mode}`);
      await expect(page.getByRole("heading", { name: T.glossary.title })).toBeVisible();
      await expect(page.getByRole("list", { name: T.glossary.title })).toContainText(`الصبر ${stamp()}${lang}`);
      await axe(page);
      await shot(page, `glossary-${lang}`);
   });

   test(`re-translate selection, edit-to-resolve prompt, list badge (${lang} UI)`, async ({ page }) => {
      await signIn(page, `${stamp()}-${lang}-b`);
      const key = crypto.randomUUID();
      await create(page, { slug: `trf2-ar-${stamp()}-${lang}`, locale: "ar", title: "الصيام", body: AR_BODY, translation_key: key });
      const en = await create(page, { slug: `trf2-en-${stamp()}-${lang}`, locale: "en", title: "Fasting", body: EN_BODY, translation_key: key });
      await page.goto(`${ON}/posts/${en}?lang=${lang}`);
      const card = page.getByRole("region", { name: F.card });

      const flag = async (quote: string, reason: string) => {
         await select(page, "#f-body", quote);
         await page.getByRole("button", { name: F.flag }).click();
         const dlg = page.getByRole("dialog", { name: F.dialogTitle });
         await dlg.getByRole("radio", { name: reason }).check();
         await dlg.getByRole("button", { name: F.submit }).click();
         await expect(card.locator("[data-trf-flag]", { hasText: quote })).toBeVisible();
      };
      await flag("sunset", F.reasons.meaning);
      await flag("Fasting", F.reasons.islamic_term);

      // The list shows the open count.
      await page.goto(`${ON}/posts?lang=${lang}&locale=en`);
      await expect(page.locator(`a[href="/posts/${en}"]`).locator("xpath=../..").locator("[data-trf-badge]")).toContainText(F.openCount.replace("{0}", "2"));
      await page.goto(`${ON}/posts/${en}?lang=${lang}`);

      // Re-translate selection: alternatives from the (mocked) provider, pick one.
      await card.locator("[data-trf-flag]", { hasText: "sunset" }).getByRole("button", { name: F.retranslate }).click();
      const alt = page.getByRole("dialog", { name: F.altTitle });
      await expect(alt.getByRole("radio", { name: "Option A: sunset" })).toBeVisible();
      await alt.getByRole("radio", { name: "Option B: sunset" }).check();
      await axe(page);
      await shot(page, `alternatives-${lang}`);
      await alt.getByRole("button", { name: F.altUse }).click();
      await expect(page.locator("#f-body")).toHaveValue(/It ends at Option B: sunset\./);

      // Edit flagged words by hand: an in-app prompt (never a browser one) offers to resolve on save.
      await page.locator("#f-body").evaluate((n) => {
         const f = n as unknown as TextArea;
         f.focus();
         f.setSelectionRange(0, "Fasting".length);
      });
      await page.keyboard.type("Sawm");
      await page.locator("#f-title").focus(); // blur → change
      const edit = page.getByRole("dialog", { name: F.editTitle });
      await expect(edit).toBeVisible();
      await expect(edit).toContainText("Fasting");
      await shot(page, `edit-prompt-${lang}`);
      await edit.getByRole("button", { name: F.editResolve }).click();
      await page.getByRole("button", { name: T.common.saveDraft }).filter({ visible: true }).first().click();
      await expect(page).toHaveURL(new RegExp(`/posts/${en}$`));
      await expect(card.getByText(F.none)).toBeVisible();
      await card.getByText(F.history).click();
      await expect(card.locator("[data-trf-history]")).toContainText(F.resolutions.edited);
      await expect(card.locator("[data-trf-history]")).toContainText(F.resolutions.retranslated);
   });
}
