import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { resetThemeCache, siteTheme } from "../../src/admin/prefs.ts";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

async function session(roles: string[], id: string) {
   const { callback } = await signIn(roles, { id, email: `${id}@example.com` });
   return cookiesOf(callback);
}

const themeApi = (theme: unknown) => (url: URL) =>
   url.toString() === "https://admin.api.test/public/site-theme" ? Response.json({ theme }) : new Response("no", { status: 404 });

beforeEach(() => resetThemeCache());

describe("staff shell", () => {
   it("renders the overview for an editor: en/ltr, Fawanees by default, system mode, no People link", async () => {
      const cookie = await session(["Moderator"], "shell-ed");
      const res = await makeWorker()("/", { headers: { cookie } });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toMatch(/^<!doctype html><html lang="en" dir="ltr" data-theme="fawanees" data-mode="system" class="dark">/);
      expect(html).toContain('aria-current="page"');
      expect(html).not.toContain('href="/people"');
      expect(html).toContain('href="/pages/new"');
      expect(html).toMatch(/<link rel="stylesheet" href="\/admin-assets\/theme-fawanees\.[0-9a-f]{8}\.css"/);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
   });

   it("Arabic UI is rtl and remembered in a cookie; mode=light is remembered too", async () => {
      const cookie = await session(["Admin"], "shell-ar");
      const f = makeWorker();
      const res = await f("/?lang=ar&mode=light", { headers: { cookie } });
      const html = await res.text();
      expect(html).toMatch(/<html lang="ar" dir="rtl" data-theme="fawanees" data-mode="light">/);
      expect(html).toContain("نظرة عامة");
      const set = res.headers.getSetCookie().join("\n");
      expect(set).toMatch(/cms_lang=ar/);
      expect(set).toMatch(/cms_mode=light/);
      const again = await (await f("/", { headers: { cookie: `${cookie}; cms_lang=ar; cms_mode=dark` } })).text();
      expect(again).toMatch(/<html lang="ar" dir="rtl" data-theme="fawanees" data-mode="dark" class="dark">/);
   });

   it("follows site.theme from the videos admin", async () => {
      const cookie = await session(["Admin"], "shell-theme");
      const html = await (await makeWorker(themeApi("nahas"))("/", { headers: { cookie } })).text();
      expect(html).toContain('data-theme="nahas"');
      expect(html).toContain("Nahas");
   });

   it("previews a theme with ?theme= outside production, and ?theme=site returns to the site theme", async () => {
      const cookie = await session(["Admin"], "shell-prev");
      const f = makeWorker();
      const res = await f("/?theme=zujaj", { headers: { cookie } });
      const html = await res.text();
      expect(html).toContain('data-theme="zujaj"');
      expect(html).toContain('class="preview-bar"');
      expect(res.headers.getSetCookie().join("\n")).toMatch(/cms_theme_preview=zujaj/);
      const back = await f("/?theme=site", { headers: { cookie: `${cookie}; cms_theme_preview=zujaj` } });
      expect(await back.text()).toContain('data-theme="fawanees"');
      expect(await (await f("/?theme=bogus", { headers: { cookie } })).text()).toContain('data-theme="fawanees"');
   });

   it("People is for admins only", async () => {
      const ed = await session(["Moderator"], "people-ed");
      const admin = await session(["Admin"], "people-admin");
      const f = makeWorker();
      expect((await f("/people", { headers: { cookie: ed } })).status).toBe(403);
      const ok = await f("/people", { headers: { cookie: admin } });
      expect(ok.status).toBe(200);
      const html = await ok.text();
      expect(html).toContain("people-admin@example.com");
      expect(html).toContain("people-ed@example.com");
   });

   it("bknd's own admin UI is retired: /bknd and its assets are gone", async () => {
      const admin = await session(["Super Admin"], "bknd-admin");
      const f = makeWorker();
      const res = await f("/bknd", { headers: { cookie: admin } });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
      expect((await f("/assets/main.js", { headers: { cookie: admin } })).status).toBe(404);
   });

   it("old bknd admin URLs redirect to the staff screens", async () => {
      const f = makeWorker();
      const loc = async (p: string) => (await f(p)).headers.get("location");
      expect(await loc("/data/entity/posts")).toBe("/posts");
      expect(await loc("/data/entity/pages/edit/7")).toBe("/pages/7");
      expect(await loc("/data/entity/curated_videos/edit/3")).toBe("/videos");
      expect(await loc("/media")).toBe("/library");
   });

   it("assets are public, immutable and typed", async () => {
      const cookie = await session(["Admin"], "shell-assets");
      const f = makeWorker();
      const html = await (await f("/", { headers: { cookie } })).text();
      for (const m of html.matchAll(/(?:href|src)="(\/admin-assets\/[^"]+)"/g)) {
         const res = await f(m[1]);
         expect(res.status).toBe(200);
         expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
         expect(res.headers.get("content-type")).toMatch(m[1].endsWith(".js") ? /javascript/ : /text\/css/);
      }
      expect((await f("/admin-assets/nope.css")).status).toBe(404);
   });
});

describe("siteTheme", () => {
   const ok = (theme: unknown) => (async () => Response.json({ theme })) as unknown as typeof fetch;
   it("reads a known theme and caches it for 30 s", async () => {
      expect(await siteTheme("https://a.test", ok("zujaj"), 1000)).toBe("zujaj");
      expect(await siteTheme("https://a.test", ok("nahas"), 2000)).toBe("zujaj");
      expect(await siteTheme("https://a.test", ok("nahas"), 40_000)).toBe("nahas");
   });
   it("falls back to Fawanees: unset URL, unknown value, error, network failure", async () => {
      expect(await siteTheme(undefined, ok("zujaj"))).toBe("fawanees");
      resetThemeCache();
      expect(await siteTheme("https://b.test", ok("neon"))).toBe("fawanees");
      resetThemeCache();
      expect(await siteTheme("https://c.test", (async () => new Response("x", { status: 500 })) as unknown as typeof fetch)).toBe("fawanees");
      resetThemeCache();
      expect(await siteTheme("https://d.test", (async () => { throw new Error("down"); }) as unknown as typeof fetch)).toBe("fawanees");
   });
   it("production ignores the preview parameter", async () => {
      expect(env.ENVIRONMENT).toBe("qa");
      const cookie = await session(["Admin"], "shell-prod");
      const html = await (await makeWorker(undefined, { ENVIRONMENT: "production" })("/?theme=zujaj", { headers: { cookie } })).text();
      expect(html).toContain('data-theme="fawanees"');
      expect(html).not.toContain("preview-bar");
   });
});
