/** @jsxImportSource hono/jsx */
/**
 * The CMS's own pages outside the staff shell: No access, the account chooser, Signed out, Sign-in
 * failed. They wear the site theme like the staff screens (the same theme and app stylesheets,
 * the theme's backdrop, Light/Dark decided before paint, en/ar with RTL) on a centered card, with
 * the brand, language and appearance in a slim header. No session is needed to render them.
 */
import { raw } from "hono/html";
import { ICON_THEME_COLOR, type IconLink } from "../../lib/app-icons.ts";
import type { Prefs } from "../prefs.ts";
import { THEMES } from "../theme/vendor.generated.ts";
import { Icon, type IconName } from "./icons.tsx";

const MODE_SCRIPT = `(function(){var h=document.documentElement;if(h.dataset.mode)return;var m=matchMedia("(prefers-color-scheme: dark)");var a=function(){h.classList.toggle("dark",m.matches)};a();m.addEventListener("change",a)})();`;

export interface GateView {
   prefs: Prefs;
   nonce: string;
   assets: { css: string; theme: string };
   tabIcons: IconLink[];
   /** The page's own path and query (language / appearance links keep the rest of the query). */
   path: string;
   search: string;
   strings: {
      brand: string;
      cms: string;
      /** The brand's second line, as in the staff shell ("Content"). */
      sub: string;
      skip: string;
      toLight: string;
      toDark: string;
      switchLang: string;
      switchLangCode: string;
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
}

function withParam(v: GateView, key: string, value: string): string {
   const q = new URLSearchParams(v.search);
   q.set(key, value);
   return `${v.path}?${q.toString()}`;
}

export function GatePage(props: { v: GateView; c: GateContent }) {
   const { v, c } = props;
   const { prefs, strings: t } = v;
   const theme = THEMES[prefs.theme];
   const dark = prefs.mode !== "light";
   const other = t.switchLangCode;
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
            <header class="hd gate-hd">
               <a class="brand" href="/">
                  <img class="brand-mark" src="/icon-192.png" alt="" width={36} height={36} />
                  <span>
                     <span class="brand-name">{t.brand}</span>
                     <span class="brand-sub">{t.sub}</span>
                  </span>
               </a>
               <div class="gate-prefs">
                  <a class="ic mode-to-light" href={withParam(v, "mode", "light")} title={t.toLight} aria-label={t.toLight}>
                     <Icon name="sun" />
                  </a>
                  <a class="ic mode-to-dark" href={withParam(v, "mode", "dark")} title={t.toDark} aria-label={t.toDark}>
                     <Icon name="moon" />
                  </a>
                  <a class="ic" href={withParam(v, "lang", other)} lang={other} hreflang={other} title={t.switchLang} aria-label={t.switchLang}>
                     <Icon name="languages" />
                  </a>
               </div>
            </header>
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
            {c.chooser ? <script nonce={v.nonce}>{raw(c.chooser.script)}</script> : null}
         </body>
      </html>
   );
}
