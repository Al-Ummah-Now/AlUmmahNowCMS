/** @jsxImportSource hono/jsx */
/**
 * The CMS's own pages outside the staff shell: No access, the account chooser, Signed out, Sign-in
 * failed. They wear the site theme like the staff screens (the same theme and app stylesheets,
 * the theme's backdrop, Light/Dark decided before paint, en/ar with RTL) on a centered card, with
 * the shared header (src/lib/header.ts). No session is needed to render them.
 */
import { raw } from "hono/html";
import { ICON_THEME_COLOR, type IconLink } from "../../lib/app-icons.ts";
import type { Prefs } from "../prefs.ts";
import { THEMES } from "../theme/vendor.generated.ts";
import { Icon, type IconName } from "./icons.tsx";
import { publicHeaderHtml, withQuery } from "../../lib/header.ts";
import { ERROR_PAGE_CSS } from "../theme/error-page-css.vendored.ts";

/** The error card's Go back: shown only when there is a page to go back to. */
const BACK_SCRIPT = `(function(){var b=document.querySelector("[data-ep-back]");if(!b||history.length<2)return;b.hidden=false;b.addEventListener("click",function(){history.back()})})();`;

const MODE_SCRIPT = `(function(){var h=document.documentElement;if(h.dataset.mode)return;var m=matchMedia("(prefers-color-scheme: dark)");var a=function(){h.classList.toggle("dark",m.matches)};a();m.addEventListener("change",a)})();`;

export interface GateView {
   prefs: Prefs;
   nonce: string;
   assets: { css: string; theme: string };
   tabIcons: IconLink[];
   /** The page's own path and query (language / appearance links keep the rest of the query). */
   path: string;
   search: string;
   /** ENVIRONMENT: the header's QA / STAGE badge. */
   environment?: string;
   /** A solid Sign in in the header, on the signed-out landings (Signed out, Sign-in failed). */
   signInHref?: string;
   strings: {
      cms: string;
      skip: string;
   };
}

export interface GateContent {
   icon: IconName;
   title: string;
   /** A line above the body (No access: the refused account), already safe HTML. */
   leadHtml?: string;
   body: string;
   /** The action buttons, already safe HTML. */
   actionsHtml: string;
   /** The account chooser (src/lib/accounts.ts), already safe HTML, and its script. */
   chooser?: { html: string; script: string };
   testId: string;
   /**
    * The error-page family's card (404, 500, 503; wiki guides/error-pages.md) instead of the gate card:
    * the same badge, "Error 404" line, words and actions as every Al Ummah Now app.
    */
   family?: { status: number; codeLabel: string; iconSvg: string; helpHtml: string; backLabel: string };
}

const withParam = (v: GateView, key: string, value: string) => withQuery(v.path, v.search, key, value);

export function GatePage(props: { v: GateView; c: GateContent }) {
   const { v, c } = props;
   const { prefs, strings: t } = v;
   const theme = THEMES[prefs.theme];
   const dark = prefs.mode !== "light";
   return (
      <html lang={prefs.lang} dir={prefs.lang === "ar" ? "rtl" : "ltr"} data-theme={prefs.theme} data-mode={prefs.mode ?? undefined} class={dark ? "dark" : undefined}>
         <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
            <meta name="robots" content="noindex, nofollow" />
            <meta name="color-scheme" content="dark light" />
            <title>{`${c.title} · ${t.cms}`}</title>
            <script nonce={v.nonce}>{raw(MODE_SCRIPT)}</script>
            {v.tabIcons.map((l) => <link rel="icon" href={l.href} type={l.type} sizes={l.sizes} />)}
            <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
            <meta name="theme-color" content={ICON_THEME_COLOR} />
            <link rel="stylesheet" href={v.assets.theme} />
            <link rel="stylesheet" href={v.assets.css} />
         </head>
         <body class="gate-body">
            <a class="skip" href="#main">
               {t.skip}
            </a>
            <div class="theme-bg" aria-hidden="true">
               {raw(theme.backdrop)}
            </div>
            {/* The shared header (src/lib/header.ts): brand, badge, language, sun/moon, and Sign in
                on the signed-out landings */}
            {raw(publicHeaderHtml({ lang: prefs.lang, environment: v.environment, link: (key, value) => withParam(v, key, value), signInHref: v.signInHref }))}
            {c.family ? (
               <main id="main" class="gate">
                  <style>{raw(ERROR_PAGE_CSS)}</style>
                  <div class="ep" lang={prefs.lang} dir={prefs.lang === "ar" ? "rtl" : "ltr"} data-error-status={String(c.family.status)} data-testid={c.testId} role={c.family.status >= 500 ? "alert" : undefined}>
                     <section class="ep-card" aria-labelledby="ep-title">
                        <div class="ep-head">
                           <span class="ep-badge" aria-hidden="true">{raw(c.family.iconSvg)}</span>
                           <div class="ep-heading">
                              <p class="ep-code">{c.family.codeLabel}</p>
                              <h1 class="ep-title" id="ep-title">{c.title}</h1>
                           </div>
                           <p class="ep-body">{c.body}</p>
                        </div>
                        <footer class="ep-foot">
                           <p class="ep-help">{raw(c.family.helpHtml)}</p>
                           <div class="ep-actions">
                              <button type="button" class="btn ep-btn" data-ep-back hidden>{c.family.backLabel}</button>
                              {raw(c.actionsHtml)}
                           </div>
                        </footer>
                     </section>
                  </div>
                  <script nonce={v.nonce}>{raw(BACK_SCRIPT)}</script>
               </main>
            ) : (
            <main id="main" class="gate">
               <section class="card gate-card" data-testid={c.testId} aria-labelledby="gate-h">
                  <span class="gate-ic">
                     <Icon name={c.icon} size={28} />
                  </span>
                  <h1 id="gate-h">{c.title}</h1>
                  {c.leadHtml ? <p class="gate-lead">{raw(c.leadHtml)}</p> : null}
                  <p class="gate-body-text">{c.body}</p>
                  <div class="gate-actions">{raw(c.actionsHtml)}</div>
                  {c.chooser ? raw(c.chooser.html) : null}
               </section>
            </main>
            )}
            {c.chooser ? <script nonce={v.nonce}>{raw(c.chooser.script)}</script> : null}
         </body>
      </html>
   );
}
