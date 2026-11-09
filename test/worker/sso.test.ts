import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { pkceChallenge } from "../../src/lib/pkce.ts";
import { callbackErrorRedirect } from "../../src/routes/sso.ts";
import { accessToken, CLIENT, CMS, cookiesOf, ISSUER, makeWorker, signIn, usersCount } from "./helpers.ts";

describe("unauthenticated", () => {
   it("/ redirects to /sso/login with the return path", async () => {
      const res = await makeWorker()("/data/entity/posts?x=1");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/sso/login?return=%2Fdata%2Fentity%2Fposts%3Fx%3D1");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
   });

   it("/sso/login → auth /authorize with client_id, the exact redirect_uri and PKCE S256", async () => {
      const res = await makeWorker()("/sso/login?return=/picker");
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get("location")!);
      expect(`${loc.origin}${loc.pathname}`).toBe(`${ISSUER}/authorize`);
      expect(loc.searchParams.get("client_id")).toBe(CLIENT);
      expect(loc.searchParams.get("redirect_uri")).toBe(`${CMS}/sso/callback`);
      expect(loc.searchParams.get("response_type")).toBe("code");
      expect(loc.searchParams.get("code_challenge_method")).toBe("S256");
      expect(loc.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(loc.searchParams.get("state")).toBeTruthy();
      // The normal sign-in never forces a prompt: auth signs the active account in silently.
      expect(loc.searchParams.has("prompt")).toBe(false);
      const cookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-cms_sso="));
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/Path=\//);
      expect(cookie).toMatch(/SameSite=Lax/i);
   });

   it("the picker API answers 401 JSON, not a redirect", async () => {
      const res = await makeWorker()("/picker/api/search?kind=video&q=ab");
      expect(res.status).toBe(401);
   });

   it("bknd password/register routes are gone", async () => {
      const f = makeWorker();
      for (const [method, path] of [
         ["POST", "/api/auth/password/login"],
         ["POST", "/api/auth/password/register"],
         ["POST", "/api/auth/register"],
      ]) {
         expect((await f(path, { method })).status, path).toBe(404);
      }
      expect((await f("/auth/login")).headers.get("location")).toMatch(/^\/sso\/login/);
   });

   it("the guest role has no data permissions", async () => {
      const res = await makeWorker()("/api/data/entity/posts");
      expect(res.status).toBe(403);
   });
});

