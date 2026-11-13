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
import { appLinks, type AppLinkId } from "../../lib/app-links.ts";

export interface View {
   prefs: Prefs;
   t: AdminStrings;
   path: string;
   search: string;
   nonce: string;
   /** `sub` is the writer's auth user id (writers only: they see their own posts, docs/SCHOLARS.md). */
   /** `name` is the account's name in the admin language ('' when it has none: show the email). */
   user: { email: string; name: string; role: "admin" | "editor" | "writer"; sub?: string | null };
   wwwUrl: string;
   adminWebUrl: string;
   /** For the account menu's "Al Ummah Now apps" links (src/lib/app-links.ts). */
   videosWebUrl?: string;
   issuer?: string;
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

/** The name the account menu shows: the account's name, the email only when it has none. */
export const userLabel = (v: View) => v.user.name || v.user.email;

function AccountMenu(props: { v: View }) {
   const { v } = props;
   const label = userLabel(v);
   const initial = (Array.from(label.trim())[0] ?? "?").toUpperCase();
   const ret = encodeURIComponent(v.path + (v.search ? `?${v.search}` : ""));
   const apps = appLinks(v.user.role, v.prefs.lang, { www: v.wwwUrl, videos: v.videosWebUrl ?? "", admin: v.adminWebUrl, issuer: v.issuer ?? "" });
   const appLabel: Record<AppLinkId, string> = {
      www: v.t.header.appWww,
      videos: v.t.header.appVideos,
      profile: v.t.header.appProfile,
      admin: v.t.header.appAdmin,
      "auth-admin": v.t.header.appAuthAdmin,
   };
   // The shared nav contract (AlUmmahNow docs/design/NAV.md): avatar + name, then
   // who · accounts · this app · Al Ummah Now apps · sign out
   return (
      <details class="pop" data-pop>
         {/* No aria-label: the visible name is the button's name (axe label-content-name-mismatch) */}
         <summary class="who aun-acct-btn">
            <span class="aun-avatar" aria-hidden="true">{initial}</span>
            <span class="vh">{v.t.header.account}: </span>
            <span class="aun-acct-name" dir="auto">{label}</span>
            <Icon name="chevronDown" size={14} class="aun-caret" />
         </summary>
         <div class="aun-menu" role="menu">
            <div class="aun-menu-who">
               <span class="aun-avatar aun-avatar--lg" aria-hidden="true">{initial}</span>
               <span class="aun-menu-who-text">
                  <span class="aun-menu-who-name" dir="auto" title={v.user.email}>{label}</span>
                  {label !== v.user.email ? <EmailText email={v.user.email} class="aun-menu-who-sub" /> : null}
                  <span class="aun-menu-who-sub">{isAdmin(v) ? v.t.header.roleAdmin : isWriter(v) ? v.t.header.roleWriter : v.t.header.roleEditor}</span>
               </span>
            </div>
            <div class="aun-menu-sep" role="separator" />
            {/* More accounts: the CMS server cannot list the browser's other accounts, so they open on its
                accounts page (switch, sign out of one); then Add another account (docs/design/NAV.md) */}
            <a class="aun-menu-item" role="menuitem" href={`/sso/accounts?return=${ret}`} data-testid="cms-more-accounts">
               <Icon name="users" class="aun-menu-icon" /> <span class="aun-menu-text">{v.t.header.moreAccounts}</span>
               <Icon name="chevronEnd" class="aun-menu-icon flip" />
            </a>
            <a class="aun-menu-item" role="menuitem" href={`/sso/login?prompt=login&return=${ret}`} data-testid="cms-add-account">
               <Icon name="login" class="aun-menu-icon flip" /> <span class="aun-menu-text">{v.t.header.addAccount}</span>
            </a>
            {apps.length ? (
               <>
                  <div class="aun-menu-sep" role="separator" />
                  <div role="group" aria-labelledby="account-apps-label">
                     <span class="aun-menu-label" id="account-apps-label">{v.t.header.apps}</span>
                     {apps.map((a) => (
                        <a class="aun-menu-item" role="menuitem" href={a.href} data-app={a.id}>
                           <span class="aun-app-icon" data-app={a.id} aria-hidden="true" />
                           <span class="aun-menu-text">{appLabel[a.id]}</span>
                        </a>
                     ))}
                  </div>
               </>
            ) : null}
            <div class="aun-menu-sep" role="separator" />
            <a class="aun-menu-item" role="menuitem" href="/sso/logout">
               <Icon name="logout" class="aun-menu-icon flip" /> <span class="aun-menu-text">{v.t.header.signOut}</span>
            </a>
         </div>
      </details>
   );
}

/**
 * An email that keeps its domain when it does not fit (AlUmmahNow docs/design/NAV.md): the local
 * part shrinks with an ellipsis, "@domain" stays whole, and the full address is the tooltip.
 */
function EmailText(props: { email: string; class: string }) {
   const at = props.email.lastIndexOf("@");
   if (at <= 0) return <span class={props.class} dir="ltr" title={props.email}>{props.email}</span>;
   return (
      <span class={`${props.class} aun-email`} dir="ltr" title={props.email}>
         <span class="aun-email-local">{props.email.slice(0, at)}</span>
         <span class="aun-email-domain">{props.email.slice(at)}</span>
      </span>
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
         <div class="aun-menu" role="menu">
            <a class="aun-menu-item" role="menuitem" href="/pages/new">
               <Icon name="file" /> {t.header.newPage}
            </a>
            <a class="aun-menu-item" role="menuitem" href="/posts/new">
               <Icon name="pen" /> {t.header.newPost}
            </a>
            <a class="aun-menu-item" role="menuitem" href="/videos?add=1">
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
                        {/* The owner's app icon as supplied (docs/design/NAV.md: the logo, never a placeholder) */}
                        <img class="brand-mark" src="/icon-192.png" alt="" width={36} height={36} />
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
