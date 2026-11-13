import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { getBkndApp, resetBkndApp } from "../../src/app.ts";
import { createWorker } from "../../src/index.ts";
import type { Deps } from "../../src/types.ts";

export const ISSUER = "https://auth.test";
export const CLIENT = "test-client";
export const CMS = "https://cms.test";

const keys = await generateKeyPair("ES256");
const jwk = { ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
export const jwks = createLocalJWKSet({ keys: [jwk] });

/** `claims`: extra top-level claims (amr, auth_time). */
export async function accessToken(props: { id: string; email: string; roles?: string[]; passkey_deadline?: number }, claims: Record<string, unknown> = {}): Promise<string> {
   return new SignJWT({ ...claims, mode: "access", type: "user", properties: props })
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setSubject(`user:${props.id}`)
      .setIssuer(ISSUER)
      .setAudience(CLIENT)
      .setExpirationTime("10m")
      .sign(keys.privateKey);
}

export type Upstream = (url: URL, init?: RequestInit) => Response | Promise<Response>;

/** A Worker instance with the network replaced by `upstream` (auth /token, videos API). */
export function makeWorker(upstream: Upstream = () => new Response("unexpected", { status: 599 }), envOverride: Partial<typeof env> = {}) {
   resetBkndApp();
   const deps: Deps = {
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => upstream(new URL(String(input instanceof Request ? input.url : input)), init)) as typeof fetch,
      jwks: () => jwks,
      getApp: (c) => getBkndApp(c.env, c.executionCtx as ExecutionContext, c.req.raw, c.get("cfg")),
   };
   const app = createWorker(deps);
   return async (path: string, init: RequestInit = {}) => {
      const ctx = createExecutionContext();
      const res = await app.fetch(new Request(`${CMS}${path}`, { redirect: "manual", ...init }), { ...env, ...envOverride }, ctx);
      await waitOnExecutionContext(ctx);
      return res;
   };
}

export function cookiesOf(res: Response): string {
   return res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .filter((c) => !c.endsWith("="))
      .join("; ");
}

/** Runs /sso/login → /sso/callback with a token carrying `roles`; returns the callback response. */
export async function signIn(
   roles: string[] | undefined,
   who = { id: "u-1", email: "editor@example.com" },
   extra: { deadline?: number; amr?: string[]; returnPath?: string } = {},
) {
   const token = await accessToken(
      { ...who, roles, ...(extra.deadline !== undefined ? { passkey_deadline: extra.deadline } : {}) },
      extra.amr ? { amr: extra.amr, auth_time: Math.floor(Date.now() / 1000) } : {},
   );
   let tokenRequest: URLSearchParams | undefined;
   const fetchCms = makeWorker((url, init) => {
      if (url.toString() === `${ISSUER}/token`) {
         tokenRequest = new URLSearchParams(String(init?.body));
         return Response.json({ access_token: token, refresh_token: "r", expires_in: 600 });
      }
      return new Response("no", { status: 404 });
   });
   const login = await fetchCms(`/sso/login?return=${encodeURIComponent(extra.returnPath ?? "/data/entity/posts")}`);
   const authorize = new URL(login.headers.get("location")!);
   const callback = await fetchCms(`/sso/callback?code=the-code&state=${authorize.searchParams.get("state")}`, {
      headers: { cookie: cookiesOf(login) },
   });
   return { login, authorize, callback, tokenRequest, fetchCms };
}

export async function usersCount(): Promise<number> {
   const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
   return Number(row?.n ?? 0);
}
