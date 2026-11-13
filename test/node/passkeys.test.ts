import { describe, expect, it } from "vitest";
import {
   isAuthStaff,
   passkeyNeededPath,
   passkeySetupUrl,
   passkeySignInPath,
   passkeyVerdict,
   sessionPasskeyDeadline,
   sessionPasskeyLapsed,
} from "../../src/lib/passkeys.ts";

const NOW = 1_800_000_000;

describe("isAuthStaff", () => {
   it.each([["Super Admin"], ["Admin"], ["Moderator"], ["Writer"], ["Content Reviewer"], ["Senior Reviewer"], ["  senior-reviewer "]])("%s is staff", (role) =>
      expect(isAuthStaff([role])).toBe(true),
   );
   it("Scholar, Member, unknown and malformed roles are not staff", () => {
      expect(isAuthStaff(["Scholar", "Member", "Content Editor"])).toBe(false);
      expect(isAuthStaff([7, null])).toBe(false);
      expect(isAuthStaff([])).toBe(false);
      expect(isAuthStaff(undefined)).toBe(false);
   });
   it("any staff role among others counts", () => expect(isAuthStaff(["Scholar", "Writer"])).toBe(true));
});

describe("passkeyVerdict", () => {
   const staff = { roles: ["Admin"] };

   it("deadline absent (enforcement off): ok", () => {
      expect(passkeyVerdict({ ...staff, amr: ["pwd"] }, NOW)).toEqual({ kind: "ok" });
      expect(passkeyVerdict(staff, NOW)).toEqual({ kind: "ok" });
   });
   it("deadline in the past, no passkey: required", () => {
      expect(passkeyVerdict({ ...staff, amr: ["pwd"], passkeyDeadline: NOW - 1 }, NOW)).toEqual({ kind: "required" });
   });
   it("deadline exactly now: required (now >= deadline)", () => {
      expect(passkeyVerdict({ ...staff, amr: ["pwd"], passkeyDeadline: NOW }, NOW)).toEqual({ kind: "required" });
   });
   it("deadline in the future, no passkey: grace until the deadline", () => {
      expect(passkeyVerdict({ ...staff, amr: ["otp"], passkeyDeadline: NOW + 3600 }, NOW)).toEqual({ kind: "grace", deadline: NOW + 3600 });
   });
   it("amr missing (token from before amr) counts as no passkey", () => {
      expect(passkeyVerdict({ ...staff, passkeyDeadline: NOW - 1 }, NOW)).toEqual({ kind: "required" });
      expect(passkeyVerdict({ ...staff, passkeyDeadline: NOW + 1 }, NOW)).toEqual({ kind: "grace", deadline: NOW + 1 });
   });
   it("signed in with a passkey: ok, before and after the deadline", () => {
      expect(passkeyVerdict({ ...staff, amr: ["passkey"], passkeyDeadline: NOW - 1 }, NOW)).toEqual({ kind: "ok" });
      expect(passkeyVerdict({ ...staff, amr: ["pwd", "passkey"], passkeyDeadline: NOW + 1 }, NOW)).toEqual({ kind: "ok" });
   });
   it("non-staff are never affected, even with a deadline", () => {
      expect(passkeyVerdict({ roles: ["Scholar"], amr: ["pwd"], passkeyDeadline: NOW - 1 }, NOW)).toEqual({ kind: "ok" });
      expect(passkeyVerdict({ roles: [], passkeyDeadline: NOW - 1 }, NOW)).toEqual({ kind: "ok" });
   });
   it("a non-finite deadline is ignored", () => {
      expect(passkeyVerdict({ ...staff, passkeyDeadline: Number.NaN }, NOW)).toEqual({ kind: "ok" });
   });
});

describe("grace sessions (JWT pkd)", () => {
   it("lapse at the deadline, not before", () => {
      expect(sessionPasskeyLapsed({ pkd: NOW + 1 }, NOW)).toBe(false);
      expect(sessionPasskeyLapsed({ pkd: NOW }, NOW)).toBe(true);
      expect(sessionPasskeyLapsed({ pkd: NOW - 60 }, NOW)).toBe(true);
   });
   it("sessions without pkd (passkey sign-in, enforcement off, older sessions) never lapse", () => {
      expect(sessionPasskeyLapsed({}, NOW)).toBe(false);
      expect(sessionPasskeyLapsed({ pkd: "soon" }, NOW)).toBe(false);
      expect(sessionPasskeyDeadline({})).toBeNull();
      expect(sessionPasskeyDeadline({ pkd: NOW })).toBe(NOW);
   });
});

describe("links", () => {
   it("Sign in with a passkey = the CMS's own sign-in with prompt=login", () => {
      expect(passkeySignInPath("/posts?x=1")).toBe("/sso/login?prompt=login&return=%2Fposts%3Fx%3D1");
   });
   it("Add a passkey = Auth's setup page, back to the CMS sign-in", () => {
      const url = new URL(passkeySetupUrl("https://auth.qa.alummahnow.net/", "https://cms.qa.alummahnow.net", "/pages"));
      expect(`${url.origin}${url.pathname}`).toBe("https://auth.qa.alummahnow.net/passkeys/setup");
      expect(url.searchParams.get("return_to")).toBe("https://cms.qa.alummahnow.net/sso/login?prompt=login&return=%2Fpages");
   });
   it("Arabic: both links keep the language (Auth reads ?lang= only)", () => {
      expect(passkeySignInPath("/", "ar")).toBe("/sso/login?prompt=login&return=%2F&lang=ar");
      const url = new URL(passkeySetupUrl("https://auth.test", "https://cms.test", "/", "ar"));
      expect(url.searchParams.get("lang")).toBe("ar");
      expect(url.searchParams.get("return_to")).toBe("https://cms.test/sso/login?prompt=login&return=%2F&lang=ar");
   });
   it("the page keeps the return path and an Arabic language", () => {
      expect(passkeyNeededPath("/")).toBe("/sso/passkey-needed?return=%2F");
      expect(passkeyNeededPath("/posts", "ar")).toBe("/sso/passkey-needed?return=%2Fposts&lang=ar");
   });
});
