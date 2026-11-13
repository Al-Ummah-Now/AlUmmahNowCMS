import { describe, expect, it } from "vitest";
import { NOINDEX, ROBOTS_TXT, robotsTxtResponse, withCrawlerRules } from "../../src/lib/crawlers.ts";

const req = (path: string) => new Request(`https://cms.alummahnow.net${path}`);

describe("CMS crawler rules", () => {
   it("robots.txt keeps public media crawlable and disallows the rest", async () => {
      const res = robotsTxtResponse(req("/robots.txt"));
      expect(res).not.toBeNull();
      expect(await res!.text()).toBe(ROBOTS_TXT);
      expect(ROBOTS_TXT).toBe("User-agent: *\nAllow: /api/public/v1/media/\nDisallow: /\n");
      expect(robotsTxtResponse(req("/api/public/v1/pages"))).toBeNull();
   });

   it("marks the public JSON API, assets and icons noindex", () => {
      for (const path of ["/api/public/v1/pages/about", "/api/public/v1/sitemap", "/admin-assets/app.js", "/favicon.ico", "/health"]) {
         expect(withCrawlerRules(req(path), new Response("x")).headers.get("X-Robots-Tag")).toBe(NOINDEX);
      }
   });

   it("leaves public media without noindex (article and share images)", () => {
      const res = withCrawlerRules(req("/api/public/v1/media/abc.png"), new Response("img", { headers: { "Content-Type": "image/png" } }));
      expect(res.headers.get("X-Robots-Tag")).toBeNull();
   });

   it("keeps a header a private response already set, and copies immutable responses", () => {
      const own = new Response("x", { headers: { "X-Robots-Tag": "noindex, nofollow, noarchive" } });
      expect(withCrawlerRules(req("/admin"), own).headers.get("X-Robots-Tag")).toBe("noindex, nofollow, noarchive");
      const redirect = withCrawlerRules(req("/sso/login"), Response.redirect("https://auth.alummahnow.net/authorize", 302));
      expect(redirect.status).toBe(302);
      expect(redirect.headers.get("X-Robots-Tag")).toBe(NOINDEX);
   });
});
