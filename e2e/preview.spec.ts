/**
 * Draft preview on www (src/routes/preview.ts, AlUmmahNowUI src/pages/preview/): an editor opens
 * "Preview on site" from a draft and www renders that draft, uncached and noindex, with the banner.
 * The www half needs www's /preview route; until that is deployed to this env the www assertions
 * are skipped (the CMS ships first).
 */
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { expectNoAxeViolations, sessionPage, shot } from "./support/browser.ts";
import { ACCOUNTS, CMS_URL, hasCredentials, WWW_URL } from "./support/env.ts";
import { sessionCookie } from "./support/sessions.ts";

test.describe.configure({ mode: "serial" });
test.skip(!hasCredentials, "QA_SEED_PASSWORD is not set");

const STAMP = `e2e${Date.now().toString(36)}`;
const created: { entity: string; id: number }[] = [];

let adminCookie = "";
async function adminApi(method: string, path: string, body?: unknown) {
   if (!adminCookie) adminCookie = await sessionCookie(ACCOUNTS.admin);
   const res = await fetch(`${CMS_URL}${path}`, {
      method,
      headers: { cookie: adminCookie, origin: CMS_URL, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
   });
   return { status: res.status, json: (await res.json().catch(() => null)) as { data?: { id: number } } | null };
}

async function draft(entity: "pages" | "posts", locale: "en" | "ar", title: string, body: string): Promise<number> {
   const res = await adminApi("POST", `/api/data/entity/${entity}`, { slug: `preview-${STAMP}-${locale}`, locale, title, body, status: "draft" });
   expect(res.status).toBe(201);
   const id = res.json!.data!.id;
   created.push({ entity, id });
   return id;
}

/** www has the preview route when an invalid link gets its friendly page (not the site's 404). */
async function wwwHasPreview(): Promise<boolean> {
   if (!WWW_URL) return false;
   const res = await fetch(`${WWW_URL}/preview?token=v1.e2e.probe`, { redirect: "manual" });
   return res.status !== 404;
}

async function openPreview(context: BrowserContext, page: Page): Promise<Page> {
   const popup = context.waitForEvent("page");
   await page.getByRole("link", { name: /Preview on site|معاينة على الموقع/ }).click();
   const www = await popup;
   await www.waitForLoadState("load");
   return www;
}

test.afterAll(async () => {
   for (const { entity, id } of created.reverse()) await adminApi("DELETE", `/api/data/entity/${entity}/${id}`).catch(() => undefined);
});

test("the public API never serves the draft; the preview API needs a token for that row", async () => {
   const id = await draft("pages", "en", `Draft ${STAMP}`, "Draft body");
   const pub = await fetch(`${CMS_URL}/api/public/v1/pages/preview-${STAMP}-en?locale=en&_=${Date.now()}`);
   expect(pub.status).toBe(404);
   const none = await fetch(`${CMS_URL}/api/preview/v1/pages/${id}`);
   expect(none.status).toBe(401);
   expect(none.headers.get("cache-control")).toBe("private, no-store");
   const forged = await fetch(`${CMS_URL}/api/preview/v1/pages/${id}`, { headers: { Authorization: "Bearer v1.e30.AAAA" } });
   expect(forged.status).toBe(401);
});

test("signed out, the preview link asks for sign-in first", async ({ request }) => {
   const res = await request.get(`/preview/pages/1`, { maxRedirects: 0 });
   expect(res.status()).toBe(302);
   expect(res.headers().location).toBe("/sso/login?return=%2Fpreview%2Fpages%2F1");
});

test("an editor previews an English draft page on www", async ({ context, page: first }) => {
   let page = first;
   const id = await draft("pages", "en", `Preview page ${STAMP}`, `## Draft heading ${STAMP}\n\nOnly in the draft.`);
   await sessionPage(context, page, ACCOUNTS.moderator, `/pages/${id}`);
   const link = page.getByRole("link", { name: "Preview on site" });
   await expect(link).toHaveAttribute("href", `/preview/pages/${id}`);
   await expect(link).toHaveAttribute("target", "_blank");
   await expectNoAxeViolations(page);

   // Unsaved edits: the editor is asked to save first instead of previewing a stale draft.
   await page.getByLabel("Title", { exact: true }).fill(`Preview page ${STAMP} (edited)`);
   const pages = context.pages().length;
   await link.click();
   await expect(page.locator(".toast")).toContainText("Save the draft first");
   expect(context.pages().length).toBe(pages);
   // Leave without the unsaved-changes prompt, then open the editor again.
   await page.close();
   page = await context.newPage();
   await page.goto(`/pages/${id}`);

   test.skip(!(await wwwHasPreview()), "www on this env has no /preview route yet (it ships after the CMS)");
   const www = await openPreview(context, page);
   await expect(www).toHaveURL(new RegExp(`^${WWW_URL}/preview/pages/${id}/?$`));
   expect(www.url()).not.toContain("token");
   await expect(www.getByText("Preview — not published")).toBeVisible();
   await expect(www.getByRole("heading", { level: 1 })).toHaveText(`Preview page ${STAMP}`);
   await expect(www.getByRole("heading", { level: 2, name: `Draft heading ${STAMP}` })).toBeVisible();
   await expect(www.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
   const again = await www.reload();
   expect(again?.headers()["cache-control"]).toContain("no-store");
   expect(again?.headers()["x-robots-tag"]).toContain("noindex");
   await expectNoAxeViolations(www);
   await shot(www, "preview-www-en");
});

test("an Arabic draft post previews right-to-left", async ({ context, page }) => {
   test.skip(!(await wwwHasPreview()), "www on this env has no /preview route yet (it ships after the CMS)");
   const id = await draft("posts", "ar", `معاينة ${STAMP}`, "نص المسودة.");
   await sessionPage(context, page, ACCOUNTS.moderator, `/posts/${id}?lang=ar`);
   const www = await openPreview(context, page);
   await expect(www).toHaveURL(new RegExp(`/preview/posts/${id}/?$`));
   await expect(www.locator("html")).toHaveAttribute("dir", "rtl");
   await expect(www.locator("html")).toHaveAttribute("lang", "ar");
   await expect(www.getByText("معاينة — غير منشور")).toBeVisible();
   await expect(www.getByRole("heading", { level: 1 })).toHaveText(`معاينة ${STAMP}`);
   await expectNoAxeViolations(www);
   await shot(www, "preview-www-ar");
});

test("a broken preview link is a friendly page on www", async ({ page }) => {
   test.skip(!(await wwwHasPreview()), "www on this env has no /preview route yet (it ships after the CMS)");
   await page.goto(`${WWW_URL}/preview?token=v1.e2e.broken`);
   await expect(page.getByRole("heading", { level: 1 })).toHaveText("This preview link doesn't work");
   await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
   await expectNoAxeViolations(page);
});
