/**
 * Staff screens E2E against a deployed CMS (docs/ADMIN_UI_SPEC.md §8): one test per group of
 * inventory cases. Everything created is named with a unique stamp and removed in afterAll.
 * Screenshots go to e2e-artifacts/.
 */
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STRINGS } from "../src/admin/i18n.ts";
import { expectNoAxeViolations, sessionPage, shot } from "./support/browser.ts";
import { ACCOUNTS, CMS_URL, hasCredentials } from "./support/env.ts";
import { sessionCookie } from "./support/sessions.ts";

test.describe.configure({ mode: "serial" });
test.skip(!hasCredentials, "QA_SEED_PASSWORD is not set");

const STAMP = `e2e${Date.now().toString(36)}`;
const created: { entity: string; id: number }[] = [];
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

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
async function saveSite(page: Page) {
   const done = page.waitForURL(/done=saved/, { timeout: 30_000 });
   await page.getByRole("button", { name: "Save" }).click();
   await done;
   await page.waitForLoadState("load");
}
const idFromUrl = (page: Page) => Number(new URL(page.url()).pathname.split("/").pop());

/** Deletes rows carrying an E2E stamp: this run's in afterAll, any run's (a crashed run can't clean up) in beforeAll. */
async function sweep(pattern: string) {
   for (const [entity, field] of [["nav_items", "label"], ["pages", "slug"], ["posts", "slug"], ["curated_videos", "title_override"]] as const) {
      const where = encodeURIComponent(JSON.stringify({ [field]: { $like: pattern } }));
      const res = await adminApi("GET", `/api/data/entity/${entity}?where=${where}&select=id&limit=100`);
      for (const r of (res.json?.data as { id: number }[] | undefined) ?? []) await adminApi("DELETE", `/api/data/entity/${entity}/${r.id}`);
   }
}

test.beforeAll(async () => {
   // Stamps are "e2e" + base-36 time; anything older than this run left by a crash goes now.
   await sweep("*e2em*");
});

test.afterAll(async () => {
   for (const { entity, id } of created.reverse()) await adminApi("DELETE", `/api/data/entity/${entity}/${id}`).catch(() => undefined);
   // Rows made through the UI without a known id (nav links, videos) carry the stamp.
   await sweep(`*${STAMP}*`);
});

test.describe("shell", () => {
   test("overview, rail, account menu, language, appearance and the theme preview (axe en/ar)", async ({ context, page }) => {
      await sessionPage(context, page, ACCOUNTS.admin);
      await expect(page).toHaveURL(`${CMS_URL}/`);
      await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", /^(fawanees|lantern|zujaj|nahas)$/);
      const sections = ["Overview", "Pages", "Posts", "Videos", "Navigation", "Site", "Library", "People"];
      const rail = page.locator("nav.rail");
      if (await rail.isVisible()) {
         for (const name of sections) await expect(rail.getByRole("link", { name, exact: true })).toBeVisible();
      } else {
         // Phones: a bottom bar plus the drawer behind the menu button.
         await expect(page.locator("nav.bar").getByRole("link", { name: "Pages", exact: true })).toBeVisible();
         await page.getByRole("button", { name: "Menu" }).click();
         const drawer = page.locator("dialog#drawer");
         for (const name of sections) await expect(drawer.getByRole("link", { name, exact: true })).toBeVisible();
         await expectNoAxeViolations(page);
         await shot(page, "admin-drawer");
         await drawer.getByRole("button", { name: "Close menu" }).click();
         await expect(drawer).toBeHidden();
      }
      await expectNoAxeViolations(page);
      await shot(page, "admin-overview-en");

      await page.goto("/?lang=ar");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.getByRole("heading", { level: 1, name: "نظرة عامة" })).toBeVisible();
      await expectNoAxeViolations(page);
      await shot(page, "admin-overview-ar");

      await page.goto("/?lang=en&mode=light");
      await expect(page.locator("html")).toHaveAttribute("data-mode", "light");
      await expect(page.locator("html")).not.toHaveClass(/dark/);
      await expectNoAxeViolations(page);
      await page.goto("/?mode=dark");
      await expect(page.locator("html")).toHaveClass(/dark/);
      await page.goto("/?mode=system");

      for (const theme of ["nahas", "zujaj", "lantern", "fawanees"]) {
         await page.goto(`/?theme=${theme}`);
         await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      }
      await page.goto("/?theme=site");
      await expect(page.locator(".preview-bar")).toHaveCount(0);
   });

   test("an editor (moderator) has no People screen and no delete controls", async ({ context, page }) => {
      await sessionPage(context, page, ACCOUNTS.moderator);
      await expect(page.getByRole("link", { name: "People" })).toHaveCount(0);
      const res = await page.goto("/people");
      expect(res?.status()).toBe(403);
   });

   test("old bknd admin URLs and /picker land on the new screens", async ({ context, page }) => {
      await sessionPage(context, page, ACCOUNTS.admin);
      await page.goto("/data/entity/posts");
      await expect(page).toHaveURL(`${CMS_URL}/posts`);
      await page.goto("/picker");
      await expect(page).toHaveURL(`${CMS_URL}/videos`);
      await page.goto("/bknd");
      await expect(page).toHaveURL(`${CMS_URL}/`);
   });
});

