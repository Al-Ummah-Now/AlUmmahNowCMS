/**
 * The new post / page address (slug) is made from the title (src/lib/slug.ts, src/admin/client/editor.ts),
 * in a real browser against the local `wrangler dev` CMS (playwright.local.config.ts): Arabic titles are
 * transliterated live, a typed address stays until "Regenerate from title", a taken generated address
 * saves as -2, and a live address changes only after the in-app warning. English and Arabic UI.
 */
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";

const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 8798}`;
const ON = `http://localhost:${process.env.CMS_ON_PORT ?? 8595}`;
const RUN = `slug${Date.now().toString(36)}`;
const stamp = () => `${RUN}${test.info().project.name.slice(0, 1)}`;

test.describe.configure({ mode: "serial" });

let native: string[] = [];
test.afterEach(() => {
   expect(native, "the browser's own dialogs").toEqual([]);
});

async function signIn(page: Page, suffix: string) {
   native = [];
   const as = { id: `e2e-admin-${suffix}`, email: `e2e-admin+${suffix}@example.test`, roles: ["Admin"] };
   await fetch(`${MOCK}/__as`, { method: "POST", body: JSON.stringify(as) });
   await page.goto(`${ON}/sso/login?return=%2F`);
   await expect(page).toHaveURL(`${ON}/`);
   page.on("dialog", (d) => {
      native.push(`${d.type()}: ${d.message()}`);
      void d.dismiss();
   });
}

const slugOf = async (page: Page, kind: string, id: number) =>
   ((await (await page.request.get(`${ON}/api/data/entity/${kind}/${id}`)).json()) as { data: { slug: string } }).data.slug;
const idOf = (page: Page) => Number(new URL(page.url()).pathname.split("/").pop());

for (const lang of ["en", "ar"] as const) {
   const T = ADMIN_STRINGS[lang];

   test(`${lang} UI: create post → address filled from the Arabic title, override, regenerate, -2, live lock`, async ({ page }) => {
      await signIn(page, `${stamp()}-${lang}`);
      const tag = `${stamp()}${lang}`;
      const title = `إن الدين عند الله الإسلام ${tag}`;
      const auto = `inna-al-din-inda-allah-al-islam-${tag}`;
      const titleBox = page.locator("#f-title");
      const address = page.locator("#f-slug");
      await page.goto(`/posts/new?locale=ar&lang=${lang}`);
      await expect(address).toHaveValue("");
      await titleBox.fill(title);
      await expect(address).toHaveValue(auto);

      // Typed by hand: the title no longer drives it, until "Regenerate from title".
      await address.fill(`mine-${tag}`);
      await titleBox.fill(`${title} x`);
      await expect(address).toHaveValue(`mine-${tag}`);
      await titleBox.fill(title);
      await page.getByRole("button", { name: T.content.slugRegen }).click();
      await expect(address).toHaveValue(auto);
      await page.getByRole("button", { name: T.common.saveDraft }).first().click();
      await expect(page).toHaveURL(/\/posts\/\d+/);
      const first = idOf(page);
      expect(await slugOf(page, "posts", first)).toBe(auto);

      // The same title again: the generated address saves as -2 instead of failing.
      await page.goto(`/posts/new?locale=ar&lang=${lang}`);
      await titleBox.fill(title);
      await expect(address).toHaveValue(auto);
      await page.getByRole("button", { name: T.common.saveDraft }).first().click();
      await expect(page).toHaveURL(/\/posts\/\d+/);
      expect(await slugOf(page, "posts", idOf(page))).toBe(`${auto}-2`);

      // A typed digits-only address is refused (the old "1").
      await page.goto(`/posts/new?locale=ar&lang=${lang}`);
      await titleBox.fill(`${title} y`);
      await address.fill("1");
      await page.getByRole("button", { name: T.common.saveDraft }).first().click();
      await expect(page.locator("#f-slug-err")).toHaveText(T.content.slugNumeric);
      await expect(page).toHaveURL(/\/posts\/new/);

      // Live: locked; "Change address" asks in the page's own dialog first.
      const pub = await page.request.patch(`${ON}/api/data/entity/posts/${first}`, { data: { status: "published" }, headers: { origin: ON } });
      expect(pub.status(), await pub.text()).toBe(200);
      await page.goto(`/posts/${first}?lang=${lang}`);
      await expect(address).toHaveAttribute("readonly", "");
      await page.getByRole("button", { name: T.content.slugChange }).click();
      const warn = page.getByRole("dialog", { name: T.content.slugChangeTitle });
      await expect(warn).toBeVisible();
      await warn.getByRole("button", { name: T.common.cancel }).click();
      await expect(address).toHaveAttribute("readonly", "");
      await page.getByRole("button", { name: T.content.slugChange }).click();
      await warn.getByRole("button", { name: T.content.slugChangeOk }).click();
      await expect(address).not.toHaveAttribute("readonly", "");
   });
}
