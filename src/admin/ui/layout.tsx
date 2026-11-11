/** @jsxImportSource hono/jsx */
/** The staff shell: header, rail / drawer / bottom bar, theme atmosphere (docs/ADMIN_UI_SPEC.md §2). */
import { raw } from "hono/html";
import { ICON_THEME_COLOR, type IconLink } from "../../lib/app-icons.ts";
import type { Child } from "hono/jsx";
import { ADMIN_STRINGS, type AdminStrings } from "../i18n.ts";
import type { Prefs } from "../prefs.ts";
import { THEMES } from "../theme/vendor.generated.ts";
import { Icon, type IconName } from "./icons.tsx";
import { Autocomplete, comboboxProps } from "./autocomplete.tsx";
import { LeaveDialog, LinkDialog } from "./dialogs.tsx";

export interface View {
   prefs: Prefs;
   t: AdminStrings;
   path: string;
   search: string;
   nonce: string;
   /** `sub` is the writer's auth user id (writers only: they see their own posts, docs/SCHOLARS.md). */
   user: { email: string; role: "admin" | "editor" | "writer"; sub?: string | null };
   wwwUrl: string;
   adminWebUrl: string;
   assets: { css: string; theme: string; js: string };
   /** Tab icons for this environment (src/lib/app-icons.ts). */
   tabIcons: IconLink[];
   /** AI writing assist is configured in this env (docs/AI_ASSIST_SPEC.md §2). */
   ai: boolean;
}

export const isAdmin = (v: View) => v.user.role === "admin";
/** A scholar (auth "Scholar"): their own posts and profile only. */
export const isWriter = (v: View) => v.user.role === "writer";

interface NavItem {
   href: string;
   label: keyof AdminStrings["nav"];
   icon: IconName;
   admin?: boolean;
   /** Shown to writers (scholars). Everything else is staff only. */
   writer?: boolean;
   /** Shown to writers only. */
   writerOnly?: boolean;
}

const CONTENT: NavItem[] = [
   { href: "/", label: "overview", icon: "home" },
   { href: "/pages", label: "pages", icon: "file" },
   { href: "/posts", label: "posts", icon: "pen", writer: true },
   { href: "/scholars/me", label: "myProfile", icon: "user", writer: true, writerOnly: true },
   { href: "/timeline", label: "timeline", icon: "timeline" },
   { href: "/featuring", label: "featuring", icon: "star" },
   { href: "/videos", label: "videos", icon: "play" },
];
const SITE: NavItem[] = [
   { href: "/navigation", label: "navigation", icon: "list" },
   { href: "/site", label: "site", icon: "globe" },
   { href: "/library", label: "library", icon: "image" },
   { href: "/scholars", label: "scholars", icon: "users" },
   { href: "/people", label: "people", icon: "users", admin: true },
   { href: "/deleted", label: "deleted", icon: "trash", admin: true },
   { href: "/glossary", label: "glossary", icon: "book" },
   { href: "/ai-settings", label: "aiSettings", icon: "sparkle", admin: true },
];

const current = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));

function NavLinks(props: { v: View; items: NavItem[] }) {
   return (
      <>
         {props.items
            .filter((i) => (isWriter(props.v) ? !!i.writer : !i.writerOnly && (!i.admin || isAdmin(props.v))))
            .map((i) => (
               <a class="ri" href={i.href} aria-current={current(props.v.path, i.href) ? "page" : undefined}>
                  <Icon name={i.icon} />
                  <span>{props.v.t.nav[i.label] as string}</span>
               </a>
            ))}
      </>
   );
}

/** Link to the same screen with one query parameter changed (language, appearance). */
export function withParam(v: View, key: string, value: string): string {
   const q = new URLSearchParams(v.search);
   q.set(key, value);
   return `${v.path}?${q.toString()}`;
}

function Prefs(props: { v: View }) {
   const { v } = props;
   const other = v.prefs.lang === "ar" ? "en" : "ar";
   const nextMode = v.prefs.mode === "system" ? "light" : v.prefs.mode === "light" ? "dark" : "system";
   const modeIcon: IconName = v.prefs.mode === "light" ? "sun" : v.prefs.mode === "dark" ? "moon" : "monitor";
   const modeLabel = { system: v.t.prefs.system, light: v.t.prefs.light, dark: v.t.prefs.dark }[v.prefs.mode];
   return (
      <>
         <a class="ic" href={withParam(v, "mode", nextMode)} title={`${v.t.prefs.mode}: ${modeLabel}`} aria-label={`${v.t.prefs.mode}: ${modeLabel}`} data-mode-toggle>
            <Icon name={modeIcon} />
         </a>
         <a class="ic" href={withParam(v, "lang", other)} lang={other} hreflang={other} title={v.t.prefs.switchTo} aria-label={v.t.prefs.switchTo}>
            <Icon name="languages" />
         </a>
      </>
   );
}

