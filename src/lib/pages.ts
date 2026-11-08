/** Server-rendered status pages (en/ar, RTL for Arabic). */
import { esc, page } from "./html.ts";
import { STRINGS, type Lang } from "./i18n.ts";

export type StatusPageKind = "no_access" | "error" | "sign_in_failed" | "not_found" | "logged_out";

const CSS = `
main{max-width:40rem;margin:3rem auto;padding:0 1rem}
.actions{display:flex;gap:.75rem;flex-wrap:wrap;margin-top:1.5rem}
.lang{margin-top:2rem}
`;

export function statusPage(o: { kind: StatusPageKind; lang: Lang; nonce: string; wwwUrl: string; path: string }): string {
   const t = STRINGS[o.lang];
   const [title, body] = {
      no_access: [t.noAccessTitle, t.noAccessBody],
      error: [t.errorTitle, t.errorBody],
      sign_in_failed: [t.signInFailedTitle, t.signInFailedBody],
      not_found: [t.notFoundTitle, t.notFoundBody],
      logged_out: [t.loggedOutTitle, t.loggedOutBody],
   }[o.kind];
   const www = `${o.wwwUrl}/${o.lang}/`;
   const actions =
      o.kind === "no_access"
         ? `<a class="btn" href="${esc(www)}">${esc(t.backToSite)}</a>
            <a class="btn secondary" href="/sso/logout">${esc(t.signOut)}</a>`
         : o.kind === "not_found"
           ? `<a class="btn" href="/">${esc(t.cms)}</a> <a class="btn secondary" href="${esc(www)}">${esc(t.backToSite)}</a>`
           : `<a class="btn" href="/sso/login">${esc(t.signInAgain)}</a>
            <a class="btn secondary" href="${esc(www)}">${esc(t.backToSite)}</a>`;
   const other = t.switchLangCode as Lang;
   const switchHref = `${o.path}?lang=${other}`;
   return page({
      lang: o.lang,
      nonce: o.nonce,
      title: `${title} · ${t.cms}`,
      extraCss: CSS,
      body: `<main id="main">
<p>${esc(t.cms)}</p>
<h1>${esc(title)}</h1>
<p>${esc(body)}</p>
<div class="actions">${actions}</div>
<p class="lang"><a href="${esc(switchHref)}" lang="${other}" hreflang="${other}">${esc(t.switchLang)}</a></p>
</main>`,
   });
}
