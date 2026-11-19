/**
 * Arabic shows Eastern Arabic (Hindi) numerals ٠–٩ in every formatted value, the same on the server
 * and in every browser (owner decision 2026-11-15, AlUmmahNow #1488 / #1496). Runs in Chromium and
 * WebKit (playwright.local.config.ts project "webkit"): plain `ar` would give 0–9 on the server and
 * ٠–٩ in WebKit, so the client script's rewrites (local times, counters) would disagree with the
 * server's text. Fails on any page error. Number fields accept ٠–٩ and keep 0–9.
 *
 * DIGITS_SHOTS=<dir> also saves owner-review screenshots there.
 */
import { expect, test, type Page } from "@playwright/test";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";
import { toAsciiDigits } from "../../src/lib/format.ts";

// Browser globals used inside page.evaluate (the CMS typechecks e2e without the DOM lib)
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any, getComputedStyle: any;

const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 8798}`;
const ON = `http://localhost:${process.env.CMS_ON_PORT ?? 8595}`;
const RUN = `dg${Date.now().toString(36)}`;
const SHOTS = process.env.DIGITS_SHOTS;
const ASCII = /[0-9]/;

test.describe.configure({ mode: "serial" });

function watchErrors(page: Page): string[] {
   const errors: string[] = [];
   page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
   page.on("console", (m) => {
      if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
   });
   return errors;
}

async function signIn(page: Page, suffix: string) {
   const as = { id: `e2e-admin-${suffix}`, email: `e2e-admin+${suffix}@example.test`, roles: ["Admin"], name: "Digits Tester" };
   await fetch(`${MOCK}/__as`, { method: "POST", body: JSON.stringify(as) });
   await page.goto(`${ON}/sso/login?return=%2F`);
   await expect(page).toHaveURL(`${ON}/`);
}

/** Text of the formatted values on the page: times (after the client rewrote them), stats, counters, status lines. */
const formatted = (page: Page) =>
   page.evaluate(() =>
      [...document.querySelectorAll("time, .stat-n, [data-counter], [role=status], .badge")]
         .map((n: any) => (n.textContent || "").trim())
         .filter((t: string) => t && !/^[A-Z]{2}$/.test(t)),
   ) as Promise<string[]>;

async function shot(page: Page, name: string) {
   if (!SHOTS) return;
   await page.screenshot({ path: `${SHOTS}/cms-${name}.png`, fullPage: false });
}

test("Arabic admin: Eastern Arabic (Hindi) numerals everywhere, no page errors", async ({ page }, info) => {
   const errors = watchErrors(page);
   const p = info.project.name;
   await signIn(page, `${RUN}${p}`);
   const ids: number[] = [];
   for (let i = 0; i < 3; i++) {
      // The first one is scheduled, so the list shows a local time the client script rewrites.
      const when = i === 0 ? { status: "published", publish_at: new Date(Date.now() + 3 * 86_400_000).toISOString() } : { status: "draft" };
      const res = await page.request.post(`${ON}/api/data/entity/posts`, {
         data: { ...when, locale: "ar", kind: "article", slug: `${RUN}-${p}-${i}`, title: `منشور للتجربة ${"أبج"[i]}`, body: "نص" },
         headers: { origin: ON },
      });
      expect(res.status(), await res.text()).toBe(201);
      ids.push(((await res.json()) as { data: { id: number } }).data.id);
   }

   await page.goto(`${ON}/?lang=ar&mode=dark`);
   await expect(page.locator("html")).toHaveAttribute("lang", "ar");
   const stats = await page.locator(".stat-n").allTextContents();
   expect(stats.length).toBeGreaterThan(0);
   for (const s of stats) expect(s.trim()).toMatch(/^[٠-٩٬]+$/);
   await shot(page, `overview-ar-dark-${p}`);

   // Phone: the bottom tab bar is one row, every label whole and the same size; the header never cuts
   // the brand's wordmark (it is either whole or out of the bar).
   const layout = await page.evaluate(() => {
      const links = [...document.querySelectorAll("nav.bar a")].filter((a: any) => a.offsetParent);
      const name = document.querySelector(".hd .aun-brand-name");
      const nameShown = name && name.getBoundingClientRect().width > 1;
      return {
         rows: new Set(links.map((a: any) => Math.round(a.getBoundingClientRect().top))).size,
         clipped: links.filter((a: any) => a.scrollWidth > a.clientWidth + 1).map((a: any) => a.textContent.trim()),
         sizes: new Set(links.map((a: any) => getComputedStyle(a).fontSize)).size,
         brandCut: nameShown ? name.scrollWidth > name.clientWidth + 1 : false,
      };
   });
   if (info.project.name === "mobile") {
      expect(layout.rows).toBe(1);
      expect(layout.clipped).toEqual([]);
      expect(layout.sizes).toBe(1);
   }
   expect(layout.brandCut).toBe(false);

   await page.goto(`${ON}/posts?lang=ar`);
   await expect(page.locator("time[data-local]").first()).toBeVisible();
   const values = await formatted(page);
   expect(values.length).toBeGreaterThan(0);
   expect(values.filter((v) => ASCII.test(v))).toEqual([]);
   expect(values.join(" ")).toMatch(/[٠-٩]/);
   // The result count takes the Arabic plural form («٣ نتائج», not «٣ نتيجة»).
   const status = (await page.locator("main [role=status]").first().textContent())!.trim();
   const n = Number(toAsciiDigits(status.match(/[٠-٩٬]+/)?.[0]?.replace(/٬/g, "") ?? "NaN"));
   expect(status).toBe(ADMIN_STRINGS.ar.common.results(n));
   await shot(page, `posts-list-ar-dark-${p}`);

   // The editor's character counters are written by the client script.
   await page.goto(`${ON}/posts/${ids[1]}?lang=ar`);
   await expect(page.locator("[data-counter]").first()).toHaveText(/[٠-٩]/);
   const counters = await page.locator("[data-counter]").allTextContents();
   expect(counters.filter((v) => ASCII.test(v))).toEqual([]);

   // The AI settings budget: typed in Eastern Arabic (Hindi) numerals, kept as 0–9.
   await page.goto(`${ON}/ai-settings?lang=ar`);
   const budget = page.locator("#ai-budget");
   await budget.fill("");
   await budget.pressSequentially("١٢٫٥");
   await expect(budget).toHaveValue("12.5");

   expect(errors).toEqual([]);
});

test("owner screenshots: light Arabic and dark English posts list", async ({ page }, info) => {
   test.skip(!SHOTS, "only when DIGITS_SHOTS is set");
   const p = info.project.name;
   await signIn(page, `${RUN}${p}s`);
   await page.goto(`${ON}/posts?lang=ar&mode=light`);
   await expect(page.locator("time[data-local]").first()).toBeVisible();
   await shot(page, `posts-list-ar-light-${p}`);
   await page.goto(`${ON}/posts?lang=en&mode=dark`);
   await expect(page.locator("time[data-local]").first()).toBeVisible();
   await shot(page, `posts-list-en-dark-${p}`);
   await page.goto(`${ON}/?lang=ar&mode=dark`);
});
