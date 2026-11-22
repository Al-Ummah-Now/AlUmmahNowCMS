/**
 * The header's markup, the same in every app (docs/design/NAV.md "Header"; wiki E10 "Header").
 * Framework-free: each builder returns an HTML string with the classes styled by aun-nav.css.
 *
 * - Worker / Hono / Astro apps render these strings (or a byte-identical copy of this file, kept
 *   equal by the repo's Fanous sync check).
 * - React apps render the same elements as JSX; their tests compare the rendered markup with these
 *   builders, so a React header can never drift from the contract.
 *
 * Order in the bar (reading order; it mirrors in Arabic), see HEADER_ORDER:
 *   drawer toggle · brand · environment badge · the app's own links/search · app actions ·
 *   language · light/dark · account (or Sign in)
 * No links to other sites (owner, 2026-11-15): the logo leads to the app's home; the other apps
 * are in the account menu's "Al Ummah Now apps".
 */
import { MODE_ICON_ATTRS, modeIconSvg, modeToggleLabel } from './mode-toggle.js';

/** The slots of the header, in reading order. */
export const HEADER_ORDER = ['menu', 'brand', 'env', 'primary', 'actions', 'lang', 'mode', 'account'];

/** Strings the header needs, per page language. */
export const HEADER_LABELS = {
  en: {
    siteName: 'Al Ummah Now',
    signIn: 'Sign in',
    menu: 'Menu',
    /** The language button's name: the action, then (visible) the other language's own name. */
    switchLang: 'Switch to Arabic',
    otherLang: 'العربية',
    env: { qa: 'QA environment', stage: 'Stage environment' },
    search: 'Search',
    back: 'Back',
  },
  ar: {
    siteName: 'الأمة الآن',
    signIn: 'تسجيل الدخول',
    menu: 'القائمة',
    switchLang: 'التبديل إلى الإنجليزية',
    otherLang: 'English',
    env: { qa: 'بيئة الاختبار QA', stage: 'بيئة ما قبل الإطلاق STAGE' },
    search: 'بحث',
    back: 'رجوع',
  },
};

const lc = (lang) => (lang === 'ar' ? 'ar' : 'en');
const other = (lang) => (lc(lang) === 'ar' ? 'en' : 'ar');

/** Escapes text and attribute values. */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A same-site path built from the request (a language switch keeping the page and query): leading
 * slashes and backslashes collapse to one "/", so "//evil.example" or "/\\evil.example" can never
 * become a protocol-relative link to another host. Anything that is not a path becomes "/".
 */
export function samePath(path) {
  const p = String(path ?? '');
  if (!/^[/\\]/.test(p)) return '/';
  return p.replace(/^[/\\]+/, '/');
}

/**
 * The logo lockup: the owner's logo (round), the wordmark, and in every app but www a second line
 * naming the app ("Videos", "Admin", "Status", ...). `href` is the app's own home. `name` replaces
 * the wordmark for a white-label site (a scholar's own site name); by default it is "Al Ummah Now".
 */
export function brandHtml({ lang, href, app = '', name = '', logoSrc = '/brand/logo-64.webp' }) {
  const l = HEADER_LABELS[lc(lang)];
  const sub = app ? `<span class="aun-brand-app">${escapeHtml(app)}</span>` : '';
  return (
    `<a class="aun-brand" href="${escapeHtml(href)}">` +
    `<img class="aun-brand-mark" src="${escapeHtml(logoSrc)}" alt="" width="36" height="36">` +
    `<span class="aun-brand-text"><span class="aun-brand-name">${escapeHtml(name || l.siteName)}</span>${sub}</span>` +
    `</a>`
  );
}

/** "QA" / "STAGE" next to the brand; nothing in production or local dev. */
export function envBadgeHtml(environment, lang) {
  const env = String(environment ?? '').toLowerCase();
  if (env !== 'qa' && env !== 'stage') return '';
  const name = HEADER_LABELS[lc(lang)].env[env];
  return `<span class="aun-env" role="note" aria-label="${escapeHtml(name)}" title="${escapeHtml(name)}">${env.toUpperCase()}</span>`;
}

/**
 * The language button: the other language's own name, marked with its `lang`. Its accessible name
 * starts with the action in the page's language ("Switch to Arabic: العربية") and contains the
 * visible label (WCAG 2.5.3). `href` keeps the current page and query in the other language.
 */
export function langButtonHtml({ lang, href }) {
  const l = HEADER_LABELS[lc(lang)];
  const to = other(lang);
  return (
    `<a class="aun-lang" href="${escapeHtml(href)}" hreflang="${to}">` +
    `<span class="aun-visually-hidden">${l.switchLang}: </span>` +
    `<span lang="${to}">${l.otherLang}</span>` +
    `</a>`
  );
}

