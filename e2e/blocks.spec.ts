/**
 * Page builder and card posts E2E (docs/ADMIN_UI_SPEC.md "Page blocks", "Card posts"), against a
 * deployed CMS: build a page from every block type that needs no external service, upload through
 * the media chooser (never overwrites), reorder with the keyboard and by dragging, duplicate,
 * remove and undo, preview, publish, and read the result back from the public API. Then a card post:
 * slides, the live overlay, reordering, publish, /cards and the post's slides.
 * Everything created carries a stamp and is removed in afterAll. Screenshots go to e2e-artifacts/.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PNG_16X9 } from "../test/fixtures/png-16x9.ts";
import { expectNoAxeViolations, sessionPage, shot } from "./support/browser.ts";
import { ACCOUNTS, CMS_URL, hasCredentials } from "./support/env.ts";
import { sessionCookie } from "./support/sessions.ts";

test.describe.configure({ mode: "serial" });
// Scrolling to a new block is instant under reduced motion, so a tap never lands mid-scroll.
test.use({ reducedMotion: "reduce" });
test.skip(!hasCredentials, "QA_SEED_PASSWORD is not set");

const STAMP = `e2e${Date.now().toString(36)}`;
const created: { entity: string; id: number }[] = [];
const PNG = Buffer.from(PNG_16X9);

let adminCookie = "";
async function adminApi(method: string, path: string, body?: unknown) {
   if (!adminCookie) adminCookie = await sessionCookie(ACCOUNTS.admin);
   const res = await fetch(`${CMS_URL}${path}`, {
      method,
      headers: { cookie: adminCookie, origin: CMS_URL, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
   });
   return { status: res.status, json: (await res.json().catch(() => null)) as { data?: unknown } | null };
}
const publicApi = async (path: string) => {
   const res = await fetch(`${CMS_URL}/api/public/v1${path}${path.includes("?") ? "&" : "?"}_=${Date.now()}`);
   return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};
const idFromUrl = (page: Page) => Number(new URL(page.url()).pathname.split("/").pop());

async function sweep(pattern: string) {
   for (const entity of ["pages", "posts"]) {
      const where = encodeURIComponent(JSON.stringify({ slug: { $like: pattern } }));
      const res = await adminApi("GET", `/api/data/entity/${entity}?where=${where}&select=id&limit=100`);
      for (const r of (res.json?.data as { id: number }[] | undefined) ?? []) await adminApi("DELETE", `/api/data/entity/${entity}/${r.id}`);
   }
}
/** Media this run uploaded (names are generated, so they are found by the upload time). */
const uploaded = new Set<number>();

test.beforeAll(async () => {
   await sweep("blocks-e2em*");
   await sweep("cards-e2em*");
});

test.afterAll(async () => {
   for (const { entity, id } of created.reverse()) await adminApi("DELETE", `/api/data/entity/${entity}/${id}`).catch(() => undefined);
   await sweep(`*${STAMP}*`);
   for (const id of uploaded) {
      const row = await adminApi("GET", `/api/data/entity/media/${id}`);
      const path = (row.json?.data as { path?: string } | undefined)?.path;
      if (path) await adminApi("DELETE", `/api/media/file/${encodeURIComponent(path)}`).catch(() => undefined);
   }
});

const items = (page: Page, list = "blocks") => page.locator(`ol[data-seq-list=${list}] > li[data-seq-item]`);
/** Block titles without the screen-reader position (", 2 of 7"). */
const titles = async (page: Page) => (await items(page).locator(".blk-t").allTextContents()).map((t) => t.replace(/, \d+ of \d+$/, "").trim());

/** Adds a block and returns a locator for it that survives reordering (by its uid). */
const TYPES: Record<string, string> = { Text: "markdown", Image: "image", Gallery: "gallery", "Quote or callout": "quote", "Call to action": "cta", "Divider or space": "divider", "Card posts": "cards" };
async function addBlock(page: Page, name: string): Promise<Locator> {
   // The button's name is its title and description ("Text Headings, paragraphs, lists and links").
   const add = page.locator(`button[data-add-block=${TYPES[name]}]`);
   await expect(add).toHaveAccessibleName(new RegExp(`^${name} `));
   await add.click();
   await expect(page.locator("[data-blocks-editor] [data-seq-live]")).toHaveText(`${name} added.`);
   const uid = await items(page).last().getAttribute("data-uid");
   return page.locator(`ol[data-seq-list=blocks] > li[data-uid="${uid}"]`);
}