function AccountMenu(props: { v: View }) {
   const { v } = props;
   const ret = encodeURIComponent(v.path + (v.search ? `?${v.search}` : ""));
   return (
      <details class="pop" data-pop>
         <summary class="who ic" style="width:auto" aria-label={`${v.t.header.account}: ${v.user.email}`}>
            <span class="avatar" aria-hidden="true">{(v.user.email[0] ?? "?").toUpperCase()}</span>
            <Icon name="chevronDown" size={16} />
         </summary>
         <div class="pop-panel" role="menu">
            <div class="pop-head">
               <strong>{v.user.email}</strong>
               <span>{isAdmin(v) ? v.t.header.roleAdmin : isWriter(v) ? v.t.header.roleWriter : v.t.header.roleEditor}</span>
            </div>
            <a class="mi" role="menuitem" href={`/sso/accounts?return=${ret}`}>
               <Icon name="swap" /> {v.t.header.accounts}
            </a>
            <a class="mi" role="menuitem" href={`${v.wwwUrl}/${v.prefs.lang}/`}>
               <Icon name="external" class="flip" /> {v.t.overview.viewSite}
            </a>
            <a class="mi danger" role="menuitem" href="/sso/logout">
               <Icon name="logout" class="flip" /> {v.t.header.signOut}
            </a>
         </div>
      </details>
   );
}

function CreateMenu(props: { v: View }) {
   const { t } = props.v;
   if (isWriter(props.v)) {
      return (
         <a class="btn primary sm" href="/posts/new">
            <Icon name="pen" size={18} /> <span>{t.scholars.writeArticle}</span>
         </a>
      );
   }
   return (
      <details class="pop" data-pop>
         <summary class="btn primary sm" aria-label={t.header.create}>
            <Icon name="pen" size={18} /> <span>{t.header.create}</span>
         </summary>
         <div class="pop-panel" role="menu">
            <a class="mi" role="menuitem" href="/pages/new">
               <Icon name="file" /> {t.header.newPage}
            </a>
            <a class="mi" role="menuitem" href="/posts/new">
               <Icon name="pen" /> {t.header.newPost}
            </a>
            <a class="mi" role="menuitem" href="/videos?add=1">
               <Icon name="play" /> {t.header.addVideo}
            </a>
         </div>
      </details>
   );
}

/** Runs before paint: resolves "system" mode to html.dark, and follows later changes. */
const MODE_SCRIPT = `(function(){var h=document.documentElement;if(h.dataset.mode!=="system")return;var m=matchMedia("(prefers-color-scheme: dark)");var a=function(){h.classList.toggle("dark",m.matches)};a();m.addEventListener("change",a)})();`;

