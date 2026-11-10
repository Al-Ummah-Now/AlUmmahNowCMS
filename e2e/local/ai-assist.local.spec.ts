/**
 * AI writing assist, every editor flow (docs/AI_ASSIST_SPEC.md §9), against `wrangler dev` with a mock
 * auth issuer and a mock Claude API (playwright.local.config.ts). English and Arabic UI (RTL), light
 * and dark, accessible names and axe on every state.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";

const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 8798}`;
const ON = `http://localhost:${process.env.CMS_ON_PORT ?? 8595}`;
const OFF = `http://localhost:${process.env.CMS_OFF_PORT ?? 8596}`;
const RUN = `e2e${Date.now().toString(36)}`;
/** Unique per run and per project (desktop and mobile share one process). */
const stamp = () => `${RUN}${test.info().project.name.slice(0, 1)}`;

const WHO = {
   admin: { id: "e2e-admin", email: "e2e-admin@example.test", roles: ["Admin"] },
   moderator: { id: "e2e-mod", email: "e2e-mod@example.test", roles: ["Moderator"] },
};

test.describe.configure({ mode: "serial" });

/** Signs in through the mock issuer. `suffix` gives a distinct user (the per-user AI rate limit is 10 jobs per 10 min). */
async function signIn(page: Page, base: string, who: keyof typeof WHO, suffix = "") {
   const id = WHO[who];
   const as = suffix ? { ...id, id: `${id.id}-${suffix}`, email: id.email.replace("@", `+${suffix}@`) } : id;
   await fetch(`${MOCK}/__as`, { method: "POST", body: JSON.stringify(as) });
   await page.goto(`${base}/sso/login?return=%2F`);
   await expect(page).toHaveURL(`${base}/`);
}

async function create(page: Page, base: string, row: Record<string, unknown>): Promise<number> {
   const res = await page.request.post(`${base}/api/data/entity/posts`, { data: { status: "draft", ...row }, headers: { origin: base } });
   expect(res.status(), await res.text()).toBe(201);
   return ((await res.json()) as { data: { id: number } }).data.id;
}

async function read(page: Page, base: string, id: number) {
   const res = await page.request.get(`${base}/api/data/entity/posts/${id}`);
   return ((await res.json()) as { data: Record<string, unknown> }).data;
}

