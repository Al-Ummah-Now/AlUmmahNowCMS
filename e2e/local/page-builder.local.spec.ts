/**
 * The page builder (wiki AUN-CMS-PAGE-BUILDER, docs/ADMIN_UI_SPEC.md §2.1), against `wrangler dev` with the
 * mock auth issuer (playwright.local.config.ts). An editor builds an English page from the block picker
 * (hero, features, FAQ, CTA band), the live preview renders each block with the shared renderer as it is
 * added, and the page is published. The Arabic translation copies the English blocks ("Copy from
 * English"), translates the text and is published. The public API then serves both pages with the
 * blocks the editor made, and an unpublished draft stays private. axe on the editor, the open builder
 * and the picker, in the English and the Arabic (RTL) admin.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";

const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 8798}`;
const ON = `http://localhost:${process.env.CMS_ON_PORT ?? 8595}`;
const RUN = `pgb${Date.now().toString(36)}`;

test.describe.configure({ mode: "serial" });

async function signIn(page: Page, suffix: string) {
   await fetch(`${MOCK}/__as`, { method: "POST", body: JSON.stringify({ id: `e2e-ed-${suffix}`, email: `e2e-ed+${suffix}@example.test`, roles: ["Moderator"] }) });
   await page.goto(`${ON}/sso/login?return=%2F`);
   await expect(page).toHaveURL(`${ON}/`);
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const violations = (r: Awaited<ReturnType<AxeBuilder["analyze"]>>) => r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);

/**
 * axe on the editor, and separately on the live preview's document: axe cannot run inside the
 * sandboxed srcdoc frame, so the frame's rendered page is opened as its own document (same origin, so
 * the theme and page-blocks CSS load exactly as in the frame).
 */
async function axe(page: Page) {
   expect(violations(await new AxeBuilder({ page }).withTags(AXE_TAGS).exclude("[data-pv-frame]").analyze())).toEqual([]);
   if (!(await page.locator("html.bld-lock").count())) return;
   const html = await frame(page).locator("html").evaluate((h) => `<!doctype html>${(h as unknown as { outerHTML: string }).outerHTML}`);
   const pv = await page.context().newPage();
   await pv.goto(`${ON}/healthz`);
   await pv.setContent(html, { waitUntil: "load" });
   expect(violations(await new AxeBuilder({ page: pv }).withTags(AXE_TAGS).analyze())).toEqual([]);
   await pv.close();
   await page.bringToFront();
}

async function shot(page: Page, name: string) {
   await page.screenshot({ path: `e2e-artifacts/local-pagebuilder-${name}-${test.info().project.name}.png` });
}

async function createPage(page: Page, slug: string, locale: "en" | "ar", key: string, title: string): Promise<number> {
   const res = await page.request.post(`${ON}/api/data/entity/pages`, {
      data: { slug, locale, translation_key: key, title, summary: "", blocks: [], status: "draft", publish_at: null },
      headers: { origin: ON },
   });
   expect(res.status(), await res.text()).toBe(201);
   return ((await res.json()) as { data: { id: number } }).data.id;
}

/** Adds a block from the picker (opened from the list's own "Add block" button) and returns it. */
async function addBlock(page: Page, preset: string): Promise<Locator> {
   await page.locator("[data-open-picker=end]").click();
   const picker = page.locator("#blk-picker");
   await expect(picker).toBeVisible();
   await picker.locator(`[data-preset=${preset}]`).click();
   await expect(picker).toBeHidden();
   return page.locator("ol[data-k=blocks] > li.blk").last();
}

const frame = (page: Page) => page.frameLocator("[data-pv-frame]");

interface Served {
   title: string;
   blocks: { type: string; title?: string; heading?: string; items?: { q?: string; label?: string }[]; appearance?: { tone: string; width: string } }[];
}