export function Shell(props: { v: View; title: string; children: Child }) {
   const { v } = props;
   const { t, prefs } = v;
   const theme = THEMES[prefs.theme];
   const dark = prefs.mode === "dark" || prefs.mode === "system";
   return (
      <html lang={prefs.lang} dir={prefs.lang === "ar" ? "rtl" : "ltr"} data-theme={prefs.theme} data-mode={prefs.mode} class={dark ? "dark" : undefined}>
         <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
            <meta name="robots" content="noindex, nofollow" />
            <meta name="color-scheme" content="dark light" />
            <title>{`${props.title} · ${t.cms} · ${t.brand}`}</title>
            <script nonce={v.nonce}>{raw(MODE_SCRIPT)}</script>
            {v.tabIcons.map((l) => <link rel="icon" href={l.href} type={l.type} sizes={l.sizes} />)}
            <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
            <link rel="manifest" href="/site.webmanifest" />
            <meta name="theme-color" content={ICON_THEME_COLOR} />
            <link rel="stylesheet" href={v.assets.theme} />
            <link rel="stylesheet" href={v.assets.css} />
            <script type="module" src={v.assets.js} nonce={v.nonce} />
         </head>
         <body>
            <a class="skip" href="#main">
               {t.skip}
            </a>
            <div class="theme-bg" aria-hidden="true">
               {raw(theme.backdrop)}
            </div>
            <div class="shell">
               {prefs.previewing ? (
                  <div class="preview-bar" role="status">
                     <span>
                        {theme.name[prefs.lang]} · {t.overview.themePreview}
                     </span>
                     <a href={withParam(v, "theme", "site")}>{t.overview.themeReset}</a>
                  </div>
               ) : null}
               <header class="hd">
                  <div class="hd-start">
                     <button class="ic only-phone" type="button" data-open-drawer aria-label={t.nav.menu} aria-controls="drawer" aria-expanded="false">
                        <Icon name="menu" />
                     </button>
                     <a class="brand" href="/">
                        <span class="brand-mark" aria-hidden="true">
                           <Icon name="sparkle" size={18} />
                        </span>
                        <span>
                           <span class="brand-name">{t.brand}</span>
                           <span class="brand-sub">{t.cms}</span>
                        </span>
                     </a>
                  </div>
                  <Autocomplete kind={isWriter(v) ? "posts" : "content"} listId="global-q-list" label={t.header.search}>
                     <form class="search" role="search" action={isWriter(v) ? "/posts" : "/pages"} method="get">
                        <label class="vh" for="global-q">
                           {t.header.search}
                        </label>
                        <input id="global-q" name="q" type="search" placeholder={t.header.search} maxlength={100} {...comboboxProps("global-q-list")} />
                        <button type="submit" aria-label={t.header.searchButton}>
                           <Icon name="search" />
                        </button>
                     </form>
                  </Autocomplete>
                  <div class="hd-end">
                     <CreateMenu v={v} />
                     <AccountMenu v={v} />
                  </div>
               </header>
               <div class="layout">
                  <nav class="rail" aria-label={t.nav.label}>
                     <span class="rail-group">{t.nav.groupContent}</span>
                     <NavLinks v={v} items={CONTENT} />
                     <div class="rail-sep" />
                     <span class="rail-group">{t.nav.groupSite}</span>
                     <NavLinks v={v} items={SITE} />
                     <div class="rail-foot">
                        <Prefs v={v} />
                     </div>
                  </nav>
                  <main id="main" tabindex={-1}>
                     <div class="wrap">{props.children}</div>
                  </main>
               </div>
               <nav class="bar" aria-label={t.nav.label}>
                  <NavLinks v={v} items={CONTENT} />
               </nav>
            </div>
            <dialog class="drawer" id="drawer" aria-label={t.nav.label}>
               <div class="drawer-in">
                  <div class="drawer-top">
                     <a class="brand" href="/">
                        <span class="brand-name">{t.brand}</span>
                     </a>
                     <button class="ic" type="button" data-close-drawer aria-label={t.nav.close}>
                        <Icon name="x" />
                     </button>
                  </div>
                  <span class="rail-group">{t.nav.groupContent}</span>
                  <NavLinks v={v} items={CONTENT} />
                  <span class="rail-group">{t.nav.groupSite}</span>
                  <NavLinks v={v} items={SITE} />
                  <div class="rail-foot" style="flex-direction:row;justify-content:flex-start">
                     <Prefs v={v} />
                  </div>
               </div>
            </dialog>
            <LeaveDialog v={v} />
            <LinkDialog v={v} />
            <div class="toasts" id="toasts" role="status" aria-live="polite" />
            <script type="application/json" id="i18n-shell" nonce={v.nonce}>
               {raw(
                  JSON.stringify({
                     acSearching: t.autocomplete.searching,
                     acFailed: t.autocomplete.failed,
                     acNone: t.autocomplete.none,
                     acCount: t.autocomplete.count,
                     acSearchAll: t.autocomplete.searchAll,
                     // Scholars and featuring (src/admin/client/scholars.ts).
                     sch: {
                        saved: t.scholars.saved,
                        deleted: t.scholars.deleted,
                        errors: t.scholars.errors,
                        failed: t.common.failed,
                        featuredDone: t.featuring.featuredDone,
                        unfeaturedDone: t.featuring.unfeaturedDone,
                        videoAdded: t.featuring.videoAdded,
                        videoAlready: t.featuring.videoAlready,
                        videoRemoved: t.featuring.videoRemoved,
                     },
                     scholarDeleted: t.scholars.deleted,
                     published: t.content.published,
                     unpublished: t.content.unpublished,
                     draft: t.content.draftSaved,
                     created: t.common.saved,
                     saved: t.common.saved,
                     deleted: t.content.deleted,
                     reordered: t.common.reordered,
                     scheduled: t.content.scheduled,
                     unscheduled: t.content.unscheduled,
                     restored: t.history.restored,
                     failed: t.common.failed,
                  }).replace(/</g, "\\u003c"),
               )}
            </script>
         </body>
      </html>
   );
}

export function PageHead(props: { title: string; intro?: string; back?: { href: string; label: string }; children?: Child }) {
   return (
      <div class="ph">
         <div>
            {props.back ? (
               <a class="crumb" href={props.back.href}>
                  <Icon name="chevronStart" size={16} class="flip" /> {props.back.label}
               </a>
            ) : null}
            <h1>{props.title}</h1>
            {props.intro ? <p>{props.intro}</p> : null}
         </div>
         {props.children ? <div class="ph-actions">{props.children}</div> : null}
      </div>
   );
}

export function Empty(props: { icon: IconName; title: string; body?: string; children?: Child }) {
   return (
      <div class="empty">
         <Icon name={props.icon} />
         <strong>{props.title}</strong>
         {props.body ? <p>{props.body}</p> : null}
         {props.children}
      </div>
   );
}

export const stringsFor = (lang: "en" | "ar") => ADMIN_STRINGS[lang];
