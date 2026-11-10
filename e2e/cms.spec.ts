/**
 * CMS E2E (SPEC §8) against a deployed environment (QA in CI, stage in the release).
 * Screenshots go to e2e-artifacts/ (desktop + mobile, en + ar).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { ACCOUNTS, AUTH_URL, CMS_CLIENT_ID, CMS_URL, hasCredentials, WWW_URL, type Account } from "./support/env.ts";
import { beginSignIn, signIn } from "./support/oauth.ts";

mkdirSync("e2e-artifacts", { recursive: true });
const cmsHost = new URL(CMS_URL).host;
const authHost = new URL(AUTH_URL).host;

/** True when auth's CORS lets the CMS page read the accounts API (QA allow-list widening is rolled out separately). */
async function authAllowsCmsOrigin(): Promise<boolean> {
   const res = await fetch(`${AUTH_URL}/session/accounts`, {
      method: "OPTIONS",
      headers: { origin: new URL(CMS_URL).origin, "access-control-request-method": "GET" },
   }).catch(() => null);
   return res?.headers.get("access-control-allow-origin") === new URL(CMS_URL).origin;
}

async function shot(page: Page, name: string) {
   await page.screenshot({ path: `e2e-artifacts/${name}-${test.info().project.name}.png`, fullPage: true });
}

