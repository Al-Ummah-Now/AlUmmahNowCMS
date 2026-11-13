/** Staff passkeys (wiki AUTH-PASSKEYS, "Staff enforcement points": CMS admin). */
import { describe, expect, it } from "vitest";
import { CMS, cookiesOf, ISSUER, makeWorker, signIn, usersCount } from "./helpers.ts";

const now = () => Math.floor(Date.now() / 1000);
const sessionCookie = (res: Response) => res.headers.getSetCookie().find((c) => c.startsWith("auth=") && !/^auth=;/.test(c));

describe("staff passkeys: sign-in", () => {
   it("enforcement off (no passkey_deadline): staff sign in with a password as before, no banner", async () => {
      const { callback, fetchCms } = await signIn(["Admin"], { id: "pk-off", email: "pk-off@example.com" }, { amr: ["pwd"] });
      expect(callback.status).toBe(302);
      const screen = await fetchCms("/posts", { headers: { cookie: cookiesOf(callback) } });
      expect(screen.status).toBe(200);
      expect(await screen.text()).not.toContain("passkey-banner");
   });

   it("past the deadline without a passkey: no session, no user row, the Passkey needed page", async () => {
      const before = await usersCount();
      const { callback, fetchCms } = await signIn(["Moderator"], { id: "pk-late", email: "pk-late@example.com" }, { amr: ["pwd"], deadline: now() - 60, returnPath: "/posts" });
      expect(callback.status).toBe(303);
      expect(callback.headers.get("location")).toBe("/sso/passkey-needed?return=%2Fposts");
      expect(sessionCookie(callback)).toBeUndefined();
      expect(await usersCount()).toBe(before);
      const page = await fetchCms(callback.headers.get("location")!);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("Passkey needed");
      const add = new URL(/data-testid="passkey-add" href="([^"]+)"|href="([^"]+)" data-testid="passkey-add"/.exec(html)![2]!.replace(/&amp;/g, "&"));
      expect(`${add.origin}${add.pathname}`).toBe(`${ISSUER}/passkeys/setup`);
      expect(add.searchParams.get("return_to")).toBe(`${CMS}/sso/login?prompt=login&return=%2Fposts`);
      expect(html).toContain('href="/sso/login?prompt=login&amp;return=%2Fposts" data-testid="passkey-sign-in"');
   });

   it("a token without amr (issued before Auth sent it) counts as no passkey", async () => {
      const { callback } = await signIn(["Admin"], { id: "pk-noamr", email: "pk-noamr@example.com" }, { deadline: now() - 60 });
      expect(callback.headers.get("location")).toMatch(/^\/sso\/passkey-needed\?/);
   });

   it("signed in with a passkey: a normal session, even past the deadline", async () => {
      const { callback, fetchCms } = await signIn(["Super Admin"], { id: "pk-ok", email: "pk-ok@example.com" }, { amr: ["passkey"], deadline: now() - 60 });
      expect(callback.status).toBe(302);
      const screen = await fetchCms("/posts", { headers: { cookie: cookiesOf(callback) } });
      expect(screen.status).toBe(200);
      expect(await screen.text()).not.toContain("passkey-banner");
   });

   it("non-staff (Scholar) are never asked for a passkey", async () => {
      const { callback } = await signIn(["Scholar"], { id: "pk-scholar", email: "pk-scholar@example.com" }, { amr: ["pwd"], deadline: now() - 60 });
      expect(callback.status).toBe(302);
      expect(sessionCookie(callback)).toBeDefined();
   });
});

describe("staff passkeys: grace period", () => {
   it("before the deadline: a session with the banner Add a passkey by <date>", async () => {
      const deadline = now() + 3 * 86400;
      const { callback, fetchCms } = await signIn(["Writer"], { id: "pk-grace", email: "pk-grace@example.com" }, { amr: ["pwd"], deadline });
      expect(callback.status).toBe(302);
      const html = await (await fetchCms("/posts", { headers: { cookie: cookiesOf(callback) } })).text();
      expect(html).toContain('data-testid="passkey-banner"');
      expect(html).toMatch(/Add a passkey by [^<]+UTC/);
      expect(html).toContain(`${ISSUER}/passkeys/setup?return_to=`);
   });

   it("the 8 h session never outlives the deadline: the next request shows the page, APIs answer passkey_required", async () => {
      const { callback, fetchCms } = await signIn(["Admin"], { id: "pk-lapse", email: "pk-lapse@example.com" }, { amr: ["otp"], deadline: now() + 2 });
      const cookie = cookiesOf(callback);
      expect((await fetchCms("/posts", { headers: { cookie } })).status).toBe(200);
      await new Promise((r) => setTimeout(r, 2100));
      const screen = await fetchCms("/posts?x=1", { headers: { cookie } });
      expect(screen.status).toBe(302);
      expect(screen.headers.get("location")).toBe("/sso/passkey-needed?return=%2Fposts%3Fx%3D1");
      for (const path of ["/picker/api/search?kind=video&q=ab", "/api/data/entity/posts"]) {
         const res = await fetchCms(path, { headers: { cookie } });
         expect(res.status, path).toBe(403);
         const body = (await res.json()) as { error: string; setup_url: string };
         expect(body.error).toBe("passkey_required");
         expect(body.setup_url).toMatch(new RegExp(`^${ISSUER}/passkeys/setup\\?`));
      }
   });
});

describe("Passkey needed page", () => {
   it("Arabic, right to left", async () => {
      const html = await (await makeWorker()("/sso/passkey-needed?return=%2F&lang=ar")).text();
      expect(html).toContain('<html lang="ar" dir="rtl"');
      expect(html).toContain("يلزم مفتاح مرور");
      expect(html).toContain("/sso/login?prompt=login&amp;return=%2F&amp;lang=ar");
   });

   it("Light/Dark: follows the device until a choice is saved, then the saved mode", async () => {
      const f = makeWorker();
      const auto = await (await f("/sso/passkey-needed")).text();
      expect(auto).not.toContain("data-mode=");
      expect(auto).toContain("prefers-color-scheme: dark");
      const dark = await f("/sso/passkey-needed?mode=dark");
      expect(await dark.text()).toContain('data-mode="dark" class="dark"');
      expect(dark.headers.getSetCookie().some((c) => c.startsWith("cms_mode=dark"))).toBe(true);
      const saved = await (await f("/sso/passkey-needed", { headers: { cookie: "cms_mode=light" } })).text();
      expect(saved).toContain('data-mode="light"');
   });

   it("only a safe return path is used", async () => {
      const html = await (await makeWorker()("/sso/passkey-needed?return=%2F%2Fevil.example")).text();
      expect(html).toContain("/sso/login?prompt=login&amp;return=%2F\"");
      expect(html).not.toContain("evil.example");
   });
});
