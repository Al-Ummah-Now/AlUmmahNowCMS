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
 *   app links · language · light/dark · account (or Sign in)
 */
import { modeIconSvg, modeToggleLabel } from './mode-toggle.js';

/** The slots of the header, in reading order. */
export const HEADER_ORDER = ['menu', 'brand', 'env', 'primary', 'actions', 'apps', 'lang', 'mode', 'account'];

/** Strings the header needs, per page language. */
export const HEADER_LABELS = {
  en: {
    siteName: 'Al Ummah Now',
    apps: 'Al Ummah Now apps',
    www: 'Website',
    videos: 'Videos',
    signIn: 'Sign in',
    /** The language button's name: the action, then (visible) the other language's own name. */
    switchLang: 'Switch to Arabic',
    otherLang: 'العربية',
    env: { qa: 'QA environment', stage: 'Stage environment' },
  },
  ar: {
    siteName: 'الأمة الآن',
    apps: 'تطبيقات الأمة الآن',
    www: 'الموقع',
    videos: 'المرئيات',
    signIn: 'تسجيل الدخول',
    switchLang: 'التبديل إلى الإنجليزية',
    otherLang: 'English',
    env: { qa: 'بيئة الاختبار QA', stage: 'بيئة ما قبل الإطلاق STAGE' },
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
 * The logo lockup: the owner's logo (round), the wordmark, and in every app but www a second line
 * naming the app ("Videos", "Admin", "Status", ...). `href` is the app's own home.
 */
export function brandHtml({ lang, href, app = '', logoSrc = '/brand/logo-64.webp' }) {
  const l = HEADER_LABELS[lc(lang)];
  const sub = app ? `<span class="aun-brand-app">${escapeHtml(app)}</span>` : '';
  return (
    `<a class="aun-brand" href="${escapeHtml(href)}">` +
    `<img class="aun-brand-mark" src="${escapeHtml(logoSrc)}" alt="" width="36" height="36">` +
    `<span class="aun-brand-text"><span class="aun-brand-name">${l.siteName}</span>${sub}</span>` +
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
 * The public sites other than the current one (Website, Videos), each with its app icon.
 * `links`: [{ id: 'www' | 'videos', href }]. Icon only below 1280px; on phones they leave the bar
 * (they are in the account menu's "Al Ummah Now apps", or the drawer, or the page footer).
 */
export function appLinksHtml({ lang, links, iconBase = '/aun-nav/icons' }) {
  const l = HEADER_LABELS[lc(lang)];
  const items = (links ?? [])
    .filter((a) => a && a.href && (a.id === 'www' || a.id === 'videos'))
    .map(
      (a) =>
        `<a class="aun-app" href="${escapeHtml(a.href)}">` +
        `<img class="aun-app-mark" src="${escapeHtml(iconBase)}/${a.id}.webp" alt="" width="22" height="22">` +
        `<span class="aun-app-name">${l[a.id]}</span>` +
        `</a>`
    )
    .join('');
  return items ? `<nav class="aun-apps" aria-label="${escapeHtml(l.apps)}">${items}</nav>` : '';
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

/** "Sign in" when signed out: a solid pill, never hidden inside a menu. */
export function signInHtml({ lang, href }) {
  return `<a class="aun-signin" href="${escapeHtml(href)}">${HEADER_LABELS[lc(lang)].signIn}</a>`;
}