describe("callback", () => {
   it("rejects a missing or mismatched state", async () => {
      const f = makeWorker();
      expect((await f("/sso/callback?code=x&state=y")).status).toBe(400);
      const login = await f("/sso/login");
      expect((await f("/sso/callback?code=x&state=wrong", { headers: { cookie: cookiesOf(login) } })).status).toBe(400);
   });

   it("sends the PKCE verifier matching the challenge, the exact redirect_uri and no secret", async () => {
      const { authorize, tokenRequest } = await signIn(["Admin"]);
      expect(tokenRequest?.get("grant_type")).toBe("authorization_code");
      expect(tokenRequest?.get("redirect_uri")).toBe(authorize.searchParams.get("redirect_uri"));
      expect(tokenRequest?.get("client_id")).toBe(CLIENT);
      expect(tokenRequest?.has("client_secret")).toBe(false);
      expect(await pkceChallenge(tokenRequest!.get("code_verifier")!)).toBe(authorize.searchParams.get("code_challenge"));
   });

   it("a user without an allowed role gets the 403 page and nothing is created", async () => {
      const before = await usersCount();
      const { callback } = await signIn(["Viewer"], { id: "viewer-1", email: "viewer@example.com" });
      expect(callback.status).toBe(303);
      expect(callback.headers.get("location")).toBe("/sso/no-access");
      const denied = await makeWorker()("/sso/no-access");
      expect(denied.status).toBe(403);
      const html = await denied.text();
      expect(html).toContain("No access");
      expect(callback.headers.getSetCookie().some((c) => c.startsWith("auth="))).toBe(false);
      expect(await usersCount()).toBe(before);
   });

   it("a user with no roles at all is denied too", async () => {
      const { callback } = await signIn(undefined, { id: "nobody", email: "nobody@example.com" });
      expect(callback.status).toBe(303);
      expect(callback.headers.get("location")).toBe("/sso/no-access");
   });

   it("an admin gets a session cookie and lands on the return path", async () => {
      const { callback } = await signIn(["Super Admin"], { id: "admin-1", email: "Admin@Example.com" });
      expect(callback.status).toBe(302);
      expect(callback.headers.get("location")).toBe("/data/entity/posts");
      const auth = callback.headers.getSetCookie().find((c) => c.startsWith("auth="));
      expect(auth).toMatch(/HttpOnly/i);
      expect(auth).toMatch(/Secure/i);
      expect(auth).toMatch(/SameSite=Lax/i);
      const row = await env.DB.prepare("SELECT email, role, strategy, sso_sub FROM users WHERE sso_sub = 'admin-1'").first();
      expect(row).toEqual({ email: "admin@example.com", role: "admin", strategy: "sso", sso_sub: "admin-1" });
   });

   it("the role is re-derived on every sign-in (demotion and promotion)", async () => {
      const who = { id: "mod-1", email: "mod@example.com" };
      await signIn(["Admin"], who);
      expect((await env.DB.prepare("SELECT role FROM users WHERE sso_sub = 'mod-1'").first())?.role).toBe("admin");
      await signIn(["Moderator"], who);
      const rows = await env.DB.prepare("SELECT role FROM users WHERE sso_sub = 'mod-1'").all();
      expect(rows.results).toEqual([{ role: "editor" }]);
   });

   it("the session opens the admin UI, with security headers and the picker link", async () => {
      const { callback, fetchCms } = await signIn(["Moderator"], { id: "ed-ui", email: "ed-ui@example.com" });
      const res = await fetchCms("/", { headers: { cookie: cookiesOf(callback) } });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('href="/picker"');
      expect(html).toContain('href="/sso/accounts?return=%2F"');
      expect(html).toContain('"/sso/login?return=" + encodeURIComponent');
      const csp = res.headers.get("content-security-policy")!;
      expect(csp).toContain("frame-ancestors 'none'");
      const nonce = csp.match(/'nonce-([^']+)'/)![1];
      expect(html).toContain(`nonce="${nonce}"`);
      expect(res.headers.get("x-robots-tag")).toContain("noindex");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
   });

   it("an editor can create but not delete content; mutations need a same-origin Origin", async () => {
      const { callback, fetchCms } = await signIn(["Moderator"], { id: "ed-2", email: "ed2@example.com" });
      const cookie = cookiesOf(callback);
      const json = { "content-type": "application/json", cookie };
      const noOrigin = await fetchCms("/api/data/entity/posts", { method: "POST", headers: json, body: JSON.stringify({ slug: "a", locale: "en", title: "A" }) });
      expect(noOrigin.status).toBe(403);
      const foreign = await fetchCms("/api/data/entity/posts", { method: "POST", headers: { ...json, origin: "https://evil.example" }, body: "{}" });
      expect(foreign.status).toBe(403);
      const created = await fetchCms("/api/data/entity/posts", {
         method: "POST",
         headers: { ...json, origin: CMS },
         body: JSON.stringify({ slug: "editor-post", locale: "en", title: "Editor post", status: "published" }),
      });
      expect(created.status).toBe(201);
      const { data } = (await created.json()) as { data: { id: number; published_at: string | null; created_at: string | null } };
      expect(data.published_at).toBeTruthy();
      expect(data.created_at).toBeTruthy();
      const del = await fetchCms(`/api/data/entity/posts/${data.id}`, { method: "DELETE", headers: { cookie, origin: CMS } });
      expect(del.status).toBe(403);
      const users = await fetchCms("/api/data/entity/users", { headers: { cookie } });
      expect(users.status).toBe(403);
   });

   it("logout clears the session and goes to auth logout, then www", async () => {
      const res = await makeWorker()("/sso/logout");
      expect(res.status).toBe(302);
      const loc = new URL(res.headers.get("location")!);
      expect(`${loc.origin}${loc.pathname}`).toBe(`${ISSUER}/logout`);
      expect(loc.searchParams.get("return")).toBe("https://www.test/");
      expect(res.headers.getSetCookie().some((c) => c.startsWith("auth=") && /Max-Age=0|expires=Thu, 01 Jan 1970/i.test(c))).toBe(true);
   });
   it("front-channel logout hop: clears the session and hands back to auth's next step", async () => {
      const next = `${ISSUER}/logout?step=2&return=${encodeURIComponent("https://www.test/")}`;
      const res = await makeWorker()(`/sso/logout?next=${encodeURIComponent(next)}`);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(next);
      expect(res.headers.getSetCookie().some((c) => c.startsWith("auth=") && /Max-Age=0|expires=Thu, 01 Jan 1970/i.test(c))).toBe(true);
   });

   it("ignores a next that is not the auth server's /logout (no open redirect)", async () => {
      for (const next of ["https://evil.example/logout", `${ISSUER}/authorize`, "//evil.example/logout", "javascript:alert(1)"]) {
         const res = await makeWorker()(`/sso/logout?next=${encodeURIComponent(next)}`);
         const loc = new URL(res.headers.get("location")!);
         expect(`${loc.origin}${loc.pathname}`).toBe(`${ISSUER}/logout`);
         expect(loc.searchParams.get("return")).toBe("https://www.test/");
      }
   });
});

