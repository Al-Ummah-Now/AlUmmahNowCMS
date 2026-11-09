import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { upsertSsoUser } from "../../src/lib/users.ts";
import { accessToken, cookiesOf, ISSUER, makeWorker } from "./helpers.ts";

const rows = (sub: string) =>
   env.DB.prepare("SELECT id, sso_sub, email, role, strategy FROM users WHERE sso_sub = ?1").bind(sub).all<Record<string, unknown>>();

describe("upsertSsoUser under concurrency", () => {
   beforeEach(async () => {
      await env.DB.prepare("DELETE FROM users").run();
   });

   it("200 parallel first sign-ins for one sub all succeed and leave exactly one row", async () => {
      const N = 200;
      const out = await Promise.allSettled(
         Array.from({ length: N }, (_, i) => upsertSsoUser(env.DB, { sub: "new-sub", email: "new@example.com" }, i % 2 ? "admin" : "editor")),
      );
      expect(out.filter((r) => r.status === "rejected")).toEqual([]);
      const ids = new Set(out.map((r) => (r as PromiseFulfilledResult<{ id: number }>).value.id));
      expect(ids.size).toBe(1);
      const { results } = await rows("new-sub");
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ email: "new@example.com", strategy: "sso" });
      expect(["admin", "editor"]).toContain(results[0].role);
   });

   it("parallel sign-ins claim one legacy email-only row instead of inserting", async () => {
      const legacy = await env.DB.prepare("INSERT INTO users (email, strategy, role) VALUES ('old@example.com', 'password', 'editor') RETURNING id").first<{ id: number }>();
      const out = await Promise.all(Array.from({ length: 100 }, () => upsertSsoUser(env.DB, { sub: "old-sub", email: "old@example.com" }, "admin")));
      expect(new Set(out.map((u) => u.id))).toEqual(new Set([legacy!.id]));
      const all = await env.DB.prepare("SELECT id, sso_sub, email, role, strategy, strategy_value FROM users").all();
      expect(all.results).toEqual([{ id: legacy!.id, sso_sub: "old-sub", email: "old@example.com", role: "admin", strategy: "sso", strategy_value: null }]);
   });

   it("a re-created auth account takes the email from the old row, even under parallel sign-ins of both", async () => {
      await upsertSsoUser(env.DB, { sub: "sub-a", email: "same@example.com" }, "editor");
      await Promise.all(
         Array.from({ length: 50 }, (_, i) => upsertSsoUser(env.DB, { sub: i % 5 ? "sub-b" : "sub-a", email: i % 5 ? "same@example.com" : "a2@example.com" }, "editor")),
      );
      const all = await env.DB.prepare("SELECT sso_sub, email FROM users ORDER BY sso_sub").all();
      expect(all.results).toEqual([
         { sso_sub: "sub-a", email: "a2@example.com" },
         { sso_sub: "sub-b", email: "same@example.com" },
      ]);
   });

   it("parallel /sso/callback requests for a brand-new user all sign in (no 500)", async () => {
      const token = await accessToken({ id: "fresh-1", email: "fresh@example.com", roles: ["Admin"] });
      const fetchCms = makeWorker((url) =>
         url.toString() === `${ISSUER}/token` ? Response.json({ access_token: token, refresh_token: "r", expires_in: 600 }) : new Response("no", { status: 404 }),
      );
      const N = 30;
      const logins = await Promise.all(Array.from({ length: N }, () => fetchCms("/sso/login?return=%2F")));
      const callbacks = await Promise.all(
         logins.map((login) => {
            const state = new URL(login.headers.get("location")!).searchParams.get("state");
            return fetchCms(`/sso/callback?code=c&state=${state}`, { headers: { cookie: cookiesOf(login) } });
         }),
      );
      for (const res of callbacks) {
         expect(res.status).toBe(302);
         expect(res.headers.get("location")).toBe("/");
         expect(res.headers.getSetCookie().some((c) => c.startsWith("auth="))).toBe(true);
      }
      expect((await rows("fresh-1")).results).toHaveLength(1);
   });
});
