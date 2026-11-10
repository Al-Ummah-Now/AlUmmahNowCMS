/**
 * AI writing assist on a deployed CMS (docs/AI_ASSIST_SPEC.md §9). Every env declares the Workers AI
 * binding, so both roles normally get the controls; an env without the binding shows admins the "not
 * set up" notice and moderators nothing. The editor flows themselves run against mocks in e2e/local
 * (no model calls from CI).
 */
import { expect, test } from "@playwright/test";
import { ADMIN_STRINGS } from "../src/admin/i18n.ts";
import { expectNoAxeViolations, sessionPage } from "./support/browser.ts";
import { ACCOUNTS, CMS_URL, hasCredentials } from "./support/env.ts";
import { sessionCookie } from "./support/sessions.ts";

test.skip(!hasCredentials, "QA_SEED_PASSWORD is not set");

async function configured(): Promise<boolean> {
   const res = await fetch(`${CMS_URL}/admin/api/ai/status`, { headers: { cookie: await sessionCookie(ACCOUNTS.moderator), accept: "application/json" } });
   expect(res.status).toBe(200);
   return ((await res.json()) as { configured: boolean }).configured;
}

for (const lang of ["en", "ar"] as const) {
   const A = ADMIN_STRINGS[lang].ai;
   test(`AI assist in the editor: admin and moderator (${lang})`, async ({ context, page }) => {
      const on = await configured();
      await sessionPage(context, page, ACCOUNTS.admin, `/posts/new?lang=${lang}`);
      const card = page.getByRole("region", { name: A.card });
      await expect(card).toBeVisible();
      if (on) {
         await expect(page.getByRole("button", { name: A.check })).toBeVisible();
      } else {
         await expect(card.getByText(A.notSetUp)).toBeVisible();
         await expect(page.getByRole("button", { name: A.check })).toHaveCount(0);
         await expect(page.getByRole("button", { name: A.suggestSeo })).toHaveCount(0);
      }
      await expectNoAxeViolations(page);

      await context.clearCookies();
      await sessionPage(context, page, ACCOUNTS.moderator, `/posts/new?lang=${lang}`);
      await expect(page.getByRole("heading", { name: ADMIN_STRINGS[lang].content.publishing })).toBeVisible();
      if (on) {
         await expect(page.getByRole("region", { name: A.card })).toBeVisible();
      } else {
         await expect(page.getByRole("region", { name: A.card })).toHaveCount(0);
         await expect(page.getByText(A.notSetUp)).toHaveCount(0);
         await expect(page.getByRole("button", { name: A.check })).toHaveCount(0);
      }
   });
}

test("AI endpoints refuse anonymous and cross-origin callers", async () => {
   expect((await fetch(`${CMS_URL}/admin/api/ai/status`, { redirect: "manual" })).status).toBe(401);
   const cookie = await sessionCookie(ACCOUNTS.moderator);
   const cross = await fetch(`${CMS_URL}/admin/api/ai/jobs`, {
      method: "POST",
      headers: { cookie, origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ feature: "seo", kind: "posts", locale: "en", fields: { title: "x", summary: "", body: "x" } }),
   });
   expect(cross.status).toBe(403);
});