async function axe(page: Page, include?: string) {
   let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
   if (include) builder = builder.include(include);
   const results = await builder.analyze();
   expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function shot(page: Page, name: string) {
   await page.screenshot({ path: `e2e-artifacts/local-${name}-${test.info().project.name}.png`, fullPage: true });
}

for (const lang of ["en", "ar"] as const) {
   for (const mode of ["light", "dark"] as const) {
      const T = ADMIN_STRINGS[lang];
      const A = T.ai;
      // The source is in the UI language, so the Arabic UI also covers ar → en.
      const src = lang;
      const other = lang === "en" ? "ar" : "en";
      const q = `?lang=${lang}&mode=${mode}`;

      test.describe(`${lang} UI, ${mode}`, () => {
         test("SEO: suggest, use all, copy the social summary", async ({ page }) => {
            await signIn(page, ON, "moderator", `${stamp()}-${lang}-${mode}`);
            const id = await create(page, ON, { slug: `seo-${stamp()}-${lang}-${mode}`, locale: src, title: `Zakat guide ${stamp()}`, body: "How zakat is calculated." });
            await page.goto(`/posts/${id}${q}`);
            await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
            await expect(page.locator("html")).toHaveAttribute("data-mode", mode);
            await page.getByRole("button", { name: A.suggestSeo }).click();
            const panel = page.locator("[data-ai-seo-panel]");
            await expect(panel).toBeVisible();
            await expect(panel.getByRole("heading", { name: A.suggestions })).toBeVisible();
            const suggested = page.locator("#ai-seo_title");
            await expect(suggested).toHaveValue(`Zakat guide ${stamp()} — guide`.slice(0, 60));
            await expect(page.getByRole("button", { name: `${A.use}: ${T.content.seoTitle}` })).toBeVisible();
            await expect(page.getByRole("button", { name: `${A.copy}: ${A.socialSummary}` })).toBeVisible();
            await axe(page);
            await shot(page, `seo-${lang}-${mode}`);
            await page.getByRole("button", { name: A.useAll }).click();
            await expect(page.locator("#f-seo-title")).toHaveValue(await suggested.inputValue());
            await expect(page.locator("#f-seo-desc")).toHaveValue(await page.locator("#ai-seo_description").inputValue());
            await expect(page.locator("[data-dirty]")).toBeVisible();
            // Accepting a suggestion never saves: the row is unchanged until the editor saves.
            expect((await read(page, ON, id)).seo_title ?? null).toBeNull();
            await page.getByRole("button", { name: A.discard }).click();
            await expect(panel).toBeHidden();
         });

         test("pre-publish check: tone, claims and policy in a dialog", async ({ page }) => {
            await signIn(page, ON, "moderator", `${stamp()}-${lang}-${mode}`);
            const id = await create(page, ON, { slug: `ck-${stamp()}-${lang}-${mode}`, locale: src, title: `Charity appeal ${stamp()}`, body: "Over 1,000 families. As a hadith says…" });
            await page.goto(`/posts/${id}${q}`);
            await page.getByRole("button", { name: A.check }).click();
            const dlg = page.getByRole("dialog", { name: A.checkTitle });
            await expect(dlg).toBeVisible();
            await expect(dlg.getByRole("heading", { name: A.tone })).toBeVisible();
            await expect(dlg.getByRole("heading", { name: A.claims })).toBeVisible();
            await expect(dlg.getByRole("heading", { name: A.policy })).toBeVisible();
            await expect(dlg.getByText(A.categories.religious_authenticity)).toBeVisible();
            await expect(dlg.getByText(A.severity.warn)).toBeVisible();
            await axe(page, "#ai-check");
            await shot(page, `check-${lang}-${mode}`);
            await dlg.getByRole("button", { name: A.close }).first().click();
            await expect(dlg).toBeHidden();
            expect((await read(page, ON, id)).status).toBe("draft");
         });

         test("translate → review → create a draft in the other language", async ({ page }) => {
            await signIn(page, ON, "moderator", `${stamp()}-${lang}-${mode}-tr`);
            const id = await create(page, ON, {
               slug: `tr-${stamp()}-${lang}-${mode}`,
               locale: src,
               title: `Eid prayer ${stamp()}`,
               excerpt: "Times and places.",
               body: "## Where\n\nSee [the map](https://example.org/map).\n\n::video[vid-1]",
            });
            await page.goto(`/posts/${id}${q}`);
            await page.getByRole("button", { name: A.translateTo(T.locales[other]) }).click();
            const dlg = page.getByRole("dialog", { name: A.translationTitle(T.locales[other]) });
            await expect(dlg).toBeVisible();
            const title = dlg.getByLabel(T.content.title, { exact: true });
            await expect(title).toHaveAttribute("dir", other === "ar" ? "rtl" : "ltr");
            await expect(title).toHaveAttribute("lang", other);
            await expect(title).toHaveValue(other === "ar" ? `ترجمة: Eid prayer ${stamp()}` : `Translated: Eid prayer ${stamp()}`);
            await expect(dlg.getByLabel(T.content.body)).toHaveValue(/::video\[vid-1\]/);
            await expect(dlg.locator("[data-ai-tr-warn]")).toBeHidden();
            await axe(page, "#ai-translate");
            await shot(page, `translate-${lang}-${mode}`);
            await title.fill(`Edited ${stamp()} ${lang} ${mode}`);
            await dlg.getByRole("button", { name: A.createDraft(T.locales[other]) }).click();
            await page.waitForURL((u) => /^\/posts\/\d+$/.test(u.pathname) && u.pathname !== `/posts/${id}`);
            const newId = Number(new URL(page.url()).pathname.split("/").pop());
            expect(newId).not.toBe(id);
            await expect(page.locator("form[data-editor]")).toHaveAttribute("data-locale", other);
            await expect(page.locator("#f-title")).toHaveValue(`Edited ${stamp()} ${lang} ${mode}`);
            await expect(page.locator("[data-status-badge]")).toHaveText(T.status.draft);
            const row = await read(page, ON, newId);
            expect(row).toMatchObject({ status: "draft", locale: other });
            expect(String(row.body)).toContain("::video[vid-1]");
            expect(String(row.body)).toContain("https://example.org/map");
         });
      });
   }
}

for (const [lang, mode] of [["en", "light"], ["ar", "dark"]] as const) {
   test(`translate → fill the existing version as unsaved changes; a published version is never overwritten (${lang}, ${mode})`, async ({ page }) => {
      const T = ADMIN_STRINGS[lang];
      const A = T.ai;
      await signIn(page, ON, "admin", `${stamp()}-${lang}-fill`);
      const key = `k-${stamp()}-${lang}`;
      const en = await create(page, ON, { slug: `fill-${stamp()}-${lang}`, locale: "en", title: `Hajj notes ${stamp()}`, body: "Day one.", translation_key: key });
      const ar = await create(page, ON, { slug: `fill-${stamp()}-${lang}`, locale: "ar", title: "ملاحظات قديمة", body: "قديم", translation_key: key, status: "published" });
      await page.goto(`/posts/${en}?lang=${lang}&mode=${mode}`);
      await page.getByRole("button", { name: A.translateTo(T.locales.ar) }).click();
      const dlg = page.getByRole("dialog", { name: A.translationTitle(T.locales.ar) });
      await expect(dlg.getByRole("button", { name: A.createDraft(T.locales.ar) })).toBeHidden();
      await dlg.getByRole("button", { name: A.fillExisting(T.locales.ar) }).click();
      await expect(page).toHaveURL(new RegExp(`/posts/${ar}$`));
      await expect(page.locator("#f-title")).toHaveValue(`ترجمة: Hajj notes ${stamp()}`);
      await expect(page.locator("#f-body")).toHaveValue("ترجمة: Day one.");
      await expect(page.locator("[data-dirty]")).toBeVisible();
      await expect(page.getByText(A.filled)).toBeVisible();
      await axe(page);
      const row = await read(page, ON, ar);
      expect(row).toMatchObject({ title: "ملاحظات قديمة", status: "published" });
   });
}

test("a declined text shows a plain sentence, never a raw error", async ({ page }) => {
   await signIn(page, ON, "moderator", `${stamp()}-decline`);
   const id = await create(page, ON, { slug: `decline-${stamp()}`, locale: "en", title: `E2E-DECLINE ${stamp()}`, body: "x" });
   await page.goto(`/posts/${id}?lang=en`);
   await page.getByRole("button", { name: ADMIN_STRINGS.en.ai.check }).click();
   const status = page.locator('[data-ai-status="check"]');
   await expect(status).toHaveText(ADMIN_STRINGS.en.ai.errors.declined);
   await expect(page.getByRole("dialog")).toBeHidden();
   await expect(page.getByText(/refusal|stop_reason|error_code/i)).toHaveCount(0);
});

test("admins see the failed job on the Overview and can dismiss it", async ({ page }) => {
   await signIn(page, ON, "admin");
   await page.goto("/?lang=en");
   const card = page.getByRole("region", { name: ADMIN_STRINGS.en.ai.failuresTitle });
   await expect(card).toBeVisible();
   await expect(card.getByText(ADMIN_STRINGS.en.ai.reasons.declined).first()).toBeVisible();
   await axe(page);
   const before = await card.getByRole("button", { name: ADMIN_STRINGS.en.ai.dismiss }).count();
   await card.getByRole("button", { name: ADMIN_STRINGS.en.ai.dismiss }).first().click();
   if (before === 1) await expect(card).toBeHidden();
   else await expect(card.getByRole("button", { name: ADMIN_STRINGS.en.ai.dismiss })).toHaveCount(before - 1);
});

test.describe("not set up (no key)", () => {
   for (const lang of ["en", "ar"] as const) {
      test(`admins see the notice, editors see nothing (${lang})`, async ({ page }) => {
         const A = ADMIN_STRINGS[lang].ai;
         await signIn(page, OFF, "admin");
         await page.goto(`${OFF}/posts/new?lang=${lang}`);
         const card = page.getByRole("region", { name: A.card });
         await expect(card).toBeVisible();
         await expect(card.getByText(A.notSetUp)).toBeVisible();
         await expect(page.getByRole("button", { name: A.check })).toHaveCount(0);
         await expect(page.getByRole("button", { name: A.suggestSeo })).toHaveCount(0);
         await axe(page);
         await shot(page, `off-admin-${lang}`);
         await signIn(page, OFF, "moderator");
         await page.goto(`${OFF}/posts/new?lang=${lang}`);
         await expect(page.getByRole("heading", { name: ADMIN_STRINGS[lang].content.publishing })).toBeVisible();
         await expect(page.getByRole("region", { name: A.card })).toHaveCount(0);
         await expect(page.getByText(A.notSetUp)).toHaveCount(0);
         await expect(page.getByRole("button", { name: A.check })).toHaveCount(0);
      });
   }
});
