/** Server-rendered status pages (en/ar, RTL for Arabic). */
import { ACCOUNTS_CSS, accountsSection } from "./accounts.ts";
import { esc, page } from "./html.ts";
import { STRINGS, type Lang } from "./i18n.ts";
import { publicHeaderHtml, withQuery } from "./header.ts";

export type StatusPageKind = "no_access" | "error" | "sign_in_failed" | "not_found" | "logged_out" | "accounts";

const CSS = `
main{max-width:40rem;margin:3rem auto;padding:0 1rem}
.actions{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.5rem}
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
   /** Saved mode (cms_mode), or null: the device decides. */
   mode?: "light" | "dark" | null;
   /** ENVIRONMENT: the header's QA / STAGE badge. */
   environment?: string;
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
   // The language / appearance links keep the path and only the page's own safe parameter (return)
   const keep = o.kind === "accounts" && o.accounts ? new URLSearchParams({ return: o.accounts.returnPath }).toString() : "";
   return page({
      lang: o.lang,
      nonce: o.nonce,
      mode: o.mode ?? null,
      header: publicHeaderHtml({ lang: o.lang, environment: o.environment, link: (key, value) => withQuery(o.path, keep, key, value) }),
      // Error pages use the family's tab title ("{title} | Al Ummah Now"); the CMS's own pages keep theirs
      title: o.kind === "error" || o.kind === "not_found" ? t.pageTitle.replace("{title}", title) : `${title} · ${t.cms}`,
      extraCss: chooser ? CSS + ACCOUNTS_CSS : CSS,
      script: chooser?.script,
      body: `<main id="main">
<p>${esc(t.cms)}</p>
<h1>${esc(title)}</h1>
${o.kind === "no_access" && o.account ? `<p class="who">${esc(t.noAccessAccount).replace("{email}", `<bdi><strong>${esc(o.account)}</strong></bdi>`)}</p>\n` : ""}<p>${esc(body)}</p>
<div class="actions">${actions}</div>
${chooser?.html ?? ""}
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
   /** ENVIRONMENT: the header's QA / STAGE badge. */
   environment?: string;
}): string {
   const t = STRINGS[o.lang];
   const link = (key: string, value: string) => {
      const q = new URLSearchParams({ return: o.returnPath, lang: o.lang });
      q.set(key, value);
      return `/sso/passkey-needed?${q.toString()}`;
   };
   return page({
      lang: o.lang,
      nonce: o.nonce,
      mode: o.mode,
      // The shared header: language and Light / Dark keep the return path (no Sign in: the page offers its own)
      header: publicHeaderHtml({ lang: o.lang, environment: o.environment, link }),
      title: `${t.passkeyNeededTitle} · ${t.cms}`,
      extraCss: CSS,
      body: `<main id="main" data-testid="passkey-needed">
<p>${esc(t.cms)}</p>
<h1>${esc(t.passkeyNeededTitle)}</h1>
<p>${esc(t.passkeyNeededBody)}</p>
<div class="actions">
<a class="btn" href="${esc(o.setupUrl)}" data-testid="passkey-add">${esc(t.addPasskey)}</a>
<a class="btn secondary" href="${esc(o.signInPath)}" data-testid="passkey-sign-in">${esc(t.signInWithPasskey)}</a>
</div>
</main>`,
   });
}
