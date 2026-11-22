/**
 * SSO (SPEC §3): /sso/login → auth /authorize (PKCE S256) → /sso/callback → bknd session cookie.
 */
import { Hono } from "hono";
import { deleteCookie, getCookie, getSignedCookie, setCookie, setSignedCookie } from "hono/cookie";
import { pickLang } from "../lib/i18n.ts";
import { buildAuthorizeUrl, exchangeCode, signInLang, OidcError, parsePrompt, verifyAccessToken, type Prompt } from "../lib/oidc.ts";
import { passkeyNeededPage, statusPage } from "../lib/pages.ts";
import { STRINGS } from "../lib/i18n.ts";
import { esc } from "../lib/html.ts";
import { formatNumber } from "../lib/format.ts";
import { accountsSection } from "../lib/accounts.ts";
import { tabIconLinks } from "../lib/app-icons.ts";
import { resolvePrefs } from "../admin/prefs.ts";
import { assetUrls } from "../admin/assets.ts";
import { stringsFor } from "../admin/ui/layout.tsx";
import { GatePage, type GateContent } from "../admin/ui/gate.tsx";
import { createPkce, randomToken } from "../lib/pkce.ts";
import { safeReturnPath } from "../lib/return-path.ts";
import { mapRoles } from "../lib/roles.ts";
import { passkeyNeededPath, passkeySetupUrl, passkeySignInPath, passkeyVerdict } from "../lib/passkeys.ts";
import { upsertSsoUser } from "../lib/users.ts";
import { accountName, fetchAccountProfile } from "../lib/account-name.ts";
import { ensureScholar } from "../lib/scholars/profiles.ts";
import { ownedChannels } from "../lib/scholars/videos-internal.ts";
import { errText, log } from "../lib/log.ts";
import { SESSION_TTL_SECONDS } from "../bknd-config.ts";
import { newSessionId, recordSignOut, revokeSession } from "../lib/sign-outs.ts";
import type { AppEnv, AuthUser, Ctx, Deps } from "../types.ts";

const TX_TTL_SECONDS = 600;

export const txCookieName = (secure: boolean) => (secure ? "__Host-cms_sso" : "cms_sso");

/**
 * The refusal marker: set by /sso/callback when the signed-in account has no CMS role, read by
 * /sso/no-access. It lives 2 minutes (the page's language and Light/Dark links reload it) and any
 * new sign-in (/sso/login: Switch, Active, Sign in to another account) clears it. Without it,
 * /sso/no-access does not show the page: it signs in again (silent while auth has a browser
 * session). So reloading the page later, going back to it or reopening an old tab retries the
 * sign-in with auth's CURRENT account instead of showing a stale "No access" (2026-11-14: the
 * owner reloaded a tab from a refusal of their other account a day earlier). It cannot loop: the
 * page only shows after a refusal by the callback.
 */
/** The part of an address after the last @ (logs carry the domain, never the address). */
export const emailDomain = (email: string): string => (email.includes("@") ? email.slice(email.lastIndexOf("@") + 1).toLowerCase().slice(0, 100) : "none");

export const deniedCookieName = (secure: boolean) => (secure ? "__Host-cms_denied" : "cms_denied");
const DENIED_TTL_SECONDS = 120;

interface Denied {
   m: string; // the refused account's email
   r: string; // the return path of the refused sign-in
   e: number; // expiry (epoch seconds)
}

export interface Tx {
   s: string; // state
   v: string; // PKCE verifier
   r: string; // return path
   e: number; // expiry (epoch seconds)
   p?: Prompt; // prompt sent to /authorize (absent on the normal sign-in)
}

/**
 * Language and Light / Dark for the plain pages (status, passkey needed), as on the staff screens
 * (src/admin/prefs.ts) but with no theme lookup: `?lang=` / `?mode=` are saved per browser
 * (cms_lang, cms_mode), else the saved choice, else the browser's language and the device's mode.
 */
