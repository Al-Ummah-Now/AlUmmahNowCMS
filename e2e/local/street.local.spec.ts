/**
 * The Fawanees lantern street in the staff screens (the shared module, vendored by
 * scripts/sync-fanous.ts; design: AlUmmahNow docs/design/FAWANEES-STREET.md), against the local
 * `wrangler dev` CMS (playwright.local.config.ts). Through the ?theme= preview, light and dark,
 * English and Arabic: the street is on; no control or text block is see-through; every lantern on
 * screen is drawn whole (the screen with and without the street, compared by pixels); other themes
 * draw none; and with reduced motion the distant lights stand still.
 */
import { expect, test, type Page } from "@playwright/test";

// Browser globals used inside page.evaluate (the CMS typechecks e2e without the DOM lib)
/* eslint-disable @typescript-eslint/no-explicit-any */
declare const document: any, window: any, Image: any, getComputedStyle: any, innerHeight: number, innerWidth: number;

const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT ?? 8798}`;
const ON = `http://localhost:${process.env.CMS_ON_PORT ?? 8595}`;
const RUN = `st${Date.now().toString(36)}`;
// The pixel check decodes screenshots from data: URLs
test.use({ bypassCSP: true });
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

/** Waits until the module has stopped re-measuring (layout settles after images and fonts). */
async function stable(page: Page) {
  let last = '';
  for (let i = 0; i < 20; i++) {
    const now = await page.evaluate(() => `${document.getElementById('fanous-street')?.innerHTML.length}:${document.documentElement.scrollHeight}`);
    if (now === last) return;
    last = now;
    await page.waitForTimeout(350);
  }
}

/** Translucent controls and text blocks whose backdrop is the page (the street would show through). */
function seeThrough(page: Page) {
  return page.evaluate(() => {
    const alpha = (bg: string) => { const slash = bg.match(/\/\s*([\d.]+)\)/), rgba = bg.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/); return slash ? parseFloat(slash[1]!) : rgba ? parseFloat(rgba[1]!) : bg === 'transparent' ? 0 : 1; };
    const paints = (e: Element) => { const st = getComputedStyle(e); return alpha(st.backgroundColor) === 1 || st.backgroundImage !== 'none' || /^(IMG|VIDEO|CANVAS|PICTURE|IFRAME)$/.test(e.tagName); };
    return Array.from(document.querySelectorAll('main *')).filter((el: any) => {
      if (el.tagName === 'IMG') return false;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) return false;
      const a = alpha(getComputedStyle(el).backgroundColor);
      if (!(a > 0 && a < 1)) return false;
      const stack = document.elementsFromPoint(r.left + r.width / 2, Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)));
      const below = stack.slice(stack.indexOf(el) + 1).filter((e: any) => !el.contains(e) && e !== document.body && e !== document.documentElement);
      return !below.some(paints);
    }).map((el: any) => `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 3).join('.')}`);
  });
}

