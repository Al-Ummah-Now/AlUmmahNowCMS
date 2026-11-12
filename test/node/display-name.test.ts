import { describe, expect, it } from "vitest";
import { resolveDisplayName, resolvePersonalName, type NameFields } from "../../src/lib/display-name.ts";
import { accountName, accountPersonalName, fetchAccountProfile } from "../../src/lib/account-name.ts";
import { initialNames, scholarName } from "../../src/lib/scholars/profiles.ts";

describe("resolveDisplayName (the platform rule: display name, else first + last)", () => {
   const cases: [string, NameFields | null | undefined, string | undefined, string][] = [
      ["display name", { displayName: "Abu Bakr", firstName: "A", lastName: "B" }, "en", "Abu Bakr"],
      ["localized display name in the page language wins", { displayName: "Plain", displayNameLocalized: { ar: "عربي", en: "English" } }, "ar", "عربي"],
      ["region locale falls back to its language", { displayNameLocalized: { ar: "عربي" } }, "ar-EG", "عربي"],
      ["the owner's prod profile: empty display name → first + last", { displayName: "", firstName: "Mahmoud", lastName: "Darwish" }, "en", "Mahmoud Darwish"],
      ["whitespace-only display name counts as missing", { displayName: "   ", firstName: "Mahmoud", lastName: "Darwish" }, "en", "Mahmoud Darwish"],
      ["inner whitespace is collapsed and trimmed", { firstName: "  Mahmoud  ", lastName: " Darwish " }, "en", "Mahmoud Darwish"],
      ["first only", { firstName: "Mahmoud", lastName: "" }, "en", "Mahmoud"],
      ["last only", { firstName: "  ", lastName: "Darwish" }, "en", "Darwish"],
      ["localized first + last in the page language", { firstName: "Mahmoud", lastName: "Darwish", firstNameLocalized: { ar: "محمود" }, lastNameLocalized: { ar: "درويش" } }, "ar", "محمود درويش"],
      ["localized first with plain last", { firstName: "Mahmoud", lastName: "Darwish", firstNameLocalized: { ar: "محمود" } }, "ar", "محمود Darwish"],
      ["Arabic-only display name viewed in en", { displayNameLocalized: { ar: "محمود درويش" } }, "en", "محمود درويش"],
      ["Arabic-only first + last viewed in en", { firstNameLocalized: { ar: "محمود" }, lastNameLocalized: { ar: "درويش" } }, "en", "محمود درويش"],
      ["other languages: en before ar", { displayNameLocalized: { ar: "عربي", en: "English", fr: "Français" } }, "de", "English"],
      ["handle only", { displayName: "", userName: "mahmoud" }, "en", "@mahmoud"],
      ["handle stored as handle, @ not doubled", { handle: "@@mahmoud" }, "en", "@mahmoud"],
      ["whitespace handle counts as missing", { userName: "  " }, "en", ""],
      ["nothing", {}, "en", ""],
      ["all empty strings", { displayName: "", firstName: "", lastName: "", userName: "", displayNameLocalized: { en: "", ar: " " } }, "en", ""],
      ["null profile", null, "en", ""],
      ["undefined profile", undefined, undefined, ""],
      ["no locale: plain names", { displayName: "", firstName: "Mahmoud", lastName: "Darwish" }, undefined, "Mahmoud Darwish"],
      ["no locale: localized only", { displayNameLocalized: { ar: "عربي" } }, undefined, "عربي"],
      ["non-string values are ignored", { displayName: 42 as never, firstName: null, lastName: "Darwish" }, "en", "Darwish"],
   ];
   for (const [name, profile, locale, want] of cases) {
      it(name, () => expect(resolveDisplayName(profile, locale)).toBe(want));
   }

   it("never returns the email", () => {
      expect(resolveDisplayName({ email: "owner@example.com" } as NameFields, "en")).toBe("");
   });

   it("resolvePersonalName stops before the handle", () => {
      expect(resolvePersonalName({ userName: "mahmoud" }, "en")).toBe("");
      expect(resolvePersonalName({ displayName: "", firstName: "Mahmoud", lastName: "Darwish", userName: "m" }, "en")).toBe("Mahmoud Darwish");
   });
});

describe("account names from the videos API", () => {
   const owner = { displayName: "", firstName: "Mahmoud", lastName: "Darwish", userName: null };
   const api = (body: unknown, status = 200) => (async () => Response.json(body, { status })) as unknown as typeof fetch;

   it("reads the public profile and resolves it", async () => {
      let asked = "";
      const f = (async (u: RequestInfo | URL) => {
         asked = String(u);
         return Response.json({ success: true, result: { profile: { id: "u-1", ...owner, bio: "x" } } });
      }) as typeof fetch;
      const p = await fetchAccountProfile("https://videos.api.test/", "u 1", f);
      expect(asked).toBe("https://videos.api.test/api/profiles/u%201");
      expect(p).not.toHaveProperty("bio");
      expect(accountName(p, "en")).toBe("Mahmoud Darwish");
      expect(accountPersonalName(p, "ar")).toBe("Mahmoud Darwish");
   });

   it("is null on 404, a bad body or a network error", async () => {
      expect(await fetchAccountProfile("https://v.test", "u", api({ error: "nf" }, 404))).toBeNull();
      expect(await fetchAccountProfile("https://v.test", "u", api({ result: {} }))).toBeNull();
      expect(await fetchAccountProfile("https://v.test", "u", (async () => Promise.reject(new Error("down"))) as typeof fetch)).toBeNull();
      expect(accountName(null, "en")).toBe("");
   });

   it("uses the API's resolvedDisplayName when the fields give nothing", () => {
      expect(accountName({ displayName: "", resolvedDisplayName: " Mahmoud Darwish " }, "en")).toBe("Mahmoud Darwish");
      expect(accountPersonalName({ resolvedDisplayName: "@mahmoud" }, "en")).toBe("");
      expect(accountPersonalName({ displayName: "@mahmoud" }, "en")).toBe("");
      expect(accountName({ userName: "mahmoud" }, "en")).toBe("@mahmoud");
   });
});

describe("a new scholar profile's names", () => {
   it("the token's name wins, its script picks the column", () => {
      expect(initialNames({ name: "Aisha Rahman", names: { en: "X", ar: "Y" } })).toEqual({ en: "Aisha Rahman", ar: null });
      expect(initialNames({ name: "عائشة" })).toEqual({ en: null, ar: "عائشة" });
   });
   it("else the account's names: first + last when the display name is empty", () => {
      expect(initialNames({ name: null, names: { en: "Mahmoud Darwish", ar: "Mahmoud Darwish" } })).toEqual({ en: "Mahmoud Darwish", ar: null });
      expect(initialNames({ names: { en: "Mahmoud Darwish", ar: "محمود درويش" } })).toEqual({ en: "Mahmoud Darwish", ar: "محمود درويش" });
      expect(initialNames({ names: { en: "محمود درويش", ar: "محمود درويش" } })).toEqual({ en: null, ar: "محمود درويش" });
      expect(initialNames({ names: { en: " ", ar: "" } })).toEqual({ en: null, ar: null });
   });
   it("scholarName never shows an empty name", () => {
      expect(scholarName({ name_en: " ", name_ar: "عالم", slug: "s" }, "en")).toBe("عالم");
      expect(scholarName({ name_en: "", name_ar: null, slug: "s" }, "ar")).toBe("s");
   });
});