async function expectNoAxeViolations(page: Page) {
   const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
   expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** Signs `account` in headlessly up to the callback, then lets the browser finish it. */
async function browserSignIn(context: BrowserContext, page: Page, account: Account, returnPath = "/") {
   const pending = await beginSignIn(account, returnPath);
   await context.addCookies(
      pending.jar.forHost(cmsHost).map((c) => ({ ...c, url: CMS_URL, secure: CMS_URL.startsWith("https:"), httpOnly: true, sameSite: "Lax" as const })),
   );
   return page.goto(pending.callbackUrl);
}

/** Like browserSignIn, but the browser also gets auth's session cookie (as after a real sign-in). */
async function browserSignInWithAuthSession(context: BrowserContext, page: Page, account: Account, returnPath = "/") {
   const pending = await beginSignIn(account, returnPath);
   const secure = AUTH_URL.startsWith("https:");
   await context.addCookies([
      ...pending.jar.forHost(cmsHost).map((c) => ({ ...c, url: CMS_URL, secure: CMS_URL.startsWith("https:"), httpOnly: true, sameSite: "Lax" as const })),
      ...pending.jar.forHost(authHost).map((c) => ({ ...c, url: AUTH_URL, secure, httpOnly: true, sameSite: "Lax" as const })),
   ]);
   return page.goto(pending.callbackUrl);
}

test.describe("unauthenticated", () => {
   test("/ redirects to auth /authorize with client_id, the exact redirect_uri and PKCE", async ({ request }) => {
      const first = await request.get("/", { maxRedirects: 0 });
      expect(first.status()).toBe(302);
      expect(first.headers()["location"]).toMatch(/^\/sso\/login\?return=/);
      const login = await request.get(first.headers()["location"], { maxRedirects: 0 });
      expect(login.status()).toBe(302);
      const authorize = new URL(login.headers()["location"]);
      expect(`${authorize.origin}${authorize.pathname}`).toBe(`${AUTH_URL}/authorize`);
      expect(authorize.searchParams.get("client_id")).toBe(CMS_CLIENT_ID);
      expect(authorize.searchParams.get("redirect_uri")).toBe(`${CMS_URL}/sso/callback`);
      expect(authorize.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
   });

   test("the normal sign-in sends no prompt; ?prompt=login and ?prompt=none are forwarded, nothing else", async ({ request }) => {
      const promptOf = async (query: string) => {
         const res = await request.get(`/sso/login${query}`, { maxRedirects: 0 });
         expect(res.status()).toBe(302);
         return new URL(res.headers()["location"]).searchParams.get("prompt");
      };
      expect(await promptOf("?return=%2F")).toBeNull();
      expect(await promptOf("?prompt=login")).toBe("login");
      expect(await promptOf("?prompt=none")).toBe("none");
      expect(await promptOf("?prompt=select_account")).toBeNull();
   });

   test("prompt=none without a browser session: auth answers login_required and the CMS falls back to the normal sign-in", async ({ request }) => {
      const login = await request.get("/sso/login?prompt=none&return=%2Fpicker", { maxRedirects: 0 });
      const authorize = await request.get(login.headers()["location"], { maxRedirects: 0 });
      expect(authorize.status()).toBe(302);
      const back = new URL(authorize.headers()["location"]);
      expect(`${back.origin}${back.pathname}`).toBe(`${CMS_URL}/sso/callback`);
      expect(back.searchParams.get("error")).toBe("login_required");
      const callback = await request.get(back.toString(), { maxRedirects: 0 });
      expect(callback.status()).toBe(302);
      expect(callback.headers()["location"]).toBe("/sso/login?return=%2Fpicker");
      const plain = await request.get(callback.headers()["location"], { maxRedirects: 0 });
      expect(new URL(plain.headers()["location"]).searchParams.get("prompt")).toBeNull();
   });

   test("the public API answers without a session and the data API refuses guests", async ({ request }) => {
      const site = await request.get("/api/public/v1/site?locale=en");
      expect(site.status()).toBe(200);
      expect(site.headers()["cache-control"]).toContain("s-maxage=60");
      expect((await request.get("/api/data/entity/posts")).status()).toBe(403);
      expect((await request.post("/api/auth/password/login", { data: {} })).status()).toBe(404);
   });
});

test.describe("signed in", () => {
   test.skip(!hasCredentials, "QA_SEED_PASSWORD is not set");

   for (const locale of ["en", "ar"] as const) {
      test(`a non-admin (qa-viewer) gets the 403 page (${locale})`, async ({ browser }, info) => {
         const context = await browser.newContext({ ...info.project.use, locale, extraHTTPHeaders: { "Accept-Language": locale } });
         const page = await context.newPage();
         const res = await browserSignIn(context, page, ACCOUNTS.viewer);
         expect(res?.status()).toBe(403);
         expect(new URL(page.url()).pathname).toBe("/sso/no-access");
         await expect(page.locator("html")).toHaveAttribute("lang", locale);
         await expect(page.locator("html")).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
         await expect(page.getByRole("heading", { level: 1 })).toHaveText(locale === "ar" ? "لا تملك صلاحية الوصول" : "No access");
         await expect(page.getByRole("link", { name: locale === "ar" ? "إضافة حساب آخر" : "Add another account" })).toHaveAttribute(
            "href",
            "/sso/login?prompt=login&return=%2F",
         );
         // Without auth's cookie in this context the list cannot load; the page says so instead of hanging.
         await expect(page.locator("#accounts-status")).not.toHaveText(locale === "ar" ? "جارٍ تحميل الحسابات…" : "Loading accounts…");
         await expectNoAxeViolations(page);
         await shot(page, `403-${locale}`);
         // Nothing was created: the viewer has no session.
         expect((await context.cookies(CMS_URL)).some((c) => c.name === "auth")).toBe(false);
         await context.close();
      });
   }

   test("no access: the page lists the accounts signed in on this browser (from auth)", async ({ browser }, info) => {
      test.skip(info.project.name !== "desktop", "runs once");
      test.skip(!(await authAllowsCmsOrigin()), "auth CORS does not allow the CMS origin yet");
      const context = await browser.newContext({ ...info.project.use, locale: "en" });
      const page = await context.newPage();
      await browserSignInWithAuthSession(context, page, ACCOUNTS.viewer);
      expect(new URL(page.url()).pathname).toBe("/sso/no-access");
      const item = page.locator("#accounts-list li", { hasText: ACCOUNTS.viewer.email });
      await expect(item).toBeVisible();
      await expect(item).toContainText("Active");
      await expectNoAxeViolations(page);
      await shot(page, "no-access-accounts");
      await context.close();
   });

   test("an admin (qa-admin) reaches the staff screens (en/ar, axe)", async ({ context, page }) => {
      const res = await browserSignIn(context, page, ACCOUNTS.admin);
      expect(res?.status()).toBeLessThan(400);
      await expect(page).toHaveURL(`${CMS_URL}/`);
      await page.locator("summary.who").click();
      await expect(page.getByRole("menuitem", { name: "Switch account" })).toHaveAttribute("href", "/sso/accounts?return=%2F");
      await shot(page, "admin-home");
      for (const lang of ["en", "ar"] as const) {
         await page.goto(`/videos?lang=${lang}`);
         await expect(page.locator("html")).toHaveAttribute("dir", lang === "ar" ? "rtl" : "ltr");
         await expectNoAxeViolations(page);
         await shot(page, `videos-${lang}`);
      }
   });

   test("an admin publishes a post via the data API; it appears in the public API (and on www); drafts never do", async ({ request }) => {
      test.skip(test.info().project.name !== "desktop", "runs once");
      const session = await signIn(ACCOUNTS.admin);
      expect(session.status).toBe(302);
      const headers = { cookie: session.cookie, origin: CMS_URL, "content-type": "application/json" };
      const stamp = `${Date.now()}`;
      const title = `E2E post ${stamp}`;
      const created: number[] = [];
      try {
         const pub = await request.post("/api/data/entity/posts", {
            headers,
            data: { slug: `e2e-${stamp}`, locale: "en", title, excerpt: "E2E", body: "Created by the CMS E2E suite.", status: "published" },
         });
         expect(pub.status(), await pub.text()).toBe(201);
         created.push(((await pub.json()) as { data: { id: number } }).data.id);
         const draft = await request.post("/api/data/entity/posts", {
            headers,
            data: { slug: `e2e-draft-${stamp}`, locale: "en", title: `E2E draft ${stamp}`, status: "draft" },
         });
         expect(draft.status()).toBe(201);
         created.push(((await draft.json()) as { data: { id: number } }).data.id);

         const list = await request.get("/api/public/v1/posts?locale=en&limit=20");
         const text = await list.text();
         expect(text).toContain(title);
         expect(text).not.toContain(`E2E draft ${stamp}`);
         expect((await request.get(`/api/public/v1/posts/e2e-draft-${stamp}?locale=en`)).status()).toBe(404);
         const one = await request.get(`/api/public/v1/posts/e2e-${stamp}?locale=en`);
         expect(((await one.json()) as { title: string }).title).toBe(title);

         if (WWW_URL) {
            await expect
               .poll(async () => (await fetch(`${WWW_URL}/en/news/`, { headers: { "cache-control": "no-cache" } }).then((r) => r.text())).includes(title), {
                  timeout: 90_000,
                  intervals: [5_000],
               })
               .toBe(true);
         }
      } finally {
         for (const id of created) {
            const del = await request.delete(`/api/data/entity/posts/${id}`, { headers: { cookie: session.cookie, origin: CMS_URL } });
            if (del.status() !== 200) {
               // Never leave a published E2E post behind.
               await request.patch(`/api/data/entity/posts/${id}`, { headers, data: { status: "draft" } });
            }
         }
      }
   });

   test("a moderator (qa-moderator) is an editor: can sign in, cannot delete", async ({ request }) => {
      test.skip(test.info().project.name !== "desktop", "runs once");
      const session = await signIn(ACCOUNTS.moderator);
      expect(session.status).toBe(302);
      const res = await request.delete("/api/data/entity/posts/999999", { headers: { cookie: session.cookie, origin: CMS_URL } });
      expect(res.status()).toBe(403);
   });
});