async function served(page: Page, slug: string, locale: string): Promise<{ status: number; body: Served | null }> {
   const res = await page.request.get(`${ON}/api/public/v1/pages/${slug}?locale=${locale}`);
   return { status: res.status(), body: res.ok() ? ((await res.json()) as Served) : null };
}

for (const lang of ["en", "ar"] as const) {
   test(`builds, previews and publishes a page in en and ar (${lang} admin)`, async ({ page }, info) => {
      const T = ADMIN_STRINGS[lang];
      const stamp = `${RUN}${lang}${info.project.name.slice(0, 1)}`;
      await signIn(page, stamp);
      const slug = `builder-${stamp}`;
      const en = await createPage(page, slug, "en", slug, "Built with blocks");
      const ar = await createPage(page, slug, "ar", slug, "صفحة من الكتل");

      // ── English page: four blocks from the picker, each rendered in the live preview. ──
      await page.goto(`${ON}/pages/${en}?lang=${lang}&mode=dark`);
      await page.locator("[data-builder-open]").click();
      await expect(page.locator("html")).toHaveClass(/bld-lock/);
      // A phone-sized screen opens the preview on Phone (a scaled desktop page is unreadable there)
      const narrow = (page.viewportSize()?.width ?? 1280) <= 1000;
      await expect(page.locator("[data-pv-frame-box]")).toHaveAttribute("data-device", narrow ? "phone" : "desktop");
      await expect(page.locator(`[data-pv-device=${narrow ? "phone" : "desktop"}]`)).toHaveAttribute("aria-pressed", "true");

      const hero = await addBlock(page, "hero");
      await hero.locator("[data-k=title]").first().fill("Watch, share and subscribe");
      await hero.locator("[data-k=subtitle]").first().fill("Videos, Shorts and live streams from creators you trust.");
      await hero.locator("[data-k=label]").first().fill("Explore videos");
      await hero.locator("[data-k=url]").first().fill("https://alummahnow.net/en");
      await expect(frame(page).locator("[data-block-type=hero] h1")).toHaveText("Watch, share and subscribe");
      await shot(page, `builder-${lang}`);

      const features = await addBlock(page, "features");
      await features.locator("[data-k=heading]").first().fill("What you'll find here");
      const featureLabels = ["Videos", "Posts", "Live streams"];
      const rows = features.locator("ol[data-k=items] > li");
      for (let i = 0; i < featureLabels.length; i++) {
         await rows.nth(i).locator("[data-k=label]").fill(featureLabels[i]);
         await rows.nth(i).locator("[data-k=text]").fill(`About ${featureLabels[i].toLowerCase()}.`);
      }
      await expect(frame(page).locator("[data-block-type=stats]")).toContainText("Live streams");

      const faq = await addBlock(page, "faq");
      await faq.locator("[data-k=heading]").first().fill("Questions");
      const qs = faq.locator("ol[data-k=items] > li");
      await qs.nth(0).locator("[data-k=q]").fill("Is it free to watch?");
      await qs.nth(0).locator("[data-k=a]").fill("Yes, every public video is free to watch.");
      await qs.nth(1).locator("[data-k=q]").fill("Can I upload?");
      await qs.nth(1).locator("[data-k=a]").fill("Creators invited by the team can upload.");
      await expect(frame(page).locator("[data-block-type=faq] summary").first()).toHaveText("Is it free to watch?");

      const cta = await addBlock(page, "ctaband");
      await cta.locator("[data-k=heading]").first().fill("Start watching");
      await cta.locator("[data-k=label]").first().fill("Open the videos site");
      await cta.locator("[data-k=url]").first().fill("https://alummahnow.net/en");
      await expect(frame(page).locator("[data-block-type=cta]")).toContainText("Start watching");
      // Every block's name reads in full: on a narrow list its tools sit on a row of their own
      for (const card of await page.locator("ol[data-k=blocks] > li.blk").all()) {
         const t = card.locator(".blk-t").first();
         expect(await t.evaluate((e) => e.scrollWidth <= e.clientWidth + 1), await t.innerText()).toBe(true);
         if (narrow) {
            const [tb, tools] = await Promise.all([card.locator(".blk-tt").boundingBox(), card.locator(":scope > .blk-h > .blk-tools").boundingBox()]);
            expect(tools!.y).toBeGreaterThanOrEqual(tb!.y + tb!.height - 1);
         }
      }

      // Phone preview, then the picker itself: both pass axe.
      await page.locator("[data-pv-device=phone]").click();
      await expect(page.locator("[data-pv-frame-box]")).toHaveAttribute("data-device", "phone");
      await axe(page);
      await page.locator("[data-pv-device=desktop]").click();
      await page.locator("[data-open-picker=end]").click();
      await expect(page.locator("#blk-picker")).toBeVisible();
      await page.locator("#blk-picker [data-picker-q]").fill(lang === "ar" ? "أسئلة" : "faq");
      await expect(page.locator("#blk-picker [data-pk-item]:visible")).toHaveCount(1);
      await shot(page, `picker-${lang}`);
      await axe(page);
      // Esc clears the search first (a search field's own behaviour), then closes the picker.
      await page.locator("#blk-picker [data-picker-q]").press("Escape");
      await expect(page.locator("#blk-picker [data-picker-q]")).toHaveValue("");
      await page.locator("#blk-picker [data-picker-q]").press("Escape");
      await expect(page.locator("#blk-picker")).toBeHidden();

      // Unpublished: the public API does not serve it.
      expect((await served(page, slug, "en")).status).toBe(404);

      // The builder's Save is the form's main button: Publish on a draft.
      await expect(page.locator("[data-builder-save]")).toContainText(T.common.publish);
      await page.locator("[data-builder-save]").click();
      await expect.poll(async () => (await served(page, slug, "en")).status).toBe(200);
      const enPage = (await served(page, slug, "en")).body!;
      expect(enPage.blocks.map((b) => b.type)).toEqual(["hero", "stats", "faq", "cta"]);
      expect(enPage.blocks[0].title).toBe("Watch, share and subscribe");
      expect(enPage.blocks[1].items?.map((x) => x.label)).toEqual(featureLabels);
      expect(enPage.blocks[2].items?.map((x) => x.q)).toEqual(["Is it free to watch?", "Can I upload?"]);
      expect(enPage.blocks[3].appearance).toMatchObject({ tone: "night", width: "full" });

      // ── Arabic page: copy the English blocks, translate, publish. ──
      await page.goto(`${ON}/pages/${ar}?lang=${lang}&mode=dark`);
      await page.locator("[data-builder-open]").click();
      await page.locator("[data-copy-from]").click();
      const list = page.locator("ol[data-k=blocks] > li.blk");
      await expect(list).toHaveCount(4);
      await expect(page.locator("[data-undo]")).toBeVisible();
      const arHero = list.nth(0);
      if (await arHero.locator("[data-blk-fold][aria-expanded=false]").count()) await arHero.locator("[data-blk-fold]").click();
      await arHero.locator("[data-k=title]").first().fill("شاهد وشارك واشترك");
      await expect(frame(page).locator("html")).toHaveAttribute("dir", "rtl");
      await expect(frame(page).locator("[data-block-type=hero] h1")).toHaveText("شاهد وشارك واشترك");
      await axe(page);
      await shot(page, `builder-ar-page-${lang}`);
      await page.locator("[data-builder-save]").click();
      await expect.poll(async () => (await served(page, slug, "ar")).status).toBe(200);
      const arPage = (await served(page, slug, "ar")).body!;
      expect(arPage.blocks.map((b) => b.type)).toEqual(["hero", "stats", "faq", "cta"]);
      expect(arPage.blocks[0].title).toBe("شاهد وشارك واشترك");

      // The closed editor (inline list) passes axe too.
      await axe(page);
   });
}
