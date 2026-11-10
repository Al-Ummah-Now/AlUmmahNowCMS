/**
 * Home timeline E2E (docs/FEED.md) against a deployed CMS: the Timeline screen in en/ar,
 * light/dark, desktop/phone with axe; pin, reorder by keyboard and buttons, hide, remove and add
 * back; add a video through the picker and edit its date; the post editor's switch. With WWW_URL
 * set, a CMS edit must reach www's home page (KV build + propagation): polled, never a fixed sleep.
 * Everything created carries a stamp and is removed in afterAll.
 */
import { expect, test, type Page } from "@playwright/test";
import { expectNoAxeViolations, sessionPage, shot } from "./support/browser.ts";
import { ACCOUNTS, CMS_URL, hasCredentials, WWW_URL } from "./support/env.ts";
import { sessionCookie } from "./support/sessions.ts";

test.describe.configure({ mode: "serial" });
test.use({ reducedMotion: "reduce" });
test.skip(!hasCredentials, "QA_SEED_PASSWORD is not set");

const STAMP = `e2e${Date.now().toString(36)}`;
const posts: number[] = [];
const videoKeys: string[] = [];

let cookie = "";
async function api(method: string, path: string, body?: unknown) {
   if (!cookie) cookie = await sessionCookie(ACCOUNTS.admin);
   const res = await fetch(`${CMS_URL}${path}`, {
      method,
      headers: { cookie, origin: CMS_URL, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
   });
   return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null };
}
const timeline = async (locale = "en") =>
   (await (await fetch(`${CMS_URL}/api/public/v1/timeline?locale=${locale}&limit=40&_=${Date.now()}`)).json()) as { pinned: { key: string }[]; items: { key: string; post?: { title: string } }[] };

async function newPost(title: string, slug: string): Promise<number> {
   const res = await api("POST", "/api/data/entity/posts", { slug, locale: "en", title, status: "published", tags: [], excerpt: `Excerpt ${STAMP}` });
   expect(res.status, JSON.stringify(res.json)).toBe(201);
   const id = (res.json!.data as { id: number }).id;
   posts.push(id);
   return id;
}

test.beforeAll(async () => {
   const where = encodeURIComponent(JSON.stringify({ slug: { $like: "tl-e2e*" } }));
   const old = await api("GET", `/api/data/entity/posts?where=${where}&select=id&limit=100`);
   for (const r of (old.json?.data as { id: number }[] | undefined) ?? []) await api("DELETE", `/api/data/entity/posts/${r.id}`);
});

test.afterAll(async () => {
   for (const key of videoKeys) await api("DELETE", `/admin/api/timeline/entries/${key}`).catch(() => undefined);
   for (const id of posts) {
      await api("PATCH", `/admin/api/timeline/entries/p${id}`, { pinned: false }).catch(() => undefined);
      await api("DELETE", `/api/data/entity/posts/${id}`).catch(() => undefined);
   }
});

const row = (page: Page, key: string) => page.locator(`li[data-key="${key}"]`);

