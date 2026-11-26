/**
 * The Fawanees lantern street in the staff screens (the shared module, vendored by
 * scripts/sync-fanous.ts; design: AlUmmahNow docs/design/FAWANEES-STREET.md), against the local
 * `wrangler dev` CMS (playwright.local.config.ts). The street is pre-made art painted by CSS: a wide
 * image tile of strings and lit lanterns, repeated behind the whole page (it wraps both ways, shown
 * at 2x) over the distant lights. The theme gives 4 tile variants per mode; the Worker picks one per
 * response and sends it as <html data-fanous-street-variant> (no inline script). Through the ?theme=
 * preview, light and dark, English and Arabic:
 *   - the street is on, shows the server's variant of this mode's tile, repeated, centred, at its own
 *     size, down the whole page, and no other variant is fetched; the tile files are served;
 *   - no control or text block is see-through;
 * the HTML names a variant, random per request and pinned by the aun_street_variant cookie; other
 * themes have no street and fetch no tile; the street adds no element and runs no animation.
 */
import { expect, test, type Page } from "@playwright/test";

// Browser globals used inside page.evaluate (the CMS typechecks e2e without the DOM lib)
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any, getComputedStyle: any, innerHeight: number, scrollTo: (x: number, y: number) => void, scrollY: number;

const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 8798}`;
const ON = `http://localhost:${process.env.CMS_ON_PORT ?? 8595}`;
const RUN = `st${Date.now().toString(36)}`;
const TILE = /street-tile(-dark)?-([1-4])\.webp/;
test.describe.configure({ mode: "serial" });

async function signIn(page: Page, suffix: string) {
   const as = { id: `e2e-admin-${suffix}`, email: `e2e-admin+${suffix}@example.test`, roles: ["Admin"] };
   await fetch(`${MOCK}/__as`, { method: "POST", body: JSON.stringify(as) });
   await page.goto(`${ON}/sso/login?return=%2F`);
   await expect(page).toHaveURL(`${ON}/`);
}

async function theme(page: Page, id: string, mode: "light" | "dark") {
   await page.context().addCookies([{ name: "cms_mode", value: mode, url: ON }]);
   await page.goto(`${ON}/?theme=${id}`);
}

/** Tile files the page fetches, by file name. */
function watchTiles(page: Page) {
   const fetched = new Set<string>();
   page.on("request", (r) => { const m = r.url().match(/street-tile[\w-]*\.webp/); if (m) fetched.add(m[0]); });
   return fetched;
}

/** Translucent controls and text blocks whose backdrop is the page (the street would show through). */
function seeThrough(page: Page) {
   return page.evaluate(() => {
      const alpha = (bg: string) => { const slash = bg.match(/\/\s*([\d.]+)\)/), rgba = bg.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/); return slash ? parseFloat(slash[1]!) : rgba ? parseFloat(rgba[1]!) : bg === "transparent" ? 0 : 1; };
      const paints = (e: any) => { const st = getComputedStyle(e); return alpha(st.backgroundColor) === 1 || st.backgroundImage !== "none" || /^(IMG|VIDEO|CANVAS|PICTURE|IFRAME)$/.test(e.tagName); };
      return Array.from(document.querySelectorAll("main *")).filter((el: any) => {
         if (el.tagName === "IMG") return false;
         const r = el.getBoundingClientRect();
         if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) return false;
         const a = alpha(getComputedStyle(el).backgroundColor);
         if (!(a > 0 && a < 1)) return false;
         const stack = document.elementsFromPoint(r.left + r.width / 2, Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
         const below = stack.slice(stack.indexOf(el) + 1).filter((e: any) => !el.contains(e) && e !== document.body && e !== document.documentElement);
         return !below.some(paints);
      }).map((el: any) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")}`);
   });
}

/** The street's two layers as the browser computes them. */
function layers(page: Page) {
   return page.evaluate(() => {
      const before = getComputedStyle(document.body, "::before"), after = getComputedStyle(document.body, "::after");
      return {
         variant: document.documentElement.getAttribute("data-fanous-street-variant"),
         lights: before.content !== "none" ? before.backgroundImage : "none",
         street: after.content !== "none" ? after.backgroundImage : "none",
         repeat: after.backgroundRepeat,
         at: after.backgroundPosition,
         size: after.backgroundSize,
         position: after.position,
         covers: Math.round(parseFloat(after.height)) >= document.documentElement.scrollHeight - 2,
      };
   });
}

