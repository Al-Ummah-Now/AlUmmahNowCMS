/**
 * SSO (SPEC §3): /sso/login → auth /authorize (PKCE S256) → /sso/callback → bknd session cookie.
 */
import { Hono } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { pickLang } from "../lib/i18n.ts";
import { buildAuthorizeUrl, exchangeCode, OidcError, parsePrompt, verifyAccessToken, type Prompt } from "../lib/oidc.ts";
import { statusPage } from "../lib/pages.ts";
import { createPkce, randomToken } from "../lib/pkce.ts";
import { safeReturnPath } from "../lib/return-path.ts";
import { mapRoles } from "../lib/roles.ts";
import { upsertSsoUser } from "../lib/users.ts";
import { errText, log } from "../lib/log.ts";
import { recordSignOut } from "../lib/sign-outs.ts";
import type { AppEnv, AuthUser, Ctx, Deps } from "../types.ts";

const TX_TTL_SECONDS = 600;

export const txCookieName = (secure: boolean) => (secure ? "__Host-cms_sso" : "cms_sso");

export interface Tx {
   s: string; // state
   v: string; // PKCE verifier
   r: string; // return path
   e: number; // expiry (epoch seconds)
   p?: Prompt; // prompt sent to /authorize (absent on the normal sign-in)
}

export function renderStatus(
   c: Ctx,
   kind: Parameters<typeof statusPage>[0]["kind"],
   status: 200 | 400 | 403 | 404 | 500 | 502 | 503,
   accounts?: { returnPath: string },
) {
   const cfg = c.get("cfg");
   const url = new URL(c.req.url);
   const html = statusPage({
      kind,
      lang: pickLang(url, c.req.header("Accept-Language") ?? null),
      nonce: c.get("nonce"),
      wwwUrl: cfg?.wwwUrl ?? "https://www.alummahnow.net",
      path: url.pathname,
      accounts: accounts && cfg ? { issuer: cfg.issuer, returnPath: accounts.returnPath } : undefined,
   });
   return c.html(html, status);
}

/**
 * Where to go when auth answers the callback with `?error=`.
 *
 * A failed SILENT attempt (prompt=none, sent after an account switch) — typically
 * `login_required` because the browser session is gone — falls back to the normal sign-in, which
 * sends no prompt: auth then shows its sign-in form (or signs the active account in). That cannot
 * loop, because the fallback never sends prompt=none again. The state must still match, so a
 * forged error link can only ever bounce a browser to our own login.
 *
 * Any other error (the user cancelled the form, a misconfigured client, …) → null: the
 * "Sign-in failed" page with a "Sign in again" button.
 */
export function callbackErrorRedirect(tx: Tx | null, state: string | undefined, nowSeconds = Date.now() / 1000): string | null {
   if (!tx || tx.p !== "none" || !state || tx.e < nowSeconds || !timingSafeEqual(tx.s, state)) return null;
   return `/sso/login?return=${encodeURIComponent(tx.r)}`;
}

