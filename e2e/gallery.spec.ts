/**
 * QA screenshot gallery (E2E_GALLERY=1): every staff screen in all four themes, light and dark,
 * English and Arabic, in the current project (browser × device). Files:
 * e2e-artifacts/gallery/<project>/<screen>__<theme>__<mode>__<lang>.png
 * A sample page and post are created for the editor screens and removed afterwards.
 */
import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync } from "node:fs";
import { sessionPage } from "./support/browser.ts";
import { ACCOUNTS, CMS_URL, hasCredentials } from "./support/env.ts";
import { signIn } from "./support/oauth.ts";

test.skip(!process.env.E2E_GALLERY || !hasCredentials, "E2E_GALLERY=1 and credentials required");
test.describe.configure({ mode: "serial" });
test.setTimeout(30 * 60_000);

const THEMES = ["fawanees", "lantern", "zujaj", "nahas"] as const;
const MODES = ["light", "dark"] as const;
const LANGS = ["en", "ar"] as const;
const STAMP = `gallery${Date.now().toString(36)}`;
const made: { entity: string; id: number }[] = [];
let cookie = "";

async function api(method: string, path: string, body?: unknown) {
   if (!cookie) cookie = (await signIn(ACCOUNTS.admin)).cookie;
   const res = await fetch(`${CMS_URL}${path}`, {
      method,
      headers: { cookie, origin: CMS_URL, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
   });
   return (await res.json().catch(() => null)) as { data?: { id: number } } | null;
}

test.beforeAll(async () => {
   const page = await api("POST", "/api/data/entity/pages", {
      slug: `about-${STAMP}`,
      locale: "en",
      title: "About Al Ummah Now",
      summary: "Who we are and what we share.",
      body: "## Our mission\n\nIslamic video for everyone, in **Arabic** and English.\n\n::video[sample]\n",
      seo_title: "About us",
      status: "draft",
   });
   if (page?.data) made.push({ entity: "pages", id: page.data.id });
   const post = await api("POST", "/api/data/entity/posts", {
      slug: `ramadan-${STAMP}`,
      locale: "ar",
      title: "برنامج رمضان",
      excerpt: "دروس كل ليلة بعد التراويح",
      body: "## البرنامج\n\nمرحبًا بكم.",
      author_name: "فريق التحرير",
      tags: ["رمضان", "دروس"],
      status: "draft",
   });
   if (post?.data) made.push({ entity: "posts", id: post.data.id });
});

test.afterAll(async () => {
   for (const m of made) await api("DELETE", `/api/data/entity/${m.entity}/${m.id}`);
});

test("gallery", async ({ context, page }, info) => {
   const dir = `e2e-artifacts/gallery/${info.project.name}`;
   mkdirSync(dir, { recursive: true });
   const pageId = made.find((m) => m.entity === "pages")?.id;
   const postId = made.find((m) => m.entity === "posts")?.id;
   const screens: [string, string][] = [
      ["overview", "/"],
      ["pages", "/pages"],
      ["page-editor", `/pages/${pageId}`],
      ["posts", "/posts"],
      ["post-editor", `/posts/${postId}`],
      ["new-page", "/pages/new?locale=en"],
      ["navigation", "/navigation?menu=header&locale=en"],
      ["videos", "/videos?placement=home"],
      ["site", "/site?locale=en"],
      ["library", "/library"],
      ["people", "/people"],
   ];
   const violations: string[] = [];
   await sessionPage(context, page, ACCOUNTS.admin, "/");
   for (const theme of THEMES) {
      for (const mode of MODES) {
         for (const lang of LANGS) {
            for (const [name, path] of screens) {
               const url = `${path}${path.includes("?") ? "&" : "?"}theme=${theme}&mode=${mode}&lang=${lang}`;
               const res = await page.goto(url);
               expect(res?.status(), url).toBeLessThan(400);
               await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
               await page.waitForLoadState("networkidle").catch(() => undefined);
               await page.screenshot({ path: `${dir}/${name}__${theme}__${mode}__${lang}.png`, fullPage: true });
               // axe on every combination (contrast depends on theme and mode); collected, asserted at the end.
               const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
               for (const v of axe.violations) violations.push(`${name} ${theme} ${mode} ${lang} — ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
            }
         }
      }
   }
   // Dialogs: the picker inside the editor, and the phone drawer.
   await page.goto(`/posts/${postId}?theme=fawanees&mode=dark&lang=en`);
   await page.getByRole("button", { name: "Insert video" }).click();
   await page.screenshot({ path: `${dir}/picker-dialog__fawanees__dark__en.png` });
   await page.keyboard.press("Escape");
   await page.goto("/?theme=fawanees&mode=dark&lang=ar");
   const menu = page.getByRole("button", { name: "القائمة" });
   if (await menu.isVisible()) {
      await menu.click();
      await page.screenshot({ path: `${dir}/drawer__fawanees__dark__ar.png` });
   }
   await page.goto("/?theme=site");
   writeFileSync(`${dir}/axe.txt`, violations.join("\n") + "\n");
   expect(violations).toEqual([]);
});