test.describe("pages and posts (E1–E16)", () => {
   test("create a page, slug rules, publish, SEO, cover and description, translation, unpublish, delete", async ({ context, page }) => {
      await sessionPage(context, page, ACCOUNTS.admin, "/pages/new?locale=en");
      await page.getByLabel("Title", { exact: true }).fill(`Reserved ${STAMP}`);
      await page.getByLabel("Address", { exact: true }).fill("home");
      await page.getByRole("button", { name: "Save draft" }).first().click();
      await expect(page.locator("#f-slug-err")).toContainText("reserved");
      await page.getByLabel("Address", { exact: true }).fill("Bad Slug");
      await page.getByRole("button", { name: "Save draft" }).first().click();
      await expect(page.locator("#f-slug-err")).toContainText("lowercase");

      await page.getByLabel("Title", { exact: true }).fill(`About ${STAMP}`);
      await page.getByLabel("Address", { exact: true }).fill(`about-${STAMP}`);
      await page.getByLabel("Summary", { exact: true }).fill("Who we are");
      // Pages are built from blocks (e2e/blocks.spec.ts covers every block type).
      await page.getByRole("button", { name: /^Text Headings/ }).click();
      await page.locator("[data-blocks-editor] textarea[data-k=text]").fill("## Hello\n\nThis is **bold**.");
      await page.getByRole("button", { name: "Preview", exact: true }).click();
      await expect(page.locator("[data-blocks-preview-body] strong")).toHaveText("bold");
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.getByLabel("Search title", { exact: true }).fill(`SEO ${STAMP}`);
      await expect(page.locator("[data-serp-title]")).toHaveText(`SEO ${STAMP}`);
      await page.getByRole("button", { name: "Publish" }).first().click();
      await expect(page).toHaveURL(/\/pages\/\d+$/);
      const id = idFromUrl(page);
      created.push({ entity: "pages", id });
      await expect(page.locator("[data-status-badge]")).toHaveText("Published");
      await expectNoAxeViolations(page);
      await shot(page, "admin-page-editor");

      const pub = await publicApi(`/pages/about-${STAMP}?locale=en`);
      expect(pub.status).toBe(200);
      expect(pub.body.title).toBe(`About ${STAMP}`);
      expect(pub.body.seo_title).toBe(`SEO ${STAMP}`);

      // Duplicate address in the same language.
      await page.goto("/pages/new?locale=en");
      await page.getByLabel("Title", { exact: true }).fill(`Dup ${STAMP}`);
      await page.getByLabel("Address", { exact: true }).fill(`about-${STAMP}`);
      await page.getByRole("button", { name: "Save draft" }).first().click();
      await expect(page.locator("#f-slug-err")).toContainText("already uses");

      // Cover: upload, replace, description (public API returns it).
      await page.goto(`/pages/${id}`);
      for (const name of ["cover.png", "cover2.png"]) {
         const reloaded = page.waitForURL(/done=saved/, { timeout: 30_000 });
         await page.locator("[data-cover-input]").setInputFiles({ name, mimeType: "image/png", buffer: PNG });
         await reloaded;
         await page.waitForLoadState("load");
         await expect(page.locator("img.cover-img")).toBeVisible();
      }
      await page.getByLabel("Description for screen readers").fill("A lantern");
      const saved = page.waitForURL(/done=saved/, { timeout: 30_000 });
      await page.getByRole("button", { name: "Save description" }).click();
      await saved;
      await page.waitForLoadState("load");
      await expect(page.getByLabel("Description for screen readers")).toHaveValue("A lantern");
      const withCover = await publicApi(`/pages/about-${STAMP}?locale=en`);
      expect((withCover.body.cover as { alt: string }).alt).toBe("A lantern");
      const coverRes = await fetch((withCover.body.cover as { url: string }).url);
      expect(coverRes.status).toBe(200);

      // Translation: an Arabic draft linked to this page; its fields are RTL in the English UI.
      await page.getByRole("button", { name: /Create the Arabic version/ }).click();
      await expect(page).toHaveURL(/\/pages\/\d+$/);
      const arId = idFromUrl(page);
      created.push({ entity: "pages", id: arId });
      await expect(page.locator("form[data-editor]")).toHaveAttribute("data-locale", "ar");
      await page.getByLabel("Title", { exact: true }).fill("من نحن");
      await page.getByRole("button", { name: "Publish" }).first().click();
      await expect(page.locator("[data-status-badge]")).toHaveText("Published");
      const alts = await publicApi(`/pages/about-${STAMP}?locale=en`);
      expect(alts.body.alternates).toEqual([{ locale: "ar", slug: `about-${STAMP}` }]);
      await page.goto(`/pages/${arId}?lang=ar`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expectNoAxeViolations(page);
      await shot(page, "admin-page-editor-ar");

      // Unpublish: leaves the public API.
      await page.goto(`/pages/${id}?lang=en`);
      await page.getByRole("button", { name: "Unpublish" }).first().click();
      const unpublish = page.getByRole("dialog", { name: "Unpublish this?" });
      await expect(unpublish.getByRole("button", { name: "Cancel" })).toBeFocused();
      await unpublish.getByRole("button", { name: "Unpublish" }).click();
      await expect(page.locator("[data-status-badge]")).toHaveText("Draft");
      expect((await publicApi(`/pages/about-${STAMP}?locale=en`)).status).toBe(404);

      // Delete (admin).
      await page.getByRole("button", { name: "Delete" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
      await expect(page).toHaveURL(`${CMS_URL}/pages`);
      expect((await adminApi("GET", `/api/data/entity/pages/${id}`)).json?.data ?? null).toBeNull();
   });

   test("posts: tags, author, list search / filters / sort, and an editor cannot delete", async ({ context, page }) => {
      await sessionPage(context, page, ACCOUNTS.moderator, "/posts/new?locale=en");
      await page.getByLabel("Title", { exact: true }).fill(`Post ${STAMP}`);
      await expect(page.getByLabel("Address", { exact: true })).toHaveValue(`post-${STAMP}`);
      await page.getByLabel("Excerpt", { exact: true }).fill("Short");
      await page.getByLabel("Author", { exact: true }).fill("Editorial");
      await page.getByLabel("Tags", { exact: true }).fill("news");
      await page.keyboard.press("Enter");
      await page.getByLabel("Tags", { exact: true }).fill("events,");
      await expect(page.locator("[data-tag]")).toHaveCount(2);
      await page.getByRole("button", { name: "Publish" }).first().click();
      await expect(page).toHaveURL(/\/posts\/\d+$/);
      created.push({ entity: "posts", id: idFromUrl(page) });
      await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
      const pub = await publicApi(`/posts/post-${STAMP}?locale=en`);
      expect(pub.body.tags).toEqual(["news", "events"]);
      expect(pub.body.author_name).toBe("Editorial");

      await page.goto(`/posts?q=${STAMP}`);
      await expect(page.getByRole("link", { name: `Post ${STAMP}` })).toBeVisible();
      await page.goto(`/posts?q=${STAMP}&status=draft`);
      await expect(page.getByRole("link", { name: `Post ${STAMP}` })).toHaveCount(0);
      await page.goto(`/posts?q=${STAMP}&locale=en&sort=title`);
      await expect(page.getByRole("link", { name: `Post ${STAMP}` })).toBeVisible();
      await expectNoAxeViolations(page);
      await shot(page, "admin-posts-list");
   });

   test("address from the title: Arabic transliterated live, manual override, regenerate, -2 when taken, live address locked", async ({ context, page }) => {
      const title = `إن الدين عند الله الإسلام ${STAMP}`;
      const auto = `inna-al-din-inda-allah-al-islam-${STAMP}`;
      const address = page.getByLabel("Address", { exact: true });
      await sessionPage(context, page, ACCOUNTS.moderator, "/posts/new?locale=ar");
      await expect(address).toHaveValue("");
      await page.getByLabel("Title", { exact: true }).fill(title);
      await expect(address).toHaveValue(auto);
      // Typed by hand: the title no longer drives it, until "Regenerate from title".
      await address.fill(`mine-${STAMP}`);
      await page.getByLabel("Title", { exact: true }).fill(`${title} x`);
      await expect(address).toHaveValue(`mine-${STAMP}`);
      await page.getByLabel("Title", { exact: true }).fill(title);
      await page.getByRole("button", { name: "Regenerate from title" }).click();
      await expect(address).toHaveValue(auto);
      await page.getByRole("button", { name: "Save draft" }).first().click();
      await expect(page).toHaveURL(/\/posts\/\d+/);
      const first = idFromUrl(page);
      created.push({ entity: "posts", id: first });
      expect(((await adminApi("GET", `/api/data/entity/posts/${first}`)).json?.data as { slug: string }).slug).toBe(auto);

      // Same title again: the generated address moves to -2 instead of failing.
      await page.goto("/posts/new?locale=ar");
      await page.getByLabel("Title", { exact: true }).fill(title);
      await expect(address).toHaveValue(auto);
      await page.getByRole("button", { name: "Save draft" }).first().click();
      await expect(page).toHaveURL(/\/posts\/\d+/);
      const second = idFromUrl(page);
      created.push({ entity: "posts", id: second });
      expect(((await adminApi("GET", `/api/data/entity/posts/${second}`)).json?.data as { slug: string }).slug).toBe(`${auto}-2`);

      // Once live, the address is locked; changing it goes through the in-app warning.
      expect((await adminApi("PATCH", `/api/data/entity/posts/${first}`, { status: "published" })).status).toBe(200);
      await page.goto(`/posts/${first}`);
      await expect(address).toHaveAttribute("readonly", "");
      await page.getByRole("button", { name: "Change address" }).click();
      const warn = page.getByRole("dialog", { name: "Change a live address?" });
      await expect(warn).toBeVisible();
      await warn.getByRole("button", { name: "Cancel" }).click();
      await expect(address).toHaveAttribute("readonly", "");
      await page.getByRole("button", { name: "Change address" }).click();
      await warn.getByRole("button", { name: "Change address" }).click();
      await expect(address).not.toHaveAttribute("readonly", "");
      await expectNoAxeViolations(page);
   });

   test("insert video: the picker inside the body editor writes ::video[ID] on its own line (X1)", async ({ context, page }) => {
      await sessionPage(context, page, ACCOUNTS.admin, "/posts/new?locale=en");
      await page.locator("#f-body").fill("Intro");
      await page.getByRole("button", { name: "Insert video" }).click();
      const dialog = page.getByRole("dialog", { name: "Choose a video" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Search the videos platform").fill("qa");
      await dialog.getByLabel("Search the videos platform").press("Enter");
      await expect(dialog.locator("[data-picker-status]")).not.toHaveText(/Searching/, { timeout: 20_000 });
      const choose = dialog.getByRole("button", { name: /^Choose:/ }).first();
      test.skip((await choose.count()) === 0, "no public videos on QA match the query");
      await expectNoAxeViolations(page);
      await shot(page, "admin-picker-dialog");
      await choose.click();
      await expect(dialog).toBeHidden();
      await expect(page.locator("#f-body")).toHaveValue(/^Intro\n\n::video\[[A-Za-z0-9_-]+\]\n\n$/);
   });
});

test.describe("scheduled publishing (#7)", () => {
   /** A datetime-local value `hours` from now in the browser's own time zone, and its ISO instant. */
   const localIn = (page: Page, hours: number) =>
      page.evaluate((h) => {
         const d = new Date(Date.now() + h * 3600_000);
         d.setSeconds(0, 0);
         const p = (n: number) => String(n).padStart(2, "0");
         return { value: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`, iso: d.toISOString() };
      }, hours);
   const savedAs = (page: Page, done: string) => page.waitForURL(new RegExp(`done=${done}`), { timeout: 30_000 });

   test("an editor schedules a post: hidden until then, change the time, unschedule, schedule again, publish now (en/ar, axe)", async ({ context, page }) => {
      await sessionPage(context, page, ACCOUNTS.moderator, "/posts/new?locale=en");
      await page.getByLabel("Title", { exact: true }).fill(`Sched ${STAMP}`);
      await page.locator("#f-body").fill("Coming soon.");
      await page.getByText("Publish later").click();
      const when = page.getByLabel("Go live at");
      await expect(when).toBeVisible();
      await expect(page.locator("[data-tz]")).not.toHaveText("");

      // A time in the past is refused in the form, nothing is saved.
      await when.fill((await localIn(page, -2)).value);
      await page.getByRole("button", { name: "Schedule", exact: true }).click();
      await expect(page.locator("#f-publish-at-err")).toHaveText("Pick a time in the future.");
      await expect(page).toHaveURL(/\/posts\/new/);

      const first = await localIn(page, 48);
      await when.fill(first.value);
      let saved = savedAs(page, "scheduled");
      await page.getByRole("button", { name: "Schedule", exact: true }).click();
      await saved;
      const id = idFromUrl(page);
      created.push({ entity: "posts", id });
      await expect(page.locator("[data-status-badge]")).toHaveText("Scheduled");
      const callout = page.locator("[data-schedule-callout]");
      await expect(callout).toContainText("Goes live");
      await expect(callout.locator("time")).toHaveAttribute("datetime", first.iso);
      await expect(page.getByRole("link", { name: "View on site", exact: true })).toHaveCount(0);
      expect((await adminApi("GET", `/api/data/entity/posts/${id}`)).json?.data).toMatchObject({ status: "published", publish_at: first.iso });
      expect((await publicApi(`/posts/sched-${STAMP}?locale=en`)).status).toBe(404);
      const list = await publicApi("/posts?locale=en&limit=20");
      expect((list.body.items as { slug: string }[]).map((x) => x.slug)).not.toContain(`sched-${STAMP}`);
      await expectNoAxeViolations(page);
      await shot(page, "admin-post-scheduled");

      // Lists and the overview show it as scheduled.
      await page.goto(`/posts?q=${STAMP}&status=scheduled`);
      await expect(page.getByRole("link", { name: `Sched ${STAMP}` })).toBeVisible();
      await page.goto(`/posts?q=${STAMP}&status=published`);
      await expect(page.getByRole("link", { name: `Sched ${STAMP}` })).toHaveCount(0);
      await page.goto("/");
      await expect(page.locator("[data-up-next]").getByRole("link", { name: `Sched ${STAMP}` })).toBeVisible();

      // Arabic UI: RTL, the callout and actions in Arabic.
      await page.goto(`/posts/${id}?lang=ar`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("[data-status-badge]")).toHaveText("مجدول");
      await expect(page.getByRole("button", { name: "إلغاء الجدولة" }).first()).toBeVisible();
      await expectNoAxeViolations(page);
      await shot(page, "admin-post-scheduled-ar");

      // Change the time: Save keeps it scheduled at the new time.
      await page.goto(`/posts/${id}?lang=en`);
      await page.getByText("Change the time").click();
      const second = await localIn(page, 72);
      await page.getByLabel("Go live at").fill(second.value);
      saved = savedAs(page, "scheduled");
      await page.getByRole("button", { name: "Save", exact: true }).first().click();
      await saved;
      await expect(page.locator("[data-schedule-callout] time")).toHaveAttribute("datetime", second.iso);

      // Unschedule: a draft again, still not public.
      saved = savedAs(page, "unscheduled");
      await page.getByRole("button", { name: "Unschedule" }).first().click();
      await page.getByRole("dialog", { name: "Unschedule this?" }).getByRole("button", { name: "Unschedule" }).click();
      await saved;
      await expect(page.locator("[data-status-badge]")).toHaveText("Draft");
      expect((await adminApi("GET", `/api/data/entity/posts/${id}`)).json?.data).toMatchObject({ status: "draft", publish_at: null, published_at: null });

      // Schedule again, then publish now: live at once.
      await page.getByText("Publish later").click();
      await page.getByLabel("Go live at").fill((await localIn(page, 24)).value);
      saved = savedAs(page, "scheduled");
      await page.getByRole("button", { name: "Schedule", exact: true }).click();
      await saved;
      saved = savedAs(page, "published");
      await page.getByRole("button", { name: "Publish now" }).click();
      await saved;
      await expect(page.locator("[data-status-badge]")).toHaveText("Published");
      const live = await publicApi(`/posts/sched-${STAMP}?locale=en`);
      expect(live.status).toBe(200);
      expect(Date.parse(String(live.body.published_at))).toBeLessThanOrEqual(Date.now() + 60_000);
   });
});

test.describe("content history (#8)", () => {
   test("an editor sees each version, the diff of what changed, and restores an old one through the lock (en/ar, axe)", async ({ context, page }) => {
      // A post: new pages are built from blocks, a post article still has the body textarea.
      await sessionPage(context, page, ACCOUNTS.moderator, "/posts/new?locale=en");
      await page.getByLabel("Title", { exact: true }).fill(`History ${STAMP}`);
      await page.locator("#f-body").fill("First line\nSecond line");
      await page.getByRole("button", { name: "Publish" }).first().click();
      await expect(page).toHaveURL(/\/posts\/\d+$/);
      const id = idFromUrl(page);
      created.push({ entity: "posts", id });
      await page.locator("#f-body").fill("First line\nA changed line");
      await page.getByLabel("Title", { exact: true }).fill(`History ${STAMP} edited`);
      await page.getByRole("button", { name: "Save", exact: true }).first().click();
      await page.waitForURL(/done=published/, { timeout: 30_000 }).catch(() => undefined);
      await page.waitForLoadState("load");
      const card = page.locator("[data-history-card]");
      await expect(card).toContainText("See all 2 versions");

      // Followed by its address: on phones the sticky action bar sits over the card's end.
      await page.goto((await card.getByRole("link", { name: "See all 2 versions" }).getAttribute("href"))!);
      await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
      await expect(page.getByRole("heading", { level: 2, name: "Version 2" })).toBeVisible();
      await expect(page.locator(".diff del")).toHaveText("Second line");
      await expect(page.locator(".diff ins")).toHaveText("A changed line");
      await expect(page.getByText("This is the current version.")).toBeVisible();
      await expectNoAxeViolations(page);
      await shot(page, "admin-history");

      // Restore version 1 (confirm dialog); the site serves its text again, status unchanged.
      await page.locator(".rev").filter({ hasText: "Created" }).click();
      await expect(page.getByRole("heading", { level: 2, name: "Version 1" })).toBeVisible();
      await page.getByRole("button", { name: "Restore this version" }).click();
      const dlg = page.getByRole("dialog", { name: "Restore this version?" });
      await expect(dlg).toBeVisible();
      const restored = page.waitForURL(/done=restored/, { timeout: 30_000 });
      await dlg.getByRole("button", { name: "Restore this version" }).click();
      await restored;
      await page.waitForLoadState("load");
      await expect(page.getByLabel("Title", { exact: true })).toHaveValue(`History ${STAMP}`);
      await expect(page.locator("[data-status-badge]")).toHaveText("Published");
      const pub = await publicApi(`/posts/history-${STAMP}?locale=en`);
      expect(pub.status).toBe(200);
      expect(pub.body.body).toBe("First line\nSecond line");

      await page.goto(`/posts/${id}/history?lang=ar`);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.getByRole("heading", { level: 2, name: "النسخة 3" })).toBeVisible();
      await expect(page.getByText("مستعادة من النسخة 1")).toBeVisible();
      await expectNoAxeViolations(page);
      await shot(page, "admin-history-ar");
      await page.goto(`/posts/${id}/history?lang=en&mode=dark`);
      await expect(page.locator("html")).toHaveClass(/dark/);
      await expectNoAxeViolations(page);
      await shot(page, "admin-history-dark");
      await page.goto(`/posts/${id}/history?mode=system`);

      // Someone saves meanwhile: restoring from the stale screen is refused with a clear message.
      await page.goto(`/posts/${id}/history?lang=en`);
      await page.locator(".rev").filter({ hasText: "Edited" }).first().click();
      const row = (await adminApi("GET", `/api/data/entity/posts/${id}`)).json?.data as { updated_at: string };
      expect((await adminApi("PATCH", `/api/data/entity/posts/${id}`, { excerpt: "Changed elsewhere", updated_at: row.updated_at })).status).toBe(200);
      await page.getByRole("button", { name: "Restore this version" }).click();
      await page.getByRole("dialog", { name: "Restore this version?" }).getByRole("button", { name: "Restore this version" }).click();
      await expect(page.locator(".toast.bad")).toContainText("Someone else changed this");
      expect(((await adminApi("GET", `/api/data/entity/posts/${id}`)).json?.data as { title: string }).title).toBe(`History ${STAMP}`);
   });
});

test.describe("navigation (E17–E22, A8)", () => {
   test("add with the URL rule, hide, reorder with the buttons, delete", async ({ context, page }) => {
      await sessionPage(context, page, ACCOUNTS.admin, "/navigation?menu=footer&locale=en");
      await page.getByLabel("Label", { exact: true }).last().fill(`A ${STAMP}`);
      await page.getByLabel("Link", { exact: true }).last().fill("javascript:alert(1)");
      await page.getByRole("button", { name: "Add link" }).click();
      await expect(page.locator("[data-add-err]")).toBeVisible();
      await page.getByLabel("Link", { exact: true }).last().fill("/about");
      await page.getByRole("button", { name: "Add link" }).click();
      await expect(page.locator(`input[value="A ${STAMP}"]`)).toBeVisible();
      await page.getByLabel("Label", { exact: true }).last().fill(`B ${STAMP}`);
      await page.getByLabel("Link", { exact: true }).last().fill("https://example.org/b");
      await page.getByRole("button", { name: "Add link" }).click();
      const rowB = page.locator("li[data-id]", { has: page.locator(`input[value="B ${STAMP}"]`) });
      await expect(rowB).toBeVisible();
      await rowB.getByRole("button", { name: `Move up: B ${STAMP}` }).click();
      await expect(page.getByText("Order saved").first()).toBeVisible();
      await rowB.getByRole("checkbox").uncheck();
      await expect(rowB.locator(".vis-label")).toHaveText("Draft");
      const site = await publicApi("/site?locale=en");
      const footer = (site.body.nav as { footer: { label: string }[] }).footer.map((x) => x.label);
      expect(footer).toContain(`A ${STAMP}`);
      expect(footer).not.toContain(`B ${STAMP}`);
      await page.reload();
      const labels = await page.locator("li[data-id] input[data-field=label]").evaluateAll((els) => els.map((e) => (e as unknown as { value: string }).value));
      expect(labels.indexOf(`B ${STAMP}`)).toBeLessThan(labels.indexOf(`A ${STAMP}`));
      await expectNoAxeViolations(page);
      await shot(page, "admin-navigation");
      await rowB.getByRole("button", { name: `Delete: B ${STAMP}` }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
      await expect(rowB).toHaveCount(0);
   });
});

test.describe("videos (E23–E30, X1)", () => {
   test("add through the picker dialog, set language and title, show it, change the video, remove", async ({ context, page }) => {
      await sessionPage(context, page, ACCOUNTS.admin, "/videos?placement=videos");
      await expectNoAxeViolations(page);
      await page.getByRole("button", { name: "Add a video" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Choose a video" });
      await dialog.getByLabel("Search the videos platform").fill("qa");
      await dialog.getByLabel("Search the videos platform").press("Enter");
      await expect(dialog.locator("[data-picker-status]")).not.toHaveText(/Searching/, { timeout: 20_000 });
      // Only results not already on this shelf: adding is idempotent per video/placement/locale (CMS-4).
      const onShelf = new Set(await page.locator("li[data-ref]").evaluateAll((els) => els.map((e) => e.getAttribute("data-ref"))));
      const fresh = (await dialog.locator("li[data-pick-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-pick-id")))).filter((id) => id && !onShelf.has(id)) as string[];
      test.skip(fresh.length < 2, "fewer than two public QA videos that aren't already on the shelf match the query");
      await dialog.locator(`li[data-pick-id="${fresh[0]}"]`).getByRole("button", { name: /^Choose:/ }).click();
      const row = page.locator(`li[data-ref="${fresh[0]}"]`);
      await expect(row).toHaveCount(1, { timeout: 20_000 });
      const rowId = Number(await row.getAttribute("data-id"));
      created.push({ entity: "curated_videos", id: rowId });
      await row.getByLabel("Show for", { exact: true }).selectOption("ar");
      await expect(page.getByText("Saved").first()).toBeVisible();
      await row.getByLabel("Title on the site", { exact: true }).fill(`T ${STAMP}`);
      await row.getByLabel("Title on the site", { exact: true }).blur();
      await row.getByRole("checkbox").check();
      await expect(row.locator(".vis-label")).toHaveText("Published");
      // Each field saves on its own request: wait for both to land.
      await expect
         .poll(async () => ((await publicApi("/videos?locale=ar&placement=videos")).body.items as { title_override: string | null }[]).map((x) => x.title_override), { timeout: 20_000 })
         .toContain(`T ${STAMP}`);
      await shot(page, "admin-videos");

      await row.getByRole("button", { name: "Change video" }).click();
      await dialog.getByLabel("Search the videos platform").fill("qa");
      await dialog.getByLabel("Search the videos platform").press("Enter");
      const other = dialog.locator(`li[data-pick-id="${fresh[1]}"]`);
      await expect(other).toBeVisible({ timeout: 20_000 });
      await other.getByRole("button", { name: /^Choose:/ }).click();
      await expect(page.locator(`li[data-id="${rowId}"]`)).toHaveAttribute("data-ref", fresh[1], { timeout: 20_000 });

      await page.locator(`li[data-id="${rowId}"]`).getByRole("button", { name: /^Delete:/ }).click();
      // Soft delete (docs/SOFT_DELETE.md): the confirm dialog is "Delete this?" and the row moves to Recently deleted.
      await page.getByRole("dialog", { name: ADMIN_STRINGS.en.common.confirmDelete }).getByRole("button", { name: ADMIN_STRINGS.en.common.delete }).click();
      await expect(page.locator(`li[data-id="${rowId}"]`)).toHaveCount(0);
   });
});

test.describe("site settings (E31–E34)", () => {
   test("edit and restore the tagline and social links; bad social URLs are refused", async ({ context, page }) => {
      await sessionPage(context, page, ACCOUNTS.admin, "/site?locale=en");
      if ((await page.locator("form[data-site]").getAttribute("data-site")) === "") {
         // No English settings yet: create them through the form (E31, create path) and remove them afterwards.
         await page.getByLabel("Site name").fill("Al Ummah Now");
         await saveSite(page);
         await expect(page.locator("form[data-site]")).not.toHaveAttribute("data-site", "");
         created.push({ entity: "site_settings", id: Number(await page.locator("form[data-site]").getAttribute("data-site")) });
      }
      const tagline = page.getByLabel("Tagline", { exact: true });
      const original = await tagline.inputValue();
      await page.getByRole("button", { name: "Add a social link" }).click();
      await page.locator("[data-social] input").last().fill("http://insecure.example");
      await page.getByRole("button", { name: "Save" }).click();
      await expect(page.locator("[data-social-err]")).toBeVisible();
      await page.locator("[data-social]").last().getByRole("button", { name: "Remove" }).click();
      await tagline.fill(`Tag ${STAMP}`);
      await saveSite(page);
      expect(((await publicApi("/site?locale=en")).body.settings as { tagline: string }).tagline).toBe(`Tag ${STAMP}`);
      await expectNoAxeViolations(page);
      await shot(page, "admin-site");
      await page.getByLabel("Tagline", { exact: true }).fill(original);
      await saveSite(page);
      expect(((await publicApi("/site?locale=en")).body.settings as { tagline: string | null }).tagline ?? "").toBe(original);
   });
});

test.describe("library and people (E35, E36, A11–A14)", () => {
   test("upload an image, describe it, refuse SVG, delete it (admin); People lists CMS users", async ({ context, page }) => {
      await sessionPage(context, page, ACCOUNTS.admin, "/library");
      const before = await page.locator("[data-media]").count();
      await page.locator("[data-library-upload]").setInputFiles({ name: `${STAMP}.png`, mimeType: "image/png", buffer: PNG });
      await expect(page.locator("[data-media]")).toHaveCount(before + 1, { timeout: 30_000 });
      const card = page.locator("[data-media]").first();
      await card.getByLabel("Description for screen readers").fill(`Alt ${STAMP}`);
      await card.getByRole("button", { name: /^Save description/ }).click();
      await expect(page.getByText("Saved").first()).toBeVisible();
      await page.locator("[data-library-upload]").setInputFiles({ name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg/>") });
      await expect(page.locator("[data-library-err]")).toBeVisible();
      await expectNoAxeViolations(page);
      await shot(page, "admin-library");
      await card.getByRole("button", { name: "Delete" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
      await expect(page.locator("[data-media]")).toHaveCount(before);

      await page.goto("/people");
      await expect(page.getByRole("main").getByText(ACCOUNTS.admin.email)).toBeVisible();
      await expectNoAxeViolations(page);
   });

   test("an editor sees the library without delete controls", async ({ context, page }) => {
      await sessionPage(context, page, ACCOUNTS.moderator, "/library");
      await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
   });
});
