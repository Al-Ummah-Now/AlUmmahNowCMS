import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { pkceChallenge } from "../../src/lib/pkce.ts";
import { CLIENT, CMS, cookiesOf, ISSUER, makeWorker, signIn, usersCount } from "./helpers.ts";

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
      expect(callback.status).toBe(403);
      const html = await callback.text();
      expect(html).toContain("No access");
      expect(callback.headers.getSetCookie().some((c) => c.startsWith("auth="))).toBe(false);
      expect(await usersCount()).toBe(before);
   });

   it("a user with no roles at all is denied too", async () => {
      const { callback } = await signIn(undefined, { id: "nobody", email: "nobody@example.com" });
      expect(callback.status).toBe(403);
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
});
