/**
 * The in-app dialogs in a real browser (src/admin/client/dialogs.ts), against the local `wrangler dev`
 * CMS (playwright.local.config.ts): insert link (validation, wraps the selected text), the leave guard on
 * in-app links with unsaved changes, the unpublish confirm (no reason field), and the soft delete's confirm with its optional reason.
 * English and Arabic UI; axe on each open dialog. The browser's own dialogs must never appear.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";

const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 8798}`;
const ON = `http://localhost:${process.env.CMS_ON_PORT ?? 8595}`;
const RUN = `dlg${Date.now().toString(36)}`;
const stamp = () => `${RUN}${test.info().project.name.slice(0, 1)}`;

test.describe.configure({ mode: "serial" });

/** Native dialogs seen in the current test: must stay empty. */
let native: string[] = [];
test.beforeEach(() => {
   native = [];
});
test.afterEach(() => {
   expect(native, "the browser's own dialogs").toEqual([]);
});

async function signIn(page: Page, suffix: string) {
   const as = { id: `e2e-admin-${suffix}`, email: `e2e-admin+${suffix}@example.test`, roles: ["Admin"] };
   await fetch(`${MOCK}/__as`, { method: "POST", body: JSON.stringify(as) });
   await page.goto(`${ON}/sso/login?return=%2F`);
   await expect(page).toHaveURL(`${ON}/`);
   // Any native dialog (confirm / alert / prompt / beforeunload) fails the test.
   page.on("dialog", (d) => {
      native.push(`${d.type()}: ${d.message()}`);
      void d.dismiss();
   });
}

async function create(page: Page, row: Record<string, unknown>): Promise<number> {
   const res = await page.request.post(`${ON}/api/data/entity/posts`, { data: { status: "draft", ...row }, headers: { origin: ON } });
   expect(res.status(), await res.text()).toBe(201);
   return ((await res.json()) as { data: { id: number } }).data.id;
}

async function axe(page: Page, include: string) {
   const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).include(include).analyze();
   expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

for (const lang of ["en", "ar"] as const) {
   const T = ADMIN_STRINGS[lang];
   const q = `?lang=${lang}`;

   test.describe(`${lang} UI`, () => {
      test("insert link: refuses javascript:, wraps the selected text", async ({ page }) => {
         await signIn(page, `${stamp()}-${lang}-l`);
         const id = await create(page, { slug: `link-${stamp()}-${lang}`, locale: lang, title: `Link ${stamp()}`, body: "read the guide here" });
         await page.goto(`/posts/${id}${q}`);
         const body = page.locator("#f-body");
         await body.evaluate((el) => (el as unknown as { setSelectionRange(a: number, b: number): void }).setSelectionRange(9, 14));
         await page.getByRole("button", { name: T.content.link, exact: true }).click();
         const dlg = page.getByRole("dialog", { name: T.common.linkTitle });
         await expect(dlg).toBeVisible();
         const url = dlg.getByLabel(T.common.linkLabel);
         await expect(url).toBeFocused();
         await expect(url).toHaveValue("https://");
         await url.fill("javascript:alert(1)");
         await dlg.getByRole("button", { name: T.common.insert, exact: true }).click();
         await expect(dlg).toBeVisible();
         await expect(dlg.locator("#link-err")).toHaveText(T.common.linkBad);
         await expect(url).toHaveAttribute("aria-invalid", "true");
         await axe(page, "#link-dlg");
         await url.fill("/about");
         await url.press("Enter");
         await expect(dlg).toBeHidden();
         await expect(body).toHaveValue("read the [guide](/about) here");
         await expect(body).toBeFocused();
         // Esc cancels and inserts nothing.
         await page.getByRole("button", { name: T.content.link, exact: true }).click();
         await page.keyboard.press("Escape");
         await expect(dlg).toBeHidden();
         await expect(body).toHaveValue("read the [guide](/about) here");
      });

      test("unsaved changes: in-app links ask, Stay keeps the page, Leave anyway follows the link", async ({ page }) => {
         await signIn(page, `${stamp()}-${lang}-g`);
         const id = await create(page, { slug: `leave-${stamp()}-${lang}`, locale: lang, title: `Leave ${stamp()}` });
         await page.goto(`/posts/${id}${q}`);
         await page.locator("#f-title").fill(`Changed ${stamp()}`);
         await page.locator("header a.brand").click();
         const dlg = page.getByRole("dialog", { name: T.common.leaveTitle });
         await expect(dlg).toContainText(T.common.leaveUnsaved);
         await expect(dlg.getByRole("button", { name: T.common.stay, exact: true })).toBeFocused();
         await axe(page, "#leave-dlg");
         await page.keyboard.press("Escape");
         await expect(dlg).toBeHidden();
         await expect(page).toHaveURL(new RegExp(`/posts/${id}`));
         await page.locator("header a.brand").click();
         await dlg.getByRole("button", { name: T.common.leaveAnyway, exact: true }).click();
         await expect(page).toHaveURL(`${ON}/`);
         // Reload / close never prompt (no beforeunload): reaching here without a native dialog proves it.
      });

      test("unpublish asks first; delete asks with an optional reason", async ({ page }) => {
         await signIn(page, `${stamp()}-${lang}-d`);
         const title = `Gone ${stamp()} ${lang}`;
         const id = await create(page, { slug: `gone-${stamp()}-${lang}`, locale: lang, title, status: "published" });
         await page.goto(`/posts/${id}${q}`);
         await page.getByRole("button", { name: T.common.unpublish, exact: true }).first().click();
         const un = page.getByRole("dialog", { name: T.common.unpublishTitle });
         await expect(un.getByRole("button", { name: T.common.cancel, exact: true })).toBeFocused();
         await expect(un.getByLabel(T.common.reason)).toBeHidden();
         await axe(page, "#confirm");
         await un.getByRole("button", { name: T.common.cancel, exact: true }).click();
         await expect(page.locator("[data-status-badge]")).toHaveText(T.status.published);
         await page.getByRole("button", { name: T.common.unpublish, exact: true }).first().click();
         await un.getByRole("button", { name: T.common.unpublish, exact: true }).click();
         await expect(page).toHaveURL(/done=unpublished|\/posts\/\d+$/);
         await expect(page.locator("[data-status-badge]")).toHaveText(T.status.draft);

         await page.getByRole("button", { name: T.common.delete, exact: true }).click();
         const del = page.getByRole("dialog", { name: T.common.confirmDelete });
         const ok = del.getByRole("button", { name: T.common.delete, exact: true });
         await expect(del.getByRole("button", { name: T.common.cancel, exact: true })).toBeFocused();
         await expect(ok).toBeEnabled();
         await axe(page, "#confirm");
         await del.getByLabel(T.common.reason).fill("e2e");
         await ok.click();
         await expect(page).toHaveURL(/\/posts\?done=deleted|\/posts$/);
      });
   });
}