/** Clears a bknd session the browser already holds (no-op without one). */
async function clearSession(c: Ctx, deps: Deps): Promise<void> {
   if (!/(?:^|;\s*)auth=/.test(c.req.header("Cookie") ?? "")) return;
   const app = await deps.getApp(c);
   const headers = await app.module.auth.authenticator.removeAuthCookieHeader(new Headers());
   for (const cookie of headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
}

function timingSafeEqual(a: string, b: string): boolean {
   if (a.length !== b.length) return false;
   let diff = 0;
   for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
   return diff === 0;
}

export function ssoRoutes(deps: Deps): Hono<AppEnv> {
   const sso = new Hono<AppEnv>();

   // Normal sign-in: NO prompt, so auth signs the browser's active account in silently (or shows
   // its form when there is no browser session). `?prompt=login` = add an account; `?prompt=none`
   // = silent re-authorization after a switch. Nothing else is ever forwarded.
   sso.get("/login", async (c) => {
      const cfg = c.get("cfg");
      const secure = !cfg.isLocal;
      const { verifier, challenge } = await createPkce();
      const prompt = parsePrompt(c.req.query("prompt"));
      const tx: Tx = {
         s: randomToken(24),
         v: verifier,
         r: safeReturnPath(c.req.query("return")),
         e: Math.floor(Date.now() / 1000) + TX_TTL_SECONDS,
         ...(prompt ? { p: prompt } : {}),
      };
      // A switch / add account / silent re-auth replaces the signed-in identity: drop the current
      // CMS session first, so an unfinished flow can never leave the previous account signed in.
      if (prompt) await clearSession(c, deps);
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
            prompt,
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
      // Every path below that does not end in a NEW session drops the CMS session the browser
      // holds, so the CMS never keeps acting as an earlier account after the user started a new
      // sign-in (auth may already have switched its active account). Only when this browser
      // started the flow (it holds our signed tx cookie, which a third party cannot plant and
      // which this request consumes): an unsolicited/forged callback cannot sign anyone out.
      const failed = async () => {
         if (tx) await clearSession(c, deps);
      };
      if (c.req.query("error")) {
         await failed();
         const fallback = callbackErrorRedirect(tx, state);
         if (fallback) return c.redirect(fallback, 302);
         return renderStatus(c, "sign_in_failed", 400);
      }
      if (!tx || !code || !state || tx.e < Date.now() / 1000 || !timingSafeEqual(tx.s, state)) {
         await failed();
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
         await failed();
         console.warn("sso callback rejected", error instanceof OidcError ? error.kind : "error", (error as Error).message);
         return renderStatus(c, "sign_in_failed", error instanceof OidcError && error.kind === "invalid_token" ? 403 : 502);
      }

      const role = mapRoles(identity.roles);
      if (!role) {
         // No allowed role: show the 403 page and create nothing (no user row, no session).
         // A CMS session the browser still holds for ANOTHER account (the user just switched to
         // this one) is dropped too, so the CMS never keeps acting as an account auth no longer
         // has active. Redirect to a stable URL so a reload does not replay the spent code.
         await clearSession(c, deps);
         return c.redirect("/sso/no-access", 303);
      }

      // The auth tokens are not kept: the CMS only needs the identity and roles at sign-in time.
      // Everything after this runs on the bknd session (SESSION_TTL_SECONDS); the picker calls the
      // PUBLIC videos API server-side without any user token (src/lib/videos.ts). So there is no
      // access token to refresh. When the bknd session ends, the gate sends the browser through
      // /sso/login again, which is silent while auth still has a browser session.
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
      // End every session of this account, not only this cookie (a copy of it stays signed)
      const signedIn = (await app.module.auth.authenticator.resolveAuthFromRequest(c.req.raw)) as AuthUser | undefined;
      if (signedIn?.id !== undefined) {
         try {
            await recordSignOut(c.env.DB, signedIn.id);
         } catch (error) {
            log.error("sso logout: could not record the sign-out", { userId: signedIn.id, error: errText(error) });
         }
      }
      const headers = await app.module.auth.authenticator.removeAuthCookieHeader(new Headers());
      for (const cookie of headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
      // Front-channel hop of auth's single sign-out: auth calls
      // /sso/logout?next=<auth>/logout?step=..., we clear our session and hand
      // back. `next` is followed only when it points at the auth server itself.
      const next = frontChannelNext(c.req.query("next"), cfg.issuer);
      if (next) return c.redirect(next, 302);
      const target = new URL(`${cfg.issuer}/logout`);
      target.searchParams.set("return", `${cfg.wwwUrl}/`);
      return c.redirect(target.toString(), 302);
   });

   sso.get("/no-access", (c) => renderStatus(c, "no_access", 403, { returnPath: "/" }));
   // Account chooser (linked from the picker and the admin UI). Needs no CMS session: the list
   // is read by the browser straight from auth.
   sso.get("/accounts", (c) => renderStatus(c, "accounts", 200, { returnPath: safeReturnPath(c.req.query("return")) }));
   sso.get("/logged-out", (c) => renderStatus(c, "logged_out", 200));

   return sso;
}

/** `next` for a front-channel logout hop: only an https URL on the auth issuer's origin. */
export function frontChannelNext(next: string | undefined, issuer: string): string | null {
   if (!next) return null;
   try {
      const url = new URL(next);
      const auth = new URL(issuer);
      if (url.origin !== auth.origin || url.pathname !== "/logout") return null;
      return url.toString();
   } catch {
      return null;
   }
}