describe("prompt handling", () => {
   const authorizeOf = async (path: string) => {
      const res = await makeWorker()(path);
      expect(res.status).toBe(302);
      return { res, url: new URL(res.headers.get("location")!) };
   };

   it("?prompt=login (add account) and ?prompt=none (silent re-auth after a switch) are forwarded", async () => {
      expect((await authorizeOf("/sso/login?prompt=login")).url.searchParams.get("prompt")).toBe("login");
      expect((await authorizeOf("/sso/login?prompt=none")).url.searchParams.get("prompt")).toBe("none");
   });

   it("no other prompt value is ever forwarded", async () => {
      for (const p of ["select_account", "consent", "login none", "LOGIN", ""]) {
         expect((await authorizeOf(`/sso/login?prompt=${encodeURIComponent(p)}`)).url.searchParams.has("prompt"), p).toBe(false);
      }
   });

   it("login_required after prompt=none falls back to the normal sign-in (no prompt), keeping the return path", async () => {
      const f = makeWorker();
      const { res: login, url } = await authorizeOf("/sso/login?prompt=none&return=%2Fpicker");
      const cb = await f(`/sso/callback?error=login_required&state=${url.searchParams.get("state")}`, { headers: { cookie: cookiesOf(login) } });
      expect(cb.status).toBe(302);
      expect(cb.headers.get("location")).toBe("/sso/login?return=%2Fpicker");
      // The fallback is a plain sign-in: auth shows its form, so there is no prompt=none loop.
      const again = await f(cb.headers.get("location")!);
      expect(new URL(again.headers.get("location")!).searchParams.has("prompt")).toBe(false);
   });

   it("any error on the normal or add-account sign-in shows the sign-in failed page", async () => {
      for (const path of ["/sso/login", "/sso/login?prompt=login"]) {
         const f = makeWorker();
         const login = await f(path);
         const state = new URL(login.headers.get("location")!).searchParams.get("state");
         const cb = await f(`/sso/callback?error=access_denied&state=${state}`, { headers: { cookie: cookiesOf(login) } });
         expect(cb.status, path).toBe(400);
         expect(await cb.text()).toContain("Sign-in failed");
      }
   });

   it("an error after prompt=none with a wrong or missing state does not redirect", async () => {
      const f = makeWorker();
      const login = await f("/sso/login?prompt=none");
      expect((await f("/sso/callback?error=login_required&state=nope", { headers: { cookie: cookiesOf(login) } })).status).toBe(400);
      expect((await f("/sso/callback?error=login_required&state=x")).status).toBe(400);
   });

   it("callbackErrorRedirect only accepts a live prompt=none transaction with the matching state", () => {
      const tx = { s: "st", v: "v", r: "/data?x=1", e: 2000, p: "none" as const };
      expect(callbackErrorRedirect(tx, "st", 1000)).toBe("/sso/login?return=%2Fdata%3Fx%3D1");
      expect(callbackErrorRedirect(tx, "st", 3000)).toBeNull();
      expect(callbackErrorRedirect(tx, "other", 1000)).toBeNull();
      expect(callbackErrorRedirect(tx, undefined, 1000)).toBeNull();
      expect(callbackErrorRedirect({ ...tx, p: "login" }, "st", 1000)).toBeNull();
      expect(callbackErrorRedirect({ ...tx, p: undefined }, "st", 1000)).toBeNull();
      expect(callbackErrorRedirect(null, "st", 1000)).toBeNull();
   });

   it("switching to an account without access drops the CMS session held for the previous account", async () => {
      const admin = await signIn(["Admin"], { id: "sw-admin", email: "sw-admin@example.com" });
      const cookie = cookiesOf(admin.callback);
      expect(cookie).toMatch(/auth=/);
      const token = await accessToken({ id: "sw-viewer", email: "sw-viewer@example.com", roles: ["Viewer"] });
      const f = makeWorker((url) => (url.toString() === `${ISSUER}/token` ? Response.json({ access_token: token }) : new Response("no", { status: 404 })));
      const login = await f("/sso/login?prompt=none", { headers: { cookie } });
      const state = new URL(login.headers.get("location")!).searchParams.get("state");
      const cb = await f(`/sso/callback?code=c&state=${state}`, { headers: { cookie: `${cookie}; ${cookiesOf(login)}` } });
      expect(cb.status).toBe(303);
      expect(cb.headers.get("location")).toBe("/sso/no-access");
      expect(cb.headers.getSetCookie().some((c) => c.startsWith("auth=") && /Max-Age=0|expires=Thu, 01 Jan 1970/i.test(c))).toBe(true);
   });
});