/** Opens the media chooser from `opener`, uploads a fresh image, and uses it. */
async function uploadInto(page: Page, opener: Locator, name: string) {
   // The button is relabelled after a pick ("Replace image"), so focus is checked on the element.
   await opener.evaluate((el) => el.setAttribute("data-e2e-opener", ""));
   await opener.click();
   const dlg = page.getByRole("dialog", { name: "Choose an image" });
   await expect(dlg).toBeVisible();
   await dlg.locator("[data-media-upload]").setInputFiles({ name, mimeType: "image/png", buffer: PNG });
   await expect(dlg.getByRole("button", { name: /^Use (this image|1 image)$/ })).toBeEnabled({ timeout: 30_000 });
   await dlg.getByRole("button", { name: /^Use (this image|1 image)$/ }).click();
   await expect(dlg).toBeHidden();
   const back = page.locator("[data-e2e-opener]");
   await expect(back).toBeFocused();
   await back.evaluate((el) => el.removeAttribute("data-e2e-opener"));
}

/** A pointer drag from `grip` to the top quarter of `target` (in steps, as a hand moves). */
async function dragOnto(page: Page, grip: Locator, target: Locator, cancel = false) {
   // Both ends on screen, as for a person: the target near the top, below the sticky header.
   await target.evaluate((el) => {
      el.scrollIntoView({ block: "start" });
      el.ownerDocument.defaultView?.scrollBy(0, -120);
   });
   const g = (await grip.boundingBox())!;
   const t = (await target.boundingBox())!;
   await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
   await page.mouse.down();
   const y = t.y + Math.min(24, t.height / 4);
   for (let i = 1; i <= 12; i++) await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2 + (y - g.y - g.height / 2) * (i / 12));
   if (cancel) await page.keyboard.press("Escape");
   await page.mouse.up();
}

async function mediaIdsOf(page: Page) {
   const ids = await page.locator("input[data-k=media_id]").evaluateAll((xs) => xs.map((x) => Number((x as unknown as { value: string }).value)).filter((n) => n > 0));
   ids.forEach((id) => uploaded.add(id));
   return ids;
}

