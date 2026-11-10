/**
 * AI writing assist on a deployed CMS (docs/AI_ASSIST_SPEC.md §9). Every env declares the Workers AI
 * binding, so both roles normally get the controls; an env without the binding shows admins the "not
 * set up" notice and moderators nothing. The editor flows themselves run against mocks in e2e/local.
 * One provider-layer smoke test makes two tiny real Workers AI calls per run (Test connection and one
 * SEO job; under $0.001): the default provider still answers through the pluggable layer.
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

test("AI assist settings: admin-only screen and API; Workers AI is the default and answers through the provider layer", async ({ context, page }) => {
   const T = ADMIN_STRINGS.en.aiSettings;
   const mod = await sessionCookie(ACCOUNTS.moderator);
   expect((await fetch(`${CMS_URL}/admin/api/ai/settings`, { headers: { cookie: mod, accept: "application/json" } })).status).toBe(403);
   const admin = await sessionCookie(ACCOUNTS.admin);
   const res = await fetch(`${CMS_URL}/admin/api/ai/settings`, { headers: { cookie: admin, accept: "application/json" } });
   expect(res.status).toBe(200);
   const s = (await res.json()) as { settings: { providers: { id: string; kind: string; enabled: boolean; models: string[] }[]; features: Record<string, { provider: string; model: string }> } };
   const wai = s.settings.providers.find((p) => p.id === "workers-ai")!;
   expect(wai).toMatchObject({ kind: "workers-ai" });

   await sessionPage(context, page, ACCOUNTS.admin, "/ai-settings?lang=en");
   await expect(page.getByRole("heading", { level: 1, name: T.title })).toBeVisible();
   await expectNoAxeViolations(page);
   test.skip(!(await configured()) || !wai.enabled, "Workers AI is switched off in this env");

   // Test connection: one tiny real call to Workers AI through the provider contract
   const card = page.locator('[data-provider][data-kind="workers-ai"]');
   await card.getByRole("combobox", { name: T.testModel }).fill(wai.models[0]);
   await card.getByRole("button", { name: T.test }).click();
   await expect(card.locator("[data-test-result]")).toContainText(T.testOk("\u0000", "").split("\u0000")[0].trim(), { timeout: 60_000 });

   // One SEO job end to end (queue → router → Workers AI → validated result), when SEO runs on Workers AI here
   test.skip(s.settings.features.seo.provider !== "workers-ai", "SEO is routed to another provider in this env");
   const title = `Provider layer smoke ${Date.now()}`;
   const created = await fetch(`${CMS_URL}/admin/api/ai/jobs`, {
      method: "POST",
      headers: { cookie: admin, origin: CMS_URL, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ feature: "seo", kind: "posts", locale: "en", ui: "en", fields: { title, summary: "", body: "A short note on the timetable for the last ten nights of Ramadan." } }),
   });
   expect([200, 202]).toContain(created.status);
   const { job } = (await created.json()) as { job: { id: string } };
   let last: { status: string; result: { seo_title?: string } | null; error: string | null } = { status: "queued", result: null, error: null };
   await expect
      .poll(
         async () => {
            const r = await fetch(`${CMS_URL}/admin/api/ai/jobs/${job.id}`, { headers: { cookie: admin, accept: "application/json" } });
            last = ((await r.json()) as { job: typeof last }).job;
            return last.status;
         },
         { timeout: 90_000, intervals: [1500, 3000] },
      )
      .toMatch(/done|failed/);
   expect(last.error).toBeNull();
   expect(last.status).toBe("done");
   expect(last.result?.seo_title?.length ?? 0).toBeGreaterThan(0);
   test.info().annotations.push({ type: "qa-proof", description: `job ${job.id} done on workers-ai: ${JSON.stringify(last.result)}` });
});