export function plainPrefs(c: Ctx): { lang: "en" | "ar"; mode: "light" | "dark" | null } {
   const url = new URL(c.req.url);
   const opts = { path: "/", sameSite: "Lax" as const, secure: url.protocol === "https:", httpOnly: true, maxAge: 365 * 24 * 60 * 60 };
   const qLang = url.searchParams.get("lang");
   if (qLang === "ar" || qLang === "en") setCookie(c, "cms_lang", qLang, opts);
   const savedLang = getCookie(c, "cms_lang");
   const lang = qLang === "ar" || qLang === "en" ? qLang : savedLang === "ar" || savedLang === "en" ? savedLang : pickLang(url, c.req.header("Accept-Language") ?? null);
   const qMode = url.searchParams.get("mode");
   if (qMode === "light" || qMode === "dark") setCookie(c, "cms_mode", qMode, opts);
   const savedMode = getCookie(c, "cms_mode");
   const mode = qMode === "light" || qMode === "dark" ? qMode : savedMode === "light" || savedMode === "dark" ? savedMode : null;
   return { lang, mode };
}

export function renderStatus(
   c: Ctx,
   kind: Parameters<typeof statusPage>[0]["kind"],
   status: 200 | 400 | 403 | 404 | 500 | 502 | 503,
   accounts?: { returnPath: string },
   /** no_access: the refused account's email, named on the page. */
   account?: string,
) {
   const cfg = c.get("cfg");
   const url = new URL(c.req.url);
   const { lang, mode } = plainPrefs(c);
   const html = statusPage({
      kind,
      lang,
      mode,
      environment: c.env.ENVIRONMENT,
      nonce: c.get("nonce"),
      wwwUrl: cfg?.wwwUrl ?? "https://www.alummahnow.net",
      path: url.pathname,
      accounts: accounts && cfg ? { issuer: cfg.issuer, returnPath: accounts.returnPath } : undefined,
      account,
   });
   return c.html(html, status);
}