describe("account chooser", () => {
   it("the no-access page lists auth's accounts from the browser: switch, add account, sign out", async () => {
      const res = await makeWorker()("/sso/no-access");
      expect(res.status).toBe(403);
      const html = await res.text();
      expect(html).toContain('id="accounts-list"');
      expect(html).toContain('href="/sso/login?prompt=login&amp;return=%2F"');
      expect(html).toContain('href="/sso/logout"');
      expect(html).toContain('"auth":"https://auth.test"');
      expect(html).toContain('"/sso/login?prompt=none&return=%2F"');
      const csp = res.headers.get("content-security-policy")!;
      expect(csp).toContain("connect-src 'self' https://auth.test");
      expect(html).toContain(`<script nonce="${csp.match(/'nonce-([^']+)'/)![1]}">`);
   });

   it("/sso/accounts needs no CMS session and keeps only a safe return path", async () => {
      const f = makeWorker();
      const res = await f("/sso/accounts?return=%2Fpicker");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('href="/sso/login?prompt=login&amp;return=%2Fpicker"');
      expect(res.headers.get("content-security-policy")).toContain("connect-src 'self' https://auth.test");
      const evil = await (await f("/sso/accounts?return=https%3A%2F%2Fevil.example")).text();
      expect(evil).not.toContain("evil.example");
      expect(evil).toContain('href="/sso/login?prompt=login&amp;return=%2F"');
   });

   it("other pages keep connect-src 'self' only", async () => {
      const res = await makeWorker()("/sso/logged-out");
      expect(res.headers.get("content-security-policy")).toContain("connect-src 'self';");
   });
});
