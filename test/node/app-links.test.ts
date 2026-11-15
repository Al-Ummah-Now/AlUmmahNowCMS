import { describe, expect, it } from "vitest";
import { appLinks } from "../../src/lib/app-links.ts";

/** The account menu's "Al Ummah Now apps" (AlUmmahNow docs/design/NAV.md). */
describe("appLinks", () => {
   const urls = {
      www: "https://www.qa.alummahnow.net",
      videos: "https://videos.qa.alummahnow.net/",
      admin: "https://admin.qa.alummahnow.net",
      issuer: "https://auth.qa.alummahnow.net",
   };

   it("a scholar (writer) sees the public apps in the shared order", () => {
      expect(appLinks("writer", "ar", urls)).toEqual([
         { id: "www", href: "https://www.qa.alummahnow.net/ar/" },
         { id: "videos", href: "https://videos.qa.alummahnow.net/ar" },
         { id: "profile", href: "https://profile.auth.qa.alummahnow.net/?lang=ar" },
      ]);
   });

   it("an editor (moderator) adds the videos admin; an admin also the accounts admin", () => {
      expect(appLinks("editor", "en", urls).map((a) => a.id)).toEqual(["www", "videos", "profile", "admin"]);
      expect(appLinks("admin", "en", urls).map((a) => a.id)).toEqual(["www", "videos", "profile", "admin", "auth-admin"]);
      expect(appLinks("admin", "en", urls).at(-1)?.href).toBe("https://admin.auth.qa.alummahnow.net");
   });

   it("leaves out an app whose address is unknown", () => {
      expect(appLinks("admin", "en", { ...urls, videos: "", issuer: "" }).map((a) => a.id)).toEqual(["www", "admin"]);
   });
});