for (const mode of ["light", "dark"] as const) {
   for (const lang of ["en", "ar"] as const) {
      test(`${mode} ${lang}: the server's tile variant behind the page, repeated not stretched; nothing see-through`, async ({ page }, info) => {
         await signIn(page, `${RUN}${info.project.name.slice(0, 1)}-${mode}-${lang}`);
         await theme(page, "fawanees", mode);
         for (const path of [`/?lang=${lang}`, `/posts?lang=${lang}`]) {
            const fetched = watchTiles(page);
            await page.goto(`${ON}${path}`);
            await page.waitForLoadState("networkidle").catch(() => {});
            await expect(page.locator("html")).toHaveClass(/fanous-street/);
            const l = await layers(page);
            expect(l.variant, `${path}: a variant from the server`).toMatch(/^[1-4]$/);
            expect(l.street, `${path}: street tile`).toMatch(TILE);
            expect(l.street.includes("-dark-"), `${path}: the ${mode} tile`).toBe(mode === "dark");
            expect(l.street, `${path}: the server's variant`).toContain(`-${l.variant}.webp`);
            expect(l.lights, `${path}: distant lights`).toMatch(/url\(/);
            expect(l.repeat, `${path}: repeated both ways`).toBe("repeat");
            expect(l.at, `${path}: centred`).toMatch(/^50% 0(%|px)?$/);
            expect(l.size, `${path}: at the tile's own size`).toBe("auto");
            expect(l.position, `${path}: scrolls with the page`).toBe("absolute");
            expect(l.covers, `${path}: down the whole page`).toBe(true);
            expect([...fetched], `${path}: only the picked variant downloads`).toEqual([l.street.match(/street-tile[\w-]*\.webp/)![0]]);
            for (const f of fetched) {
               const res = await page.request.get(`${ON}/fanous/street/${f}`);
               expect(res.status(), f).toBe(200);
               expect(res.headers()["content-type"], f).toContain("image/webp");
            }
            const problems: string[] = [];
            for (const y of [0, 700, 1400]) {
               const at = await page.evaluate((y) => { scrollTo(0, y); return Math.round(scrollY); }, y);
               if (y && at < y - 50) break;
               for (const s of await seeThrough(page)) problems.push(`${path} @${at} see-through: ${s}`);
            }
            expect(problems, problems.join("\n")).toEqual([]);
         }
      });
   }
}

test("the HTML names a variant: random per request, pinned by the aun_street_variant cookie, no inline picker", async ({ page }, info) => {
   test.skip(info.project.name !== "desktop", "one viewport is enough");
   await signIn(page, `${RUN}-variant`);
   const variantOf = async () => {
      const html = await (await page.request.get(`${ON}/`)).text();
      expect(html).not.toContain("__AUN_STREET_VARIANT__");
      return /<html[^>]*\sdata-fanous-street-variant="([^"]*)"/.exec(html)?.[1];
   };
   const seen = new Set<string | undefined>();
   for (let i = 0; i < 16 && seen.size < 2; i++) seen.add(await variantOf());
   expect([...seen].every((v) => v !== undefined && /^[1-4]$/.test(v)), [...seen].join(", ")).toBe(true);
   expect(seen.size, "requests get different variants").toBeGreaterThan(1);
   await page.context().addCookies([{ name: "aun_street_variant", value: "2", url: ON }]);
   for (let i = 0; i < 3; i++) expect(await variantOf()).toBe("2");
   const fetched = watchTiles(page);
   await theme(page, "fawanees", "dark");
   await page.waitForLoadState("networkidle").catch(() => {});
   expect([...fetched]).toEqual(["street-tile-dark-2.webp"]);
   await page.context().clearCookies({ name: "aun_street_variant" });
});

test("other themes have no street and fetch no tile; the street adds no element and runs no animation", async ({ page }, info) => {
   await signIn(page, `${RUN}${info.project.name.slice(0, 1)}-other`);
   for (const id of ["lantern", "zujaj", "nahas"]) {
      const fetched = watchTiles(page);
      await theme(page, id, "light");
      await page.waitForLoadState("networkidle").catch(() => {});
      await expect(page.locator("html"), id).not.toHaveClass(/fanous-street/);
      expect((await layers(page)).street, id).toBe("none");
      expect([...fetched], id).toEqual([]);
   }
   await theme(page, "fawanees", "light");
   await expect(page.locator("html")).toHaveClass(/fanous-street/);
   await expect(page.locator("#fanous-street, #fanous-street-lights")).toHaveCount(0);
   const ours = await page.evaluate(() => document.getAnimations().filter((a: any) => { const t = a.effect?.target; return t === document.documentElement || t === document.body; }).length);
   expect(ours, "the street runs no animations").toBe(0);
});