test.describe("home timeline", () => {
   let a = 0;
   let b = 0;

   test("a published post joins the timeline; pin, reorder, hide, remove and add back", async ({ context, page }) => {
      a = await newPost(`Alpha ${STAMP}`, `tl-${STAMP}-a`);
      b = await newPost(`Beta ${STAMP}`, `tl-${STAMP}-b`);
      await expect.poll(async () => (await timeline()).items.map((x) => x.key), { timeout: 20_000 }).toEqual(expect.arrayContaining([`p${a}`, `p${b}`]));

      await sessionPage(context, page, ACCOUNTS.admin, "/timeline?locale=en");
      await expect(page.getByRole("heading", { level: 1, name: "Home timeline" })).toBeVisible();
      await expectNoAxeViolations(page);
      for (const id of [a, b]) {
         await row(page, `p${id}`).getByRole("button", { name: /^Pin to top:/ }).click();
         await expect(page.locator(`[data-pins] li[data-key="p${id}"]`)).toHaveCount(1, { timeout: 20_000 });
      }
      const pinnedKeys = () => page.locator("[data-pins] > li[data-key]").evaluateAll((els) => els.map((e) => e.getAttribute("data-key")));
      const before = await pinnedKeys();
      expect(before.slice(-2)).toEqual([`p${a}`, `p${b}`]);
      // Keyboard: Alt+↑ on Beta's Move up button moves it above Alpha; focus stays on the button.
      const up = row(page, `p${b}`).getByRole("button", { name: /^Move up:/ });
      await up.focus();
      await page.keyboard.press("Alt+ArrowUp");
      await expect(page.locator("[data-tl-live]")).toHaveText(/^Moved to \d+ of \d+\.$/);
      await expect(up).toBeFocused();
      expect((await pinnedKeys()).slice(-2)).toEqual([`p${b}`, `p${a}`]);
      await expect.poll(async () => (await timeline()).pinned.map((x) => x.key).slice(-2), { timeout: 20_000 }).toEqual([`p${b}`, `p${a}`]);
      // Buttons: Move down puts it back.
      await row(page, `p${b}`).getByRole("button", { name: /^Move down:/ }).click();
      await expect.poll(async () => (await timeline()).pinned.map((x) => x.key).slice(-2), { timeout: 20_000 }).toEqual([`p${a}`, `p${b}`]);
      await shot(page, "timeline-pinned");

      // Hide Alpha: listed for staff, gone from the public timeline.
      await page.reload();
      await row(page, `p${a}`).getByRole("button", { name: /^Hide:/ }).click();
      await expect(row(page, `p${a}`).locator("[data-hidden-badge]")).toBeVisible();
      await expect.poll(async () => (await timeline()).pinned.map((x) => x.key), { timeout: 20_000 }).not.toContain(`p${a}`);
      await row(page, `p${a}`).getByRole("button", { name: /^Show:/ }).click();
      await expect(row(page, `p${a}`).locator("[data-hidden-badge]")).toHaveCount(0);
      for (const id of [a, b]) {
         await row(page, `p${id}`).getByRole("button", { name: /^Unpin:/ }).click();
         await expect(page.locator(`[data-pins] li[data-key="p${id}"]`)).toHaveCount(0, { timeout: 20_000 });
      }

      // Remove Beta (its "Show on home timeline" goes off), then add it back from the chooser.
      await row(page, `p${b}`).getByRole("button", { name: /^Remove from timeline:/ }).click();
      const confirm = page.getByRole("dialog", { name: "Remove from timeline" });
      await expect(confirm).toContainText("stays published on News");
      await confirm.getByRole("button", { name: "Remove from timeline" }).click();
      await expect(row(page, `p${b}`)).toHaveCount(0);
      await expect.poll(async () => (await timeline()).items.map((x) => x.key), { timeout: 20_000 }).not.toContain(`p${b}`);
      await page.getByRole("button", { name: "Add a post" }).click();
      const dlg = page.getByRole("dialog", { name: "Posts not on the timeline" });
      await dlg.getByLabel("Search by title").fill(`Beta ${STAMP}`);
      await dlg.getByRole("button", { name: `Add: Beta ${STAMP}` }).click();
      await expect(row(page, `p${b}`)).toHaveCount(1, { timeout: 20_000 });
      await expect(page.locator(".tl-changes")).toContainText(ACCOUNTS.admin.email);
   });

   test("the post editor's switch takes a post off the timeline", async ({ context, page }) => {
      await sessionPage(context, page, ACCOUNTS.admin, `/posts/${a}`);
      const sw = page.getByRole("checkbox", { name: "Show on home timeline" });
      await expect(sw).toBeChecked();
      await sw.uncheck();
      await page.locator('button[data-action="published"]').first().click();
      await page.waitForURL(/done=/);
      await expect.poll(async () => (await timeline()).items.map((x) => x.key), { timeout: 30_000 }).not.toContain(`p${a}`);
      await sessionPage(context, page, ACCOUNTS.admin, `/posts/${a}`);
      await expect(page.getByRole("checkbox", { name: "Show on home timeline" })).not.toBeChecked();
   });

   test("add a video through the picker and move it by its date", async ({ context, page }) => {
      await sessionPage(context, page, ACCOUNTS.admin, "/timeline?locale=en");
      await page.getByRole("button", { name: "Add a video" }).click();
      const dialog = page.getByRole("dialog", { name: "Choose a video" });
      await dialog.getByLabel("Search the videos platform").fill("qa");
      await dialog.getByLabel("Search the videos platform").press("Enter");
      await expect(dialog.locator("[data-picker-status]")).not.toHaveText(/Searching/, { timeout: 20_000 });
      const ids = (await dialog.locator("li[data-pick-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-pick-id")))).filter(Boolean) as string[];
      test.skip(ids.length === 0, "no public QA video matches the query");
      const res = page.waitForResponse((r) => r.url().endsWith("/admin/api/timeline/videos"));
      await dialog.locator(`li[data-pick-id="${ids[0]}"]`).getByRole("button", { name: /^Choose:/ }).click();
      const body = (await (await res).json()) as { data: { key: string; existing: boolean } };
      if (!body.data.existing) videoKeys.push(body.data.key);
      const r = row(page, body.data.key);
      await expect(r).toHaveCount(1, { timeout: 20_000 });
      await r.getByLabel("Timeline date").fill("2001-02-03");
      await r.getByLabel("Timeline date").blur();
      await expect.poll(async () => (await api("GET", "/admin/api/timeline/status")).json?.data, { timeout: 30_000 }).toMatchObject({ pending: 0 });
      await page.goto(`/timeline?locale=en`);
      await expect(row(page, body.data.key).getByLabel("Timeline date")).toHaveValue("2001-02-03");
   });

   for (const [lang, mode] of [
      ["en", "light"],
      ["en", "dark"],
      ["ar", "light"],
      ["ar", "dark"],
   ] as const) {
      test(`screen in ${lang}, ${mode}: axe clean, RTL in Arabic`, async ({ context, page }) => {
         await sessionPage(context, page, ACCOUNTS.admin, `/timeline?locale=${lang}&lang=${lang}&mode=${mode}`);
         await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
         await expect(page.locator("[data-timeline]")).toBeVisible();
         await expectNoAxeViolations(page);
         await shot(page, `timeline-${lang}-${mode}`);
      });
   }

   test("an edit in the CMS reaches www's home page", async () => {
      test.skip(!WWW_URL, "WWW_URL is not set");
      const title = `Gamma ${STAMP}`;
      const id = await newPost(title, `tl-${STAMP}-c`);
      // KV build (queued, coalesced) + propagation (~60 s). A query string www doesn't key on
      // bypasses its HTML edge cache, so this reads KV.
      const home = async () => (await (await fetch(`${WWW_URL}/en/?e2e=${Date.now()}`)).text()).includes(title);
      await expect.poll(home, { timeout: 240_000, intervals: [5_000, 10_000] }).toBe(true);
      const renamed = `${title} edited`;
      expect((await api("PATCH", `/api/data/entity/posts/${id}`, { title: renamed })).status).toBe(200);
      await expect.poll(async () => (await (await fetch(`${WWW_URL}/en/?e2e=${Date.now()}`)).text()).includes(renamed), { timeout: 240_000, intervals: [5_000, 10_000] }).toBe(true);
   });
});