/** The family's lucide shapes (monorepo ERROR_PAGE_ICONS). */
const btnIcon = (paths: string) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
const FAMILY_BUTTON_ICONS = {
   home: btnIcon('<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
   retry: btnIcon('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
   back: btnIcon('<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>').replace("<svg ", '<svg data-icon="back" '),
};
const FAMILY_ICONS = {
   notFound: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/><circle cx="12" cy="12" r="10"/></svg>',
   alert: '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
};

/**
 * The family's error page (404, 500, 503) in the site theme with the shared header; if even that fails
 * (the theme lookup is what broke), the plain status page. Never a stack or the error's own text.
 */
export async function renderErrorStatus(c: Ctx, kind: FamilyKind, status: 404 | 500 | 503): Promise<Response> {
   try {
      return await renderGate(c, fetch, kind, status);
   } catch (error) {
      log.warn("themed error page failed; plain page instead", { kind, error: errText(error) });
      return renderStatus(c, kind === "not_found" ? "not_found" : "error", status);
   }
}

export type GateKind = "no_access" | "accounts" | "logged_out" | "sign_in_failed" | FamilyKind;
/** The error-page family (wiki guides/error-pages.md): an unknown page, a server error, the CMS unavailable. */
export type FamilyKind = "not_found" | "error" | "unavailable";

/**
 * The themed version of the CMS's own pages (src/admin/ui/gate.tsx): the site theme, Light/Dark and
 * en/ar like the staff screens. `account` (No access) names the refused account.
 */
export async function renderGate(
   c: Ctx,
   fetcher: typeof fetch,
   kind: GateKind,
   status: 200 | 400 | 403 | 404 | 500 | 502 | 503,
   o: { accounts?: { returnPath: string }; account?: string } = {},
) {
   const cfg = c.get("cfg");
   const prefs = await resolvePrefs(c, fetcher);
   const t = STRINGS[prefs.lang];
   const admin = stringsFor(prefs.lang);
   const www = `${cfg?.wwwUrl ?? "https://www.alummahnow.net"}/${prefs.lang}/`;
   const chooser = o.accounts && cfg ? accountsSection({ lang: prefs.lang, issuer: cfg.issuer, returnPath: o.accounts.returnPath, hint: kind === "no_access" }) : undefined;
   const content: Record<Exclude<GateKind, FamilyKind>, Omit<GateContent, "chooser" | "testId">> = {
      no_access: {
         icon: "alert",
         title: t.noAccessTitle,
         body: t.noAccessBody,
         leadHtml: o.account ? esc(t.noAccessAccount).replace("{email}", `<bdi><strong>${esc(o.account)}</strong></bdi>`) : undefined,
         // Sign out lives in the account chooser below ("Sign out of all accounts").
         actionsHtml: `<a class="btn primary" href="${esc(www)}">${esc(t.backToSite)}</a>${chooser ? "" : ` <a class="btn" href="/sso/logout">${esc(t.signOut)}</a>`}`,
      },
      accounts: {
         icon: "users",
         title: t.accountsTitle,
         body: t.accountsBody,
         actionsHtml: `<a class="btn primary" href="${esc(o.accounts?.returnPath ?? "/")}">${esc(t.backToCms)}</a>`,
      },
      logged_out: {
         icon: "logout",
         title: t.loggedOutTitle,
         body: t.loggedOutBody,
         actionsHtml: `<a class="btn primary" href="/sso/login">${esc(t.signInAgain)}</a> <a class="btn" href="${esc(www)}">${esc(t.backToSite)}</a>`,
      },
      sign_in_failed: {
         icon: "alert",
         title: t.signInFailedTitle,
         body: t.signInFailedBody,
         actionsHtml: `<a class="btn primary" href="/sso/login">${esc(t.signInAgain)}</a> <a class="btn" href="${esc(www)}">${esc(t.backToSite)}</a>`,
      },
   };
   const url = new URL(c.req.url);
   const code = (n: number) => t.errorCode.replace("{code}", formatNumber(n, prefs.lang, { useGrouping: false }));
   const help = `${esc(t.needHelp)} <a href="${esc(`${cfg?.wwwUrl ?? "https://www.alummahnow.net"}/${prefs.lang}/contact`)}">${esc(t.contactUs)}</a>`;
   const family = (status: number, icon: "notFound" | "alert", title: string) => ({ status, codeLabel: code(status), pageTitle: t.pageTitle.replace("{title}", title), iconSvg: FAMILY_ICONS[icon], helpHtml: help, backLabel: t.goBack, backIconSvg: FAMILY_BUTTON_ICONS.back });
   const retry = `<a class="ep-btn ep-btn-primary" href="${esc(`/${url.pathname.replace(/^[/\\]+/, "")}${url.search}`)}">${FAMILY_BUTTON_ICONS.retry}<span>${esc(t.tryAgain)}</span></a>`;
   const home = (primary: boolean) => `<a class="ep-btn ${primary ? "ep-btn-primary" : "ep-btn-secondary"}" href="/">${FAMILY_BUTTON_ICONS.home}<span>${esc(t.goHome)}</span></a>`;
   const familyContent: Record<FamilyKind, Omit<GateContent, "chooser" | "testId">> = {
      not_found: { icon: "alert", title: t.notFoundTitle, body: t.notFoundBody, actionsHtml: home(true), family: family(404, "notFound", t.notFoundTitle) },
      error: { icon: "alert", title: t.errorTitle, body: t.errorBody, actionsHtml: home(false) + retry, family: family(500, "alert", t.errorTitle) },
      unavailable: { icon: "alert", title: t.unavailableTitle, body: t.unavailableBody, actionsHtml: home(false) + retry, family: family(503, "alert", t.unavailableTitle) },
   };
   // The language / appearance links keep only the page's own safe parameters
   const keep = new URLSearchParams();
   if (o.accounts && url.searchParams.has("return")) keep.set("return", o.accounts.returnPath);
   const html = GatePage({
      v: {
         prefs,
         nonce: c.get("nonce"),
         assets: assetUrls(prefs.theme),
         tabIcons: tabIconLinks(c.env.ENVIRONMENT),
         path: url.pathname,
         search: keep.toString(),
         environment: c.env.ENVIRONMENT,
         signInHref: kind === "logged_out" || kind === "sign_in_failed" ? "/sso/login" : undefined,
         strings: { cms: t.cms, skip: admin.skip },
      },
      c: { ...(kind in familyContent ? familyContent[kind as FamilyKind] : content[kind as Exclude<GateKind, FamilyKind>]), chooser, testId: kind in familyContent ? "error-screen" : kind.replace("_", "-") },
   });
   return c.html("<!doctype html>" + (await html.toString()), status);
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
      // A new sign-in: an earlier refusal no longer describes this browser
      if (getCookie(c, deniedCookieName(secure)) !== undefined) deleteCookie(c, deniedCookieName(secure), { path: "/", secure });
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
            lang: signInLang(c.req.query("lang"), tx.r),
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
         return renderGate(c, deps.fetch, "sign_in_failed", 400);
      }
      if (!tx || !code || !state || tx.e < Date.now() / 1000 || !timingSafeEqual(tx.s, state)) {
         log.warn("sso callback rejected", { kind: !tx ? "no_tx" : !code || !state ? "no_code" : tx.e < Date.now() / 1000 ? "tx_expired" : "state_mismatch" });
         await failed();
         return renderGate(c, deps.fetch, "sign_in_failed", 400);
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
         log.warn("sso callback rejected", { kind: error instanceof OidcError ? error.kind : "error", error: errText(error) });
         return renderGate(c, deps.fetch, "sign_in_failed", error instanceof OidcError && error.kind === "invalid_token" ? 403 : 502);
      }

      const role = mapRoles(identity.roles);
      // One line per sign-in outcome, so a refusal can be traced from the CMS's own logs: the email
      // domain only (never the address) and the role names exactly as auth sent them.
      const who = { emailDomain: emailDomain(identity.email), roles: identity.roles.slice(0, 10).map((r) => r.slice(0, 40)) };
      if (!role) {
         log.warn("sso refused: no CMS role", who);
         // No allowed role: show the 403 page and create nothing (no user row, no session).
         // A CMS session the browser still holds for ANOTHER account (the user just switched to
         // this one) is dropped too, so the CMS never keeps acting as an account auth no longer
         // has active. Redirect to a stable URL so a reload does not replay the spent code.
         await clearSession(c, deps);
         const denied: Denied = { m: identity.email, r: tx.r, e: Math.floor(Date.now() / 1000) + DENIED_TTL_SECONDS };
         await setSignedCookie(c, deniedCookieName(secure), encodeURIComponent(JSON.stringify(denied)), cfg.jwtSecret, {
            path: "/",
            secure,
            httpOnly: true,
            sameSite: "Lax",
            maxAge: DENIED_TTL_SECONDS,
         });
         return c.redirect("/sso/no-access", 303);
      }

      // Staff passkeys (src/lib/passkeys.ts): past the deadline without a passkey sign-in there is no
      // session, only the "Passkey needed" page; inside the grace period the session carries the
      // deadline (pkd), so it lapses then even if its 8 h are not over.
      const passkey = passkeyVerdict(identity);
      if (passkey.kind === "required") {
         log.info("sso refused: passkey required", { ...who, role });
         await clearSession(c, deps);
         return c.redirect(passkeyNeededPath(tx.r, signInLang(undefined, tx.r)), 303);
      }

      // The auth tokens are not kept: the CMS only needs the identity and roles at sign-in time.
      // Everything after this runs on the bknd session (SESSION_TTL_SECONDS); the picker calls the
      // PUBLIC videos API server-side without any user token (src/lib/videos.ts). So there is no
      // access token to refresh. When the bknd session ends, the gate sends the browser through
      // /sso/login again, which is silent while auth still has a browser session.
      // The account's name (display name, else first + last: src/lib/display-name.ts) rides in the
      // session for the account menu; a new scholar profile starts from it. Read from the public
      // videos API in parallel with the rest; a failure only means the email is shown instead.
      const profileP = fetchAccountProfile(cfg.videosApiUrl, identity.sub, deps.fetch);
      const user = await upsertSsoUser(c.env.DB, identity, role);
      const profile = await profileP;
      const names = { en: accountName(profile, "en") || identity.name || "", ar: accountName(profile, "ar") || identity.name || "" };
      if (role === "writer") {
         // A scholar's profile is made on their first sign-in, linked to the channels they own on the
         // videos platform (docs/SCHOLARS.md §3). A videos API hiccup never blocks the sign-in: the
         // profile is made without channels and the scholar links them on their profile screen.
         const owned = await ownedChannels(c.env, identity.sub, deps.fetch).catch((error) => {
            log.warn("scholar channels unavailable at sign-in", { error: errText(error) });
            return [];
         });
         const personal = { en: accountName(profile, "en"), ar: accountName(profile, "ar") };
         await ensureScholar(c.env.DB, { ...identity, names: personal }, owned.map((ch) => ch.id)).catch((error) => log.error("scholar profile not created", { error: errText(error) }));
      }
      const app = await deps.getApp(c);
      const authenticator = app.module.auth.authenticator;
      const token = await authenticator.jwt({ id: user.id, email: user.email, role: user.role, strategy: "sso", sid: newSessionId(), name_en: names.en, name_ar: names.ar, ...(passkey.kind === "grace" ? { pkd: passkey.deadline } : {}) });
      const headers = await authenticator.getAuthCookieHeader(token, new Headers());
      log.info("sso signed in", { ...who, role });
      for (const cookie of headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
      return c.redirect(tx.r, 302);
   });

   sso.get("/logout", async (c) => {
      const cfg = c.get("cfg");
      const app = await deps.getApp(c);
      // End this browser's session, not only its cookie (a copy of the cookie stays signed)
      const signedIn = (await app.module.auth.authenticator.resolveAuthFromRequest(c.req.raw)) as AuthUser | undefined;
      if (signedIn?.id !== undefined) {
         try {
            // This browser's session only; a session from before sids existed: the account's
            if (typeof signedIn.sid === "string" && signedIn.sid) await revokeSession(c.env.DB, signedIn.sid, signedIn.exp ?? Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS);
            else await recordSignOut(c.env.DB, signedIn.id);
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

   // Staff passkeys (src/lib/passkeys.ts): a page, not an error. Needs no CMS session (it has none).
   sso.get("/passkey-needed", (c) => {
      const cfg = c.get("cfg");
      const returnPath = safeReturnPath(c.req.query("return"));
      // Language and mode as on the staff screens (src/admin/prefs.ts): ?lang= / ?mode= saved per browser
      const { lang, mode } = plainPrefs(c);
      const html = passkeyNeededPage({
         lang,
         nonce: c.get("nonce"),
         mode,
         environment: c.env.ENVIRONMENT,
         returnPath,
         setupUrl: passkeySetupUrl(cfg.issuer, cfg.publicUrl, returnPath, lang),
         signInPath: passkeySignInPath(returnPath, lang),
      });
      return c.html(html, 200);
   });
   // Shown after a recent refusal (deniedCookieName); otherwise it signs in again with auth's current account.
   sso.get("/no-access", async (c) => {
      const cfg = c.get("cfg");
      const secure = !cfg.isLocal;
      const name = deniedCookieName(secure);
      const raw = await getSignedCookie(c, cfg.jwtSecret, name);
      let denied: Denied | null = null;
      try {
         const d = raw ? (JSON.parse(decodeURIComponent(raw)) as Partial<Denied>) : null;
         if (d && typeof d.m === "string" && typeof d.r === "string" && typeof d.e === "number" && d.e >= Date.now() / 1000) denied = d as Denied;
      } catch {
         denied = null;
      }
      if (!denied) {
         log.info("sso no-access: no recent refusal, signing in again", { marker: raw === undefined ? "none" : "stale" });
         if (raw !== undefined) deleteCookie(c, name, { path: "/", secure });
         const lang = c.req.query("lang");
         return c.redirect(`/sso/login?return=%2F${lang === "ar" || lang === "en" ? `&lang=${lang}` : ""}`, 302);
      }
      log.info("sso no-access shown", { emailDomain: emailDomain(denied.m) });
      return renderGate(c, deps.fetch, "no_access", 403, { accounts: { returnPath: safeReturnPath(denied.r) }, account: denied.m });
   });
   // Account chooser (linked from the picker and the admin UI). Needs no CMS session: the list
   // is read by the browser straight from auth.
   sso.get("/accounts", (c) => renderGate(c, deps.fetch, "accounts", 200, { accounts: { returnPath: safeReturnPath(c.req.query("return")) } }));
   sso.get("/logged-out", (c) => renderGate(c, deps.fetch, "logged_out", 200));

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
