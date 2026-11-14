/** Server-rendered status pages (en/ar, RTL for Arabic). */
import { ACCOUNTS_CSS, accountsSection } from "./accounts.ts";
import { esc, page } from "./html.ts";
import { STRINGS, type Lang } from "./i18n.ts";
import { modeIconSvg } from "./mode-toggle.ts";

export type StatusPageKind = "no_access" | "error" | "sign_in_failed" | "not_found" | "logged_out" | "accounts";

const CSS = `
main{max-width:40rem;margin:3rem auto;padding:0 1rem}
.actions{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.5rem}
.lang{margin-top:2rem}
`;

/** Pages that show the account chooser (their CSP allows `connect-src` to the auth origin). */
export const ACCOUNT_PAGES: ReadonlySet<string> = new Set(["/sso/no-access", "/sso/accounts"]);

export function statusPage(o: {
   kind: StatusPageKind;
   lang: Lang;
   nonce: string;
   wwwUrl: string;
   path: string;
   /** Renders the account chooser (no_access, accounts). */
   accounts?: { issuer: string; returnPath: string };
   /** no_access: the email of the account that was refused. */
   account?: string;
}): string {
   const t = STRINGS[o.lang];
   const [title, body] = {
      no_access: [t.noAccessTitle, t.noAccessBody],
      error: [t.errorTitle, t.errorBody],
      sign_in_failed: [t.signInFailedTitle, t.signInFailedBody],
      not_found: [t.notFoundTitle, t.notFoundBody],
      logged_out: [t.loggedOutTitle, t.loggedOutBody],
      accounts: [t.accountsTitle, t.accountsBody],
   }[o.kind];
   const chooser = o.accounts
      ? accountsSection({ lang: o.lang, issuer: o.accounts.issuer, returnPath: o.accounts.returnPath, hint: o.kind === "no_access" })
      : undefined;
   const www = `${o.wwwUrl}/${o.lang}/`;
   const actions =
      o.kind === "no_access"
         ? // Sign out lives in the account chooser below ("Sign out of all accounts").
           `<a class="btn" href="${esc(www)}">${esc(t.backToSite)}</a>${chooser ? "" : ` <a class="btn secondary" href="/sso/logout">${esc(t.signOut)}</a>`}`
         : o.kind === "accounts"
           ? `<a class="btn" href="${esc(o.accounts?.returnPath ?? "/")}">${esc(t.backToCms)}</a>`
           : o.kind === "not_found"
           ? `<a class="btn" href="/">${esc(t.cms)}</a> <a class="btn secondary" href="${esc(www)}">${esc(t.backToSite)}</a>`
           : `<a class="btn" href="/sso/login">${esc(t.signInAgain)}</a>
            <a class="btn secondary" href="${esc(www)}">${esc(t.backToSite)}</a>`;
   const other = t.switchLangCode as Lang;
   const switchHref =
      o.kind === "accounts" && o.accounts
         ? `${o.path}?return=${encodeURIComponent(o.accounts.returnPath)}&lang=${other}`
         : `${o.path}?lang=${other}`;
   return page({
      lang: o.lang,
      nonce: o.nonce,
      title: `${title} · ${t.cms}`,
      extraCss: chooser ? CSS + ACCOUNTS_CSS : CSS,
      script: chooser?.script,
      body: `<main id="main">
<p>${esc(t.cms)}</p>
<h1>${esc(title)}</h1>
${o.kind === "no_access" && o.account ? `<p class="who">${esc(t.noAccessAccount).replace("{email}", `<bdi><strong>${esc(o.account)}</strong></bdi>`)}</p>\n` : ""}<p>${esc(body)}</p>
<div class="actions">${actions}</div>
${chooser?.html ?? ""}
<p class="lang"><a href="${esc(switchHref)}" lang="${other}" hreflang="${other}">${esc(t.switchLang)}</a></p>
</main>`,
   });
}

/**
 * "Passkey needed" (wiki AUTH-PASSKEYS): staff without a passkey sign-in after their deadline. Not
 * an error page: it says why and offers Add a passkey (Auth's setup page) and Sign in with a
 * passkey (the CMS's own sign-in with prompt=login). en/ar with RTL, Light/Dark.
 */
export function passkeyNeededPage(o: {
   lang: Lang;
   nonce: string;
   /** Saved mode (cms_mode), or null: the device decides. */
   mode: "light" | "dark" | null;
   /** Where both buttons lead back to (a safe, relative CMS path). */
   returnPath: string;
   setupUrl: string;
   signInPath: string;
}): string {
   const t = STRINGS[o.lang];
   const other = t.switchLangCode as Lang;
   const link = (key: string, value: string) => {
      const q = new URLSearchParams({ return: o.returnPath, lang: o.lang });
      q.set(key, value);
      return `/sso/passkey-needed?${q.toString()}`;
   };
   return page({
      lang: o.lang,
      nonce: o.nonce,
      mode: o.mode,
      title: `${t.passkeyNeededTitle} · ${t.cms}`,
      extraCss: CSS + ".prefs{display:flex;gap:1rem;flex-wrap:wrap;align-items:center;margin-top:2rem}.prefs .lang{margin:0}" +
         // Light / Dark: the videos site's icon toggle (src/lib/mode-toggle.ts), 44px target, 18px icon
         ".mode-ic{display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;border:1px solid var(--border);border-radius:999px;color:var(--fg)}.mode-ic svg{width:18px;height:18px}",
      body: `<main id="main" data-testid="passkey-needed">
<p>${esc(t.cms)}</p>
<h1>${esc(t.passkeyNeededTitle)}</h1>
<p>${esc(t.passkeyNeededBody)}</p>
<div class="actions">
<a class="btn" href="${esc(o.setupUrl)}" data-testid="passkey-add">${esc(t.addPasskey)}</a>
<a class="btn secondary" href="${esc(o.signInPath)}" data-testid="passkey-sign-in">${esc(t.signInWithPasskey)}</a>
</div>
<p class="prefs">
<a class="lang" href="${esc(link("lang", other))}" lang="${other}" hreflang="${other}">${esc(t.switchLang)}</a>
<a class="mode-to-light mode-ic" href="${esc(link("mode", "light"))}" data-testid="mode-to-light" aria-label="${esc(t.toLight)}" title="${esc(t.toLight)}">${modeIconSvg("sun")}</a>
<a class="mode-to-dark mode-ic" href="${esc(link("mode", "dark"))}" data-testid="mode-to-dark" aria-label="${esc(t.toDark)}" title="${esc(t.toDark)}">${modeIconSvg("moon")}</a>
</p>
</main>`,
   });
}
