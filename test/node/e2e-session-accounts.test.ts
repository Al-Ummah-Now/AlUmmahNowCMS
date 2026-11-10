import { describe, expect, it } from "vitest";
import { checkSpec, checkSpecs, specFiles } from "../../scripts/lib/e2e-session-accounts.ts";

describe("session-ending E2E specs use dedicated accounts (scripts/lib/e2e-session-accounts.ts)", () => {
   it("finds the specs", () => {
      expect(specFiles("e2e").some((f) => f.endsWith("sso-journey.spec.ts"))).toBe(true);
   });

   it("no spec in e2e/ ends sessions of a shared account", () => {
      expect(checkSpecs("e2e")).toEqual([]);
   });

   it.each([
      ['await page.goto("/sso/logout");\nawait signIn(ACCOUNTS.admin);', "ACCOUNTS.admin"],
      ['await page.getByRole("button", { name: "Sign out" }).click(); // as qa-admin@delivered.resend.dev', "qa-admin@"],
      ["await request.post(`${AUTH_URL}/logout`); login(ACCOUNTS[role]);", "ACCOUNTS["],
      ["await revokeRefreshToken(t); const a = ACCOUNTS.moderator;", "ACCOUNTS.moderator"],
      ["await changePassword(ACCOUNTS.viewer, 'x');", "ACCOUNTS.viewer"],
      ['await setRole(user, "Moderator"); signIn({ email: "qa-superadmin@e2e.alummahnow.net" });', "qa-superadmin@"],
      ["await terminateSessions(); signIn({ email: 'delivered+cms-e2e-admin@resend.dev' });", "cms-e2e-admin@"],
   ])("flags a bad spec: %s", (source, account) => {
      expect(checkSpec("bad.spec.ts", source)?.account).toBe(account);
   });

   it.each([
      ['await page.goto("/sso/logout"); signIn(ACCOUNTS.ssoCms);'],
      ['signIn({ email: "qa-sso-cms@delivered.resend.dev" }); await page.click("text=Sign out");'],
      ["// No session-ending action here\nsignIn(ACCOUNTS.admin);"],
   ])("allows %s", (source) => {
      expect(checkSpec("ok.spec.ts", source)).toBeNull();
   });
});
