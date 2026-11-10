import { describe, expect, it } from "vitest";
import { faviconSvgPath } from "../../src/lib/app-icons.ts";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

describe("tab and app icons", () => {
   it("serves every icon without a session, cacheable, with its type", async () => {
      const f = makeWorker();
      for (const [path, type] of [
         ["/favicon.ico", "image/x-icon"],
         ["/favicon.svg", "image/svg+xml"],
         ["/favicon-qa.svg", "image/svg+xml"],
         ["/apple-touch-icon.png", "image/png"],
         ["/icon-maskable-512.png", "image/png"],
         ["/site.webmanifest", "application/manifest+json"],
      ]) {
         const res = await f(path);
         expect(res.status, path).toBe(200);
         expect(res.headers.get("content-type")).toBe(type);
         expect(res.headers.get("cache-control")).toBe("public, max-age=86400, stale-while-revalidate=604800");
         expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(100);
      }
      const svg = await (await f("/favicon.svg")).text();
      expect(svg).toContain("prefers-color-scheme:dark");
      const manifest = await (await f("/site.webmanifest")).json<{ name: string }>();
      expect(manifest.name).toBe("Al Ummah Now CMS");
   });

   it("the staff shell links the icon for its environment", async () => {
      const { callback } = await signIn(["Moderator"], { id: "icons-ed", email: "icons-ed@example.com" });
      const cookie = cookiesOf(callback);
      const qa = await (await makeWorker()("/", { headers: { cookie } })).text();
      expect(qa).toContain('<link rel="icon" type="image/svg+xml" href="/favicon-qa.svg"/>');
      expect(qa).toContain('<link rel="manifest" href="/site.webmanifest"/>');
      const prod = await (await makeWorker(undefined, { ENVIRONMENT: "production" })("/", { headers: { cookie } })).text();
      expect(prod).toContain('href="/favicon.svg"');
   });

   it("picks the variant per environment", () => {
      expect(faviconSvgPath("production")).toBe("/favicon.svg");
      expect(faviconSvgPath("stage")).toBe("/favicon-stage.svg");
      expect(faviconSvgPath("qa")).toBe("/favicon-qa.svg");
      expect(faviconSvgPath("local")).toBe("/favicon-qa.svg");
   });
});
