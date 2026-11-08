/**
 * SSO (SPEC §3): /sso/login → auth /authorize (PKCE S256) → /sso/callback → bknd session cookie.
 */
import { Hono } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { pickLang } from "../lib/i18n.ts";
import { buildAuthorizeUrl, exchangeCode, OidcError, verifyAccessToken } from "../lib/oidc.ts";
import { statusPage } from "../lib/pages.ts";
import { createPkce, randomToken } from "../lib/pkce.ts";
import { safeReturnPath } from "../lib/return-path.ts";
import { mapRoles } from "../lib/roles.ts";
import { upsertSsoUser } from "../lib/users.ts";
import type { AppEnv, Ctx, Deps } from "../types.ts";

const TX_TTL_SECONDS = 600;

export const txCookieName = (secure: boolean) => (secure ? "__Host-cms_sso" : "cms_sso");

interface Tx {
   s: string; // state
   v: string; // PKCE verifier
   r: string; // return path
   e: number; // expiry (epoch seconds)
}

export function renderStatus(c: Ctx, kind: Parameters<typeof statusPage>[0]["kind"], status: 200 | 400 | 403 | 404 | 500 | 502 | 503) {
   const cfg = c.get("cfg");
   const url = new URL(c.req.url);
   const html = statusPage({
      kind,
      lang: pickLang(url, c.req.header("Accept-Language") ?? null),
      nonce: c.get("nonce"),
      wwwUrl: cfg?.wwwUrl ?? "https://www.alummahnow.net",
      path: url.pathname,
   });
   return c.html(html, status);
}

function timingSafeEqual(a: string, b: string): boolean {
   if (a.length !== b.length) return false;
   let diff = 0;
   for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
   return diff === 0;
}

export function ssoRoutes(deps: Deps): Hono<AppEnv> {
   const sso = new Hono<AppEnv>();

   sso.get("/login", async (c) => {
      const cfg = c.get("cfg");
      const secure = !cfg.isLocal;
      const { verifier, challenge } = await createPkce();
      const tx: Tx = {
         s: randomToken(24),
         v: verifier,
         r: safeReturnPath(c.req.query("return")),
         e: Math.floor(Date.now() / 1000) + TX_TTL_SECONDS,
      };
      await setSignedCookie(c, txCookieName(secure), btoa(JSON.stringify(tx)), cfg.jwtSecret, {
         path: "/",
         httpOnly: true,
         secure,
         sameSite: "Lax",
         maxAge: TX_TTL_SECONDS,
      });
      return c.redirect(
         buildAuthorizeUrl({
            issuer: cfg.issuer,
            clientId: cfg.clientId,
            redirectUri: cfg.redirectUri,
            state: tx.s,
            codeChallenge: challenge,
         }),
         302,
      );
   });

   sso.get("/callback", async (c) => {
      const cfg = c.get("cfg");
      const secure = !cfg.isLocal;
      const name = txCookieName(secure);
      const raw = await getSignedCookie(c, cfg.jwtSecret, name);
      deleteCookie(c, name, { path: "/", secure });

      let tx: Tx | null;
      try {
         tx = raw ? (JSON.parse(atob(raw)) as Tx) : null;
      } catch {
         tx = null;
      }
      const code = c.req.query("code");
      const state = c.req.query("state");
      if (c.req.query("error") || !tx || !code || !state || tx.e < Date.now() / 1000 || !timingSafeEqual(tx.s, state)) {
         return renderStatus(c, "sign_in_failed", 400);
      }

      let identity;
      try {
         const tokens = await exchangeCode(
            { issuer: cfg.issuer, clientId: cfg.clientId, redirectUri: cfg.redirectUri, code, codeVerifier: tx.v },
            deps.fetch,
         );
         identity = await verifyAccessToken(tokens.access_token, {
            issuer: cfg.issuer,
            clientId: cfg.clientId,
            jwks: deps.jwks?.(cfg.issuer),
         });
      } catch (error) {
         console.warn("sso callback rejected", error instanceof OidcError ? error.kind : "error", (error as Error).message);
         return renderStatus(c, "sign_in_failed", error instanceof OidcError && error.kind === "invalid_token" ? 403 : 502);
      }

      const role = mapRoles(identity.roles);
      if (!role) {
         // No allowed role: show the 403 page and create nothing (no user row, no session).
         return renderStatus(c, "no_access", 403);
      }

      const user = await upsertSsoUser(c.env.DB, identity, role);
      const app = await deps.getApp(c);
      const authenticator = app.module.auth.authenticator;
      const token = await authenticator.jwt({ id: user.id, email: user.email, role: user.role, strategy: "sso" });
      const headers = await authenticator.getAuthCookieHeader(token, new Headers());
      for (const cookie of headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
      return c.redirect(tx.r, 302);
   });

   sso.get("/logout", async (c) => {
      const cfg = c.get("cfg");
      const app = await deps.getApp(c);
      const headers = await app.module.auth.authenticator.removeAuthCookieHeader(new Headers());
      for (const cookie of headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
      const target = new URL(`${cfg.issuer}/logout`);
      target.searchParams.set("return", `${cfg.wwwUrl}/`);
      return c.redirect(target.toString(), 302);
   });

   sso.get("/logged-out", (c) => renderStatus(c, "logged_out", 200));

   return sso;
}
