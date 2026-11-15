/**
 * The CMS header, the same as every Al Ummah Now app's (AlUmmahNow docs/design/NAV.md "Header";
 * owner 2026-11-14: "UNIFY"). The pieces come from the shared builders (src/lib/fanous-nav/header.js,
 * a byte-identical copy checked by `npm run check:fanous`) and are styled by the shared aun-nav.css
 * (NAV_CSS). Every CMS page uses them: the staff shell (src/admin/ui/layout.tsx), the themed pages
 * outside it (src/admin/ui/gate.tsx) and the plain status pages (src/lib/pages.ts).
 *
 * Order: [drawer toggle] brand · QA/STAGE · search · New · Website, Videos · language · sun/moon ·
 * account (or Sign in).
 */
import { publicSiteLinks } from "./app-links.ts";
import { HEADER_LABELS, MENU_ICON_BODY, appLinksHtml, brandHtml, envBadgeHtml, escapeHtml, langButtonHtml, signInHtml } from "./fanous-nav/header.js";
import { MODE_ICON_ATTRS, modeIconSvg, modeToggleLabel } from "./fanous-nav/mode-toggle.js";

export type HeaderLang = "en" | "ar";

/** The brand's second line: the CMS's name among the apps (NAV.md: "Content"). */
export const CMS_APP_NAME: Record<HeaderLang, string> = { en: "Content", ar: "المحتوى" };

/** The same page with one query parameter changed (language, appearance): path and query are kept. */
export function withQuery(path: string, search: string, key: string, value: string): string {
   const q = new URLSearchParams(search);
   q.set(key, value);
   return `${samePath(path)}?${q.toString()}`;
}

/**
 * The request path as a same-origin link. A path like `//evil.example` (a request for
 * `https://cms…//evil.example`) or one with backslashes would otherwise become a link to another
 * site; leading slashes and backslashes collapse to one `/`.
 */
export function samePath(path: string): string {
   const p = path.replace(/\\/g, "/").replace(/^\/+/, "/");
   return p.startsWith("/") ? p : "/";
}

/** Builds a link to this page with one parameter changed (`withQuery`, or a page's own rule). */
export type ParamLink = (key: string, value: string) => string;

/**
 * Slot 1 on phones (below 768px, where the rail leaves): the drawer toggle, the videos site's own
 * (a 40px `.aun-icon-btn` with lucide `menu`, the contract's MENU_ICON_BODY, named "Menu" /
 * "القائمة" from HEADER_LABELS). It opens the navigation drawer (`<dialog id="drawer">`,
 * client/shell.ts), so it is not the contract's popover menuButtonHtml.
 */
export function drawerToggleHtml(lang: HeaderLang): string {
   const label = escapeHtml(HEADER_LABELS[lang].menu);
   return (
      `<button class="aun-icon-btn only-phone" type="button" data-open-drawer aria-label="${label}" title="${label}" aria-controls="drawer" aria-expanded="false">` +
      `<svg ${MODE_ICON_ATTRS} class="lucide lucide-menu" aria-hidden="true" focusable="false">${MENU_ICON_BODY}</svg></button>`
   );
}

/** Slots 2 and 3: the logo lockup (to the CMS home) and the QA / STAGE badge (none in production). */
export function headerBrandHtml(lang: HeaderLang, environment: string | undefined): string {
   return brandHtml({ lang, href: "/", app: CMS_APP_NAME[lang] }) + envBadgeHtml(environment, lang);
}

/**
 * Slot 8, Light / Dark: the shared button's classes, icon and name. The CMS decides the mode on the
 * server (`?mode=` saved in cms_mode, so it works without script), and with nothing saved the device
 * decides before paint, so both links are rendered and CSS shows the one for the mode on screen
 * (`html.dark`): the sun ("Switch to light mode") in dark mode, the moon in light.
 */
export function modeLinksHtml(lang: HeaderLang, link: ParamLink): string {
   const one = (to: "light" | "dark") => {
      const label = escapeHtml(modeToggleLabel(lang, to === "light"));
      return (
         `<a class="aun-icon-btn aun-mode mode-to-${to}" href="${escapeHtml(link("mode", to))}" data-mode-toggle="${to}" data-testid="mode-to-${to}" ` +
         `aria-label="${label}" title="${label}">${modeIconSvg(to === "light" ? "sun" : "moon")}</a>`
      );
   };
   return one("light") + one("dark");
}

/**
 * Slots 6 to 8: Website and Videos (this environment's hosts), the language button (the other
 * language's own name; `?lang=` saved in cms_lang, same page and query) and Light / Dark.
 */
export function headerSitePrefsHtml(o: { lang: HeaderLang; link: ParamLink; wwwUrl?: string; videosWebUrl?: string }): string {
   const other: HeaderLang = o.lang === "ar" ? "en" : "ar";
   return (
      appLinksHtml({ lang: o.lang, links: publicSiteLinks(o.lang, { www: o.wwwUrl ?? "", videos: o.videosWebUrl ?? "" }) }) +
      langButtonHtml({ lang: o.lang, href: o.link("lang", other) }) +
      modeLinksHtml(o.lang, o.link)
   );
}

/**
 * The whole header for the pages without a session (gate pages, status pages, passkey needed):
 * brand, badge, app links, language, Light / Dark, and a solid Sign in on the signed-out landings.
 */
export function publicHeaderHtml(o: {
   lang: HeaderLang;
   environment: string | undefined;
   link: ParamLink;
   wwwUrl?: string;
   videosWebUrl?: string;
   /** The sign-in address, on pages a signed-out visitor lands on (Signed out, Sign-in failed). */
   signInHref?: string;
}): string {
   return (
      `<header class="aun-header cms-hd">` +
      headerBrandHtml(o.lang, o.environment) +
      `<div class="aun-header-tools">` +
      headerSitePrefsHtml(o) +
      (o.signInHref ? signInHtml({ lang: o.lang, href: o.signInHref }) : "") +
      `</div></header>`
   );
}

/**
 * What the CMS adds to the shared header CSS (NAV_CSS), on every page: the material behind the bar,
 * and the Light / Dark pair (only the link for the mode on screen shows).
 */
export const HEADER_GLUE_CSS =
   ".cms-hd{--aun-header-bg:var(--m-header,var(--fanous-c-nav-bg));-webkit-backdrop-filter:var(--m-blur,none);backdrop-filter:var(--m-blur,none)}" +
   ".cms-hd a{text-underline-offset:.2em}" +
   "html.dark .cms-hd .mode-to-dark,html:not(.dark) .cms-hd .mode-to-light{display:none}";