test.describe("page blocks", () => {
   test("an admin builds a page from blocks: upload, reorder (keyboard, drag), duplicate, remove/undo, preview, publish (axe)", async ({ context, page }) => {
      await sessionPage(context, page, ACCOUNTS.admin, "/pages/new?locale=en");
      await page.getByLabel("Title", { exact: true }).fill(`Blocks ${STAMP}`);
      await page.getByLabel("Address", { exact: true }).fill(`blocks-${STAMP}`);
      await expect(page.locator("[data-blocks-editor]")).toContainText("No blocks yet");

      const text = await addBlock(page, "Text");
      await expect(text.locator("textarea[data-k=text]")).toBeFocused();
      await text.locator("textarea[data-k=text]").fill("## Hello\n\nThis page is **composed**.");

      const image = await addBlock(page, "Image");
      await uploadInto(page, image.getByRole("button", { name: "Choose image" }), `hero-${STAMP}.png`);
      await expect(image.locator("img[data-image-img]")).toBeVisible();
      await image.getByLabel("Image description (alt text)").fill("A test image");
      await image.getByLabel("Caption (optional)").fill("Caption one");

      const gallery = await addBlock(page, "Gallery");
      await uploadInto(page, gallery.getByRole("button", { name: "Add images" }), `g1-${STAMP}.png`);
      await uploadInto(page, gallery.getByRole("button", { name: "Add images" }), `g2-${STAMP}.png`);
      await expect(gallery.locator("ol[data-seq-list=gallery] > li")).toHaveCount(2);

      const quote = await addBlock(page, "Quote or callout");
      await quote.locator("textarea[data-k=text]").fill("Kindness is a mark of faith.");
      await quote.getByLabel("Source (optional)").fill("Hadith");

      const cta = await addBlock(page, "Call to action");
      await cta.getByLabel("Heading (optional)").fill("Join us");
      await cta.getByLabel("Button label").fill("Contact");
      await cta.getByLabel("Button link").fill("javascript:alert(1)");

      await addBlock(page, "Divider or space");
      await addBlock(page, "Card posts");

      expect(await titles(page)).toEqual(["Text", "Image", "Gallery", "Quote or callout", "Call to action", "Divider or space", "Card posts"]);

      // Keyboard: Alt+↑ from inside the divider moves it above the call to action.
      await items(page).nth(5).getByRole("button", { name: "Move up" }).focus();
      await page.keyboard.press("Alt+ArrowUp");
      await expect(page.locator("[data-blocks-editor] [data-seq-live]")).toHaveText("Moved to position 5 of 7.");
      expect((await titles(page))[4]).toBe("Divider or space");
      // Move down with the button.
      await items(page).nth(4).getByRole("button", { name: "Move down" }).click();
      expect((await titles(page))[5]).toBe("Divider or space");

      // Drag: the card posts block by its grip, pointer down → past the middle of the divider above → up.
      await dragOnto(page, items(page).nth(6).locator("[data-seq-grip]"), items(page).nth(5));
      await expect.poll(() => titles(page)).toEqual(["Text", "Image", "Gallery", "Quote or callout", "Call to action", "Card posts", "Divider or space"]);
      await expect(page.locator("[data-blocks-editor] [data-seq-live]")).toHaveText("Moved to position 6 of 7.");
      // Esc during a drag puts it back.
      await dragOnto(page, items(page).nth(5).locator("[data-seq-grip]"), items(page).nth(4), true);
      await expect.poll(() => titles(page)).toEqual(["Text", "Image", "Gallery", "Quote or callout", "Call to action", "Card posts", "Divider or space"]);

      // Duplicate the quote, remove the copy, undo, remove again.
      const before = await items(page).count();
      await items(page).filter({ hasText: "Quote or callout" }).first().getByRole("button", { name: "Duplicate" }).click();
      await expect(items(page)).toHaveCount(before + 1);
      const copy = items(page).filter({ hasText: "Quote or callout" }).nth(1);
      await expect(copy.locator("textarea[data-k=text]")).toHaveValue("Kindness is a mark of faith.");
      await copy.getByRole("button", { name: "Remove" }).click();
      await expect(items(page)).toHaveCount(before);
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(items(page)).toHaveCount(before + 1);
      await items(page).filter({ hasText: "Quote or callout" }).nth(1).getByRole("button", { name: "Remove" }).click();
      await expect(items(page)).toHaveCount(before);

      // A bad link is refused in the form, nothing is saved.
      await page.getByRole("button", { name: "Save draft" }).first().click();
      await expect(cta.locator("[data-block-err]")).toBeVisible();
      await expect(page).toHaveURL(/\/pages\/new/);
      await cta.getByLabel("Button link").fill("/contact");

      // Preview reads the blocks as the site will order them.
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      const preview = page.locator("[data-blocks-preview-body]");
      await expect(preview.locator("strong")).toHaveText("composed");
      await expect(preview.locator("blockquote")).toContainText("Kindness");
      await expect(preview.locator("img")).toHaveCount(3);
      await page.getByRole("button", { name: "Edit", exact: true }).click();

      await page.getByRole("button", { name: "Publish" }).first().click();
      await expect(page).toHaveURL(/\/pages\/\d+$/, { timeout: 30_000 });
      created.push({ entity: "pages", id: idFromUrl(page) });
      await mediaIdsOf(page);
      expect(await titles(page)).toEqual(["Text", "Image", "Gallery", "Quote or callout", "Call to action", "Card posts", "Divider or space"]);
      await expectNoAxeViolations(page);
      await shot(page, "blocks-page-editor");

      const pub = await publicApi(`/pages/blocks-${STAMP}?locale=en`);
      expect(pub.status).toBe(200);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a JSON response, checked field by field
      const blocks = pub.body.blocks as any[];
      expect(blocks.map((b: { type: string }) => b.type)).toEqual(["markdown", "image", "gallery", "quote", "cta", "cards", "divider"]);
      const img = blocks[1];
      expect(img.image).toMatchObject({ alt: "A test image", width: 16, height: 9 });
      expect(img.caption).toBe("Caption one");
      expect(blocks[2].items).toHaveLength(2);
      expect(blocks[4]).toMatchObject({ label: "Contact", url: "/contact" });
      // body stays for older readers: the blocks as markdown.
      expect(String(pub.body.body)).toContain("This page is **composed**.");

      // Uploads never replace: three distinct library files.
      expect(new Set([img.image.url, ...blocks[2].items.map((x: { image: { url: string } }) => x.image.url)]).size).toBe(3);
   });

   test("the block editor in Arabic: RTL, labels and axe", async ({ context, page }) => {
      const id = created.find((c) => c.entity === "pages")?.id;
      test.skip(!id, "needs the page from the previous test");
      await sessionPage(context, page, ACCOUNTS.admin, `/pages/${id}?lang=ar`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.getByRole("heading", { name: "محتوى الصفحة" })).toBeVisible();
      await expect(page.getByRole("button", { name: "نص عناوين وفقرات وقوائم وروابط" })).toBeVisible();
      await expectNoAxeViolations(page);
      await shot(page, "blocks-page-editor-ar");
   });
});

