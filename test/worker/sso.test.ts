import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { pkceChallenge } from "../../src/lib/pkce.ts";
import { callbackErrorRedirect } from "../../src/routes/sso.ts";
import { accessToken, CLIENT, CMS, cookiesOf, ISSUER, makeWorker, signIn, usersCount } from "./helpers.ts";

describe("unauthenticated", () => {
   it("a staff screen redirects to /sso/login with the return path", async () => {
      const res = await makeWorker()("/posts?x=1");
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/sso/login?return=%2Fposts%3Fx%3D1");
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

   it("an Arabic page signs in on the Arabic sign-in page (auth reads ?lang= only)", async () => {
      const fromReturn = new URL((await makeWorker()("/sso/login?return=%2Fvideos%3Flang%3Dar")).headers.get("location")!);
      expect(fromReturn.searchParams.get("lang")).toBe("ar");
      const fromQuery = new URL((await makeWorker()("/sso/login?lang=ar&return=%2F")).headers.get("location")!);
      expect(fromQuery.searchParams.get("lang")).toBe("ar");
      const english = new URL((await makeWorker()("/sso/login?return=%2Fvideos%3Flang%3Den")).headers.get("location")!);
      expect(english.searchParams.has("lang")).toBe(false);
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

   it("the session opens the staff screens, with security headers and the account links", async () => {
      const { callback, fetchCms } = await signIn(["Moderator"], { id: "ed-ui", email: "ed-ui@example.com" });
      const res = await fetchCms("/", { headers: { cookie: cookiesOf(callback) } });
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('href="/sso/accounts?return=%2F"');
      expect(html).toContain('href="/sso/logout"');
      expect(html).toMatch(/<script type="module" src="\/admin-assets\/app\.[0-9a-f]{8}\.js" nonce=/);
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

   it("single sign-out ends a copy of the session cookie taken before it", async () => {
      const { callback, fetchCms } = await signIn(["Admin"], { id: "so-1", email: "so1@example.com" });
      const copied = cookiesOf(callback);
      expect((await fetchCms("/posts", { headers: { cookie: copied } })).status).toBe(200);
      // The front-channel hop arrives with the session cookie (top-level navigation, SameSite=Lax)
      const next = `${ISSUER}/logout?step=6&return=${encodeURIComponent("https://www.test/")}`;
      const out = await fetchCms(`/sso/logout?next=${encodeURIComponent(next)}`, { headers: { cookie: copied } });
      expect(out.status).toBe(302);
      // The copy is refused: the staff screen asks to sign in, the API answers 401
      const screen = await fetchCms("/posts", { headers: { cookie: copied } });
      expect(screen.status).toBe(302);
      expect(screen.headers.get("location")).toBe("/sso/login?return=%2Fposts");
      expect((await fetchCms("/picker/api/search?kind=video&q=ab", { headers: { cookie: copied } })).status).toBe(401);
      // bknd's API too: the copy is a guest there (no data permissions), not the signed-out account
      expect((await fetchCms("/api/data/entity/posts", { headers: { cookie: copied } })).status).toBe(403);
   });

   it("a sign-out ends only that browser's session: the account's other browsers stay signed in", async () => {
      const laptop = await signIn(["Admin"], { id: "so-3", email: "so3@example.com" });
      const phone = await signIn(["Admin"], { id: "so-3", email: "so3@example.com" });
      const laptopCookie = cookiesOf(laptop.callback);
      const phoneCookie = cookiesOf(phone.callback);
      await phone.fetchCms("/sso/logout", { headers: { cookie: phoneCookie } });
      // The phone's session (and any copy of it) is over ...
      expect((await phone.fetchCms("/posts", { headers: { cookie: phoneCookie } })).status).toBe(302);
      // ... the laptop's is not, even though it is the same account and was issued earlier
      expect((await laptop.fetchCms("/posts", { headers: { cookie: laptopCookie } })).status).toBe(200);
   });

   it("nothing is bound to the browser: the same session works from another User-Agent", async () => {
      const { callback, fetchCms } = await signIn(["Admin"], { id: "so-4", email: "so4@example.com" });
      const cookie = cookiesOf(callback);
      for (const ua of ["Mozilla/5.0 (Macintosh) Chrome/150.0", "Mozilla/5.0 (iPhone) Mobile Safari/19.0", ""]) {
         expect((await fetchCms("/posts", { headers: { cookie, "user-agent": ua } })).status, ua).toBe(200);
      }
   });

   it("signing in again after a sign-out gives a working session", async () => {
      const first = await signIn(["Admin"], { id: "so-2", email: "so2@example.com" });
      await first.fetchCms("/sso/logout", { headers: { cookie: cookiesOf(first.callback) } });
      // A later second: the new session's iat is after the sign-out
      await new Promise((r) => setTimeout(r, 1100));
      const again = await signIn(["Admin"], { id: "so-2", email: "so2@example.com" });
      expect((await again.fetchCms("/posts", { headers: { cookie: cookiesOf(again.callback) } })).status).toBe(200);
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

describe("the previous CMS session never survives an unfinished sign-in", () => {
   const cleared = (res: Response) => res.headers.getSetCookie().some((c) => c.startsWith("auth=") && /Max-Age=0|expires=Thu, 01 Jan 1970/i.test(c));
   const adminSession = async () => cookiesOf((await signIn(["Admin"], { id: "keep-admin", email: "keep-admin@example.com" })).callback);
   const startLogin = async (f: ReturnType<typeof makeWorker>, session: string, query = "") => {
      const login = await f(`/sso/login${query}`, { headers: { cookie: session } });
      return { login, state: new URL(login.headers.get("location")!).searchParams.get("state")!, cookie: `${session}; ${cookiesOf(login)}` };
   };

   it("/sso/login?prompt=none and ?prompt=login clear the session before going to auth; the normal sign-in does not", async () => {
      const session = await adminSession();
      const f = makeWorker();
      expect(cleared((await startLogin(f, session, "?prompt=none")).login)).toBe(true);
      expect(cleared((await startLogin(f, session, "?prompt=login")).login)).toBe(true);
      expect(cleared((await startLogin(f, session)).login)).toBe(false);
      expect(cleared((await startLogin(f, session, "?prompt=select_account")).login)).toBe(false);
   });

   it("an auth error on a flow this browser started clears it (also before the prompt=none fallback)", async () => {
      const session = await adminSession();
      const f = makeWorker();
      const normal = await startLogin(f, session);
      const res = await f(`/sso/callback?error=access_denied&state=${normal.state}`, { headers: { cookie: normal.cookie } });
      expect(res.status).toBe(400);
      expect(cleared(res)).toBe(true);
      // prompt=none: simulate a browser that still carries the old session cookie at the callback.
      const silent = await startLogin(f, session, "?prompt=none");
      const fb = await f(`/sso/callback?error=login_required&state=${silent.state}`, { headers: { cookie: silent.cookie } });
      expect(fb.status).toBe(302);
      expect(cleared(fb)).toBe(true);
   });

   it("a state mismatch on a flow this browser started clears it", async () => {
      const session = await adminSession();
      const f = makeWorker();
      const { cookie } = await startLogin(f, session);
      const res = await f("/sso/callback?code=c&state=wrong", { headers: { cookie } });
      expect(res.status).toBe(400);
      expect(cleared(res)).toBe(true);
   });

   it("a failed token exchange or a rejected token clears it", async () => {
      const session = await adminSession();
      for (const upstream of [() => new Response("no", { status: 400 }), () => Response.json({ access_token: "not.a.jwt" })]) {
         const f = makeWorker(upstream);
         const { state, cookie } = await startLogin(f, session);
         const res = await f(`/sso/callback?code=c&state=${state}`, { headers: { cookie } });
         expect(res.status).toBeGreaterThanOrEqual(400);
         expect(cleared(res)).toBe(true);
      }
   });

   it("an unsolicited callback (no tx cookie: not started by this browser) cannot sign the user out", async () => {
      const session = await adminSession();
      const f = makeWorker();
      for (const path of ["/sso/callback?error=login_required&state=x", "/sso/callback?code=c&state=x", "/sso/callback"]) {
         const res = await f(path, { headers: { cookie: session } });
         expect(res.status, path).toBe(400);
         expect(cleared(res), path).toBe(false);
      }
      // The session still opens the admin UI.
      expect((await f("/", { headers: { cookie: session } })).status).toBe(200);
   });
});
