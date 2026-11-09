/** Server-rendered status pages (en/ar, RTL for Arabic). */
import { ACCOUNTS_CSS, accountsSection } from "./accounts.ts";
import { esc, page } from "./html.ts";
import { STRINGS, type Lang } from "./i18n.ts";

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
<p>${esc(body)}</p>
<div class="actions">${actions}</div>
${chooser?.html ?? ""}
<p class="lang"><a href="${esc(switchHref)}" lang="${other}" hreflang="${other}">${esc(t.switchLang)}</a></p>
</main>`,
   });
}