test.describe("card posts", () => {
   test("an admin makes a card post: slides, live overlay, reorder, publish; /cards lists it (axe)", async ({ context, page }) => {
      await sessionPage(context, page, ACCOUNTS.admin, "/posts/new?locale=en");
      await page.getByLabel("Title", { exact: true }).fill(`Cards ${STAMP}`);
      await page.getByLabel("Address", { exact: true }).fill(`cards-${STAMP}`);
      await page.getByLabel("Tags", { exact: true }).fill(`tag${STAMP},`);
      await expect(page.locator("[data-slides-editor]")).toBeHidden();
      await page.locator("label:has(input[data-post-kind][value=cards])").click();
      await expect(page.locator("[data-slides-editor]")).toBeVisible();
      await expect(page.locator("[data-kind-panel=article]")).toBeHidden();

      for (const [i, heading] of ["First light", "Second wind"].entries()) {
         await page.getByRole("button", { name: "Add a slide" }).click();
         const slide = items(page, "slides").nth(i);
         await uploadInto(page, slide.getByRole("button", { name: "Choose image" }), `slide${i}-${STAMP}.png`);
         await slide.getByLabel("Heading on the image").fill(heading);
         await slide.getByLabel("Text on the image (optional)").fill(`Body ${i + 1}`);
         await slide.getByLabel("Image description (alt text)").fill(`Slide ${i + 1} image`);
         // The overlay preview follows the fields.
         await expect(slide.locator(".ov")).toContainText(heading);
      }
      const second = items(page, "slides").nth(1);
      await second.locator("label", { hasText: "Top" }).click();
      await expect(second.locator(".ov")).toHaveClass(/ov-top/);
      await expect(page.locator("[data-slide-count]")).toHaveText("2 slides");

      // Keyboard reorder: the second slide first.
      await second.getByLabel("Heading on the image").focus();
      await page.keyboard.press("Alt+ArrowUp");
      await expect(page.locator("[data-slides-editor] [data-seq-live]")).toHaveText("Moved to position 1 of 2.");
      await expect(items(page, "slides").first().getByLabel("Heading on the image")).toHaveValue("Second wind");

      await page.getByRole("button", { name: "Publish" }).first().click();
      await expect(page).toHaveURL(/\/posts\/\d+$/, { timeout: 30_000 });
      created.push({ entity: "posts", id: idFromUrl(page) });
      await mediaIdsOf(page);
      await expect(page.locator("[data-slides-editor]")).toBeVisible();
      await expectNoAxeViolations(page);
      await shot(page, "card-post-editor");

      const post = await publicApi(`/posts/cards-${STAMP}?locale=en`);
      expect(post.status).toBe(200);
      expect(post.body.kind).toBe("cards");
      const slides = post.body.slides as { heading: string; body: string; position: string; image: { alt: string } }[];
      expect(slides.map((s) => s.heading)).toEqual(["Second wind", "First light"]);
      expect(slides[0]).toMatchObject({ position: "top", body: "Body 2", image: { alt: "Slide 2 image" } });

      const cards = await publicApi(`/cards?locale=en&tag=tag${STAMP}`);
      expect(cards.status).toBe(200);
      const list = cards.body.items as { slug: string; slide_count: number; first_slide: { heading: string } }[];
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ slug: `cards-${STAMP}`, slide_count: 2, first_slide: { heading: "Second wind" } });
   });
});
