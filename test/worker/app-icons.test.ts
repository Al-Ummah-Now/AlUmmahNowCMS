import { describe, expect, it } from "vitest";
import { faviconSvgPath, tabIconHtml, tabIconLinks } from "../../src/lib/app-icons.ts";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

describe("tab and app icons", () => {
   it("serves every icon without a session, cacheable, with its type", async () => {
      const f = makeWorker();
      for (const [path, type] of [
         ["/favicon.ico", "image/x-icon"],
         ["/favicon-16x16.png", "image/png"],
         ["/favicon-32x32.png", "image/png"],
         ["/favicon-48x48.png", "image/png"],
         ["/favicon-96x96.png", "image/png"],
         ["/favicon-qa.svg", "image/svg+xml"],
         ["/favicon-stage.svg", "image/svg+xml"],
         ["/apple-touch-icon.png", "image/png"],
         ["/icon-512.png", "image/png"],
         ["/site.webmanifest", "application/manifest+json"],
      ]) {
         const res = await f(path);
         expect(res.status, path).toBe(200);
         expect(res.headers.get("content-type")).toBe(type);
         expect(res.headers.get("cache-control")).toBe("public, max-age=86400, stale-while-revalidate=604800");
         expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(100);
      }
      // no production SVG: a browser would prefer it over the sized PNGs and blur it
      expect((await f("/favicon.svg")).status).not.toBe(200);
      const svg = await (await f("/favicon-qa.svg")).text();
      expect(svg).toContain("data:image/png;base64,");
      expect(svg).toContain("<circle");
      const manifest = await (await f("/site.webmanifest")).json<{ name: string }>();
      expect(manifest.name).toBe("Al Ummah Now CMS");
   });

   it("serves the account menu's app icons as separate WebP files (never inlined in the CSS)", async () => {
      const f = makeWorker();
      for (const id of ["www", "videos", "profile", "cms", "admin", "auth-admin"]) {
         const res = await f(`/aun-nav/icons/${id}.webp`);
         expect(res.status, id).toBe(200);
         expect(res.headers.get("content-type")).toBe("image/webp");
         const body = new Uint8Array(await res.arrayBuffer());
         expect(new TextDecoder().decode(body.subarray(8, 12))).toBe("WEBP");
      }
   });

   it("the staff shell links the icon for its environment", async () => {
      const { callback } = await signIn(["Moderator"], { id: "icons-ed", email: "icons-ed@example.com" });
      const cookie = cookiesOf(callback);
      const qa = await (await makeWorker()("/", { headers: { cookie } })).text();
      expect(qa).toContain('<link rel="icon" href="/favicon-qa.svg" type="image/svg+xml"/>');
      expect(qa).not.toContain("favicon-32x32.png");
      expect(qa).toContain('<link rel="manifest" href="/site.webmanifest"/>');
      const prod = await (await makeWorker(undefined, { ENVIRONMENT: "production" })("/", { headers: { cookie } })).text();
      expect(prod).toContain('<link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32"/>');
      expect(prod).toContain('<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48"/>');
      expect(prod).not.toContain("image/svg+xml");
   });

   it("picks the variant per environment", () => {
      expect(faviconSvgPath("production")).toBeNull();
      expect(faviconSvgPath("stage")).toBe("/favicon-stage.svg");
      expect(faviconSvgPath("qa")).toBe("/favicon-qa.svg");
      expect(faviconSvgPath("local")).toBe("/favicon-qa.svg");
      expect(tabIconLinks("production").map((l) => l.sizes)).toEqual(["16x16 32x32 48x48", "16x16", "32x32", "48x48", "96x96"]);
      expect(tabIconLinks("stage").map((l) => l.href)).toEqual(["/favicon.ico", "/favicon-stage.svg"]);
      expect(tabIconHtml("production")).not.toContain("svg");
   });
});