/**
 * The light/dark button for the mode on screen (`dark`: the sun, "Switch to light mode").
 * Apps that swap the icon with CSS render both icons with modeIconSvg instead; the button is the same.
 */
export function modeButtonHtml({ lang, dark, id = 'mode-toggle' }) {
  const label = modeToggleLabel(lc(lang), dark);
  return (
    `<button type="button" class="aun-icon-btn aun-mode" id="${escapeHtml(id)}" data-testid="theme-toggle" ` +
    `aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">` +
    modeIconSvg(dark ? 'sun' : 'moon') +
    `</button>`
  );
}

/** lucide `menu` (0.487), the icon of the videos site's drawer toggle. */
export const MENU_ICON_BODY =
  '<line x1="4" x2="20" y1="12" y2="12"></line><line x1="4" x2="20" y1="6" y2="6"></line><line x1="4" x2="20" y1="18" y2="18"></line>';

/**
 * The menu button, first in the bar. Apps with a drawer (videos web, admin, CMS, Auth admin) render
 * the same 40px round button for it: `.aun-menu-btn`, never `.aun-menu` (the account menu's surface,
 * absolute and 21rem wide). Sites whose own links sit in the bar (www, scholar sites, the
 * dev site) pass `panel`: the id of an `.aun-header-panel` popover holding those links and search.
 * The button then shows only below 1024px, where `.aun-header-primary.aun-collapse` leaves the
 * bar, so the bar stays one 64px (56px) line on every screen. The popover opens without script.
 */
export function menuButtonHtml({ lang, panel }) {
  const label = HEADER_LABELS[lc(lang)].menu;
  return (
    `<button type="button" class="aun-icon-btn aun-menu-btn aun-menu-collapse" popovertarget="${escapeHtml(panel)}" ` +
    `aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">` +
    `<svg ${MODE_ICON_ATTRS} class="lucide lucide-menu" aria-hidden="true" focusable="false">${MENU_ICON_BODY}</svg>` +
    `</button>`
  );
}

/** "Sign in" when signed out: a solid pill, never hidden inside a menu. */
export function signInHtml({ lang, href }) {
  return `<a class="aun-signin" href="${escapeHtml(href)}">${HEADER_LABELS[lc(lang)].signIn}</a>`;
}

/** lucide `search` and `arrow-left` (0.487), the videos header's icons. */
export const SEARCH_ICON_BODY = '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>';
export const BACK_ICON_BODY = '<path d="m12 19-7-7 7-7"></path><path d="M19 12H5"></path>';
const icon = (name, body) => `<svg ${MODE_ICON_ATTRS} class="lucide lucide-${name}" aria-hidden="true" focusable="false">${body}</svg>`;

/**
 * The header search (docs/design/NAV.md "Search"), placed in `.aun-header-primary`: a GET form to
 * `action` with one `name` field. From 1024px it sits in the bar; below, the icon button opens the slot
 * (a popover, `id`) as a sheet over the bar, with a back arrow. No script needed. `placeholder` is the
 * app's own (what it searches); the field's name and the buttons use the shared labels.
 */
export function searchHtml({ lang, action, name = 'q', value = '', placeholder = '', id = 'aun-search' }) {
  const l = HEADER_LABELS[lc(lang)];
  const sid = escapeHtml(id);
  return (
    `<button type="button" class="aun-icon-btn aun-search-open" popovertarget="${sid}" data-testid="header-search-open" ` +
    `aria-label="${l.search}" title="${l.search}">${icon('search', SEARCH_ICON_BODY)}</button>` +
    `<div class="aun-search-slot" id="${sid}" popover="auto" data-testid="header-search-sheet">` +
    `<button type="button" class="aun-search-back" popovertarget="${sid}" popovertargetaction="hide" data-testid="header-search-back" ` +
    `aria-label="${l.back}" title="${l.back}">${icon('arrow-left', BACK_ICON_BODY)}</button>` +
    `<form class="aun-search" role="search" aria-label="${l.search}" action="${escapeHtml(action)}" method="get">` +
    `<input class="aun-search-input" type="search" name="${escapeHtml(name)}" value="${escapeHtml(value)}" ` +
    `placeholder="${escapeHtml(placeholder)}" aria-label="${l.search}" autocomplete="off" enterkeyhint="search" maxlength="200" data-testid="header-search-input">` +
    `<button type="submit" class="aun-search-submit" aria-label="${l.search}" data-testid="header-search-submit">${icon('search', SEARCH_ICON_BODY)}</button>` +
    `</form></div>`
  );
}