/** Lanterns on screen that are not drawn whole (something sits in front of them). */
async function cutLanterns(page: Page) {
  await stable(page);
  const boxes = await page.evaluate(() => {
    const chrome = Array.from(document.querySelectorAll('body *')).filter((e: any) => !e.closest('#fanous-street') && ['fixed', 'sticky'].includes(getComputedStyle(e).position))
      .map((e: any) => e.getBoundingClientRect()).filter((r: any) => r.width && r.height && r.bottom > 0 && r.top < innerHeight);
    const hit = (b: { x: number; y: number; w: number; h: number }) => chrome.some((r: any) => b.x < r.right && b.x + b.w > r.left && b.y < r.bottom && b.y + b.h > r.top);
    return Array.from(document.querySelectorAll('#fanous-street .fs-l use')).map((u: any) => { const r = u.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })
      .filter((b: any) => b.y >= 0 && b.y + b.h <= innerHeight && b.x >= 0 && b.x + b.w <= innerWidth && !hit(b));
  });
  if (!boxes.length) return [];
  const on = (await page.screenshot()).toString('base64');
  await page.evaluate(() => { document.getElementById('fanous-street')!.style.visibility = 'hidden'; });
  const off = (await page.screenshot()).toString('base64');
  await page.evaluate(() => { document.getElementById('fanous-street')!.style.visibility = ''; });
  return page.evaluate(async ({ on, off, boxes }) => {
    const load = (b: string) => new Promise<any>((res: any) => { const i = new Image(); i.onload = () => res(i); i.src = `data:image/png;base64,${b}`; });
    const [a, b] = await Promise.all([load(on), load(off)]);
    const px = (img: any) => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d')!; g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const A = px(a), B = px(b), W = a.width, k = a.width / innerWidth;
    const out: string[] = [];
    for (const bx of boxes) {
      const x0 = Math.round(bx.x * k), x1 = Math.round((bx.x + bx.w) * k), y0 = Math.round(bx.y * k), y1 = Math.round((bx.y + bx.h) * k);
      let rows = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; if (Math.abs(A[i]! - B[i]!) + Math.abs(A[i + 1]! - B[i + 1]!) + Math.abs(A[i + 2]! - B[i + 2]!) > 18) { rows++; break; } }
      }
      if (rows / (y1 - y0) < 0.85) out.push(`lantern at ${Math.round(bx.x)},${Math.round(bx.y)}: ${Math.round((100 * rows) / (y1 - y0))}% drawn`);
    }
    return out;
  }, { on, off, boxes });
}

for (const mode of ["light", "dark"] as const) {
   for (const lang of ["en", "ar"] as const) {
      test(`${mode} ${lang}: nothing see-through, every lantern whole`, async ({ page }, info) => {
         await signIn(page, `${RUN}${info.project.name.slice(0, 1)}-${mode}-${lang}`);
         await theme(page, "fawanees", mode);
         for (const path of [`/?lang=${lang}`, `/posts?lang=${lang}`]) {
            await page.goto(path);
            await expect(page.locator("html")).toHaveClass(/fanous-street/);
            await stable(page);
            const problems: string[] = [];
            for (const s of await seeThrough(page)) problems.push(`${path} see-through: ${s}`);
            for (const c of await cutLanterns(page)) problems.push(`${path} ${c}`);
            expect(problems, problems.join("\n")).toEqual([]);
         }
      });
   }
}

test("other themes draw no street", async ({ page }, info) => {
   await signIn(page, `${RUN}${info.project.name.slice(0, 1)}-other`);
   for (const id of ["lantern", "zujaj", "nahas"]) {
      await theme(page, id, "light");
      await expect(page.locator("html"), id).not.toHaveClass(/fanous-street/);
      await expect(page.locator("#fanous-street"), id).toHaveCount(0);
   }
   await theme(page, "fawanees", "light");
});

for (const motion of ["reduce", "no-preference"] as const) {
   test(`the distant lights ${motion === "reduce" ? "stand still with reduced motion" : "drift at 0.2x the scroll"}; no animations`, async ({ browser }, info) => {
      test.skip(info.project.name !== "desktop", "one viewport is enough");
      const context = await browser.newContext({ reducedMotion: motion, viewport: { width: 1280, height: 700 } });
      const page = await context.newPage();
      await signIn(page, `${RUN}-motion-${motion}`);
      await theme(page, "fawanees", "light");
      await page.goto(`${ON}/posts`);
      await expect(page.locator("#fanous-street-lights")).toHaveCount(1);
      const pos = () => page.evaluate(() => getComputedStyle(document.getElementById("fanous-street-lights")).backgroundPositionY);
      const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
      const y = Math.min(500, max);
      await page.evaluate((to: number) => window.scrollTo(0, to), y);
      await expect.poll(pos).toBe(motion === "reduce" || y === 0 ? "0px" : `${-Math.round(0.2 * y)}px`);
      const ours = await page.evaluate(() => document.getAnimations().filter((a: any) => { const t = a.effect?.target; return !!t && (t === document.documentElement || !!t.closest("#fanous-street, #fanous-street-lights")); }).length);
      expect(ours, "the street runs no animations").toBe(0);
      await context.close();
   });
}
