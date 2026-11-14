/**
 * The Light / Dark control, the same in every Al Ummah Now app (AlUmmahNow docs/design/NAV.md;
 * source of truth: AlUmmahNow packages/fanous-tokens/nav/mode-toggle.js, copied here exactly).
 * It is the videos site's header toggle: one icon button that switches to the other mode.
 *
 * - Light mode on screen: the Moon icon, named "Switch to dark mode".
 * - Dark mode on screen: the Sun icon, named "Switch to light mode".
 * - The name is the action, so there is no aria-pressed; `title` repeats it. No "System" option.
 *
 * The icons are Lucide 0.487's `sun` and `moon` (ISC licence), byte for byte the markup
 * lucide-react renders on the videos site (test/mode-toggle.test.ts pins it).
 */

/** Lucide's default `<svg>` attributes (lucide-react 0.487 defaultAttributes). */
export const MODE_ICON_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

/** lucide `sun` */
export const SUN_ICON_BODY =
  '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path>';

/** lucide `moon` */
export const MOON_ICON_BODY = '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path>';

/** The button's name, by page language: the mode a click switches to. */
export const MODE_TOGGLE_LABELS = {
  en: { toLight: 'Switch to light mode', toDark: 'Switch to dark mode' },
  ar: { toLight: 'التبديل إلى الوضع الفاتح', toDark: 'التبديل إلى الوضع الداكن' },
} as const;

/** The name for the mode on screen (`dark` true: "Switch to light mode"). */
export function modeToggleLabel(lang: string, dark: boolean): string {
  const l = MODE_TOGGLE_LABELS[lang === 'ar' ? 'ar' : 'en'];
  return dark ? l.toLight : l.toDark;
}

/** One icon as markup, decorative (the button carries the name); `cls` adds classes after Lucide's. */
export function modeIconSvg(icon: 'sun' | 'moon', cls = ''): string {
  const body = icon === 'sun' ? SUN_ICON_BODY : MOON_ICON_BODY;
  return `<svg ${MODE_ICON_ATTRS} class="lucide lucide-${icon}${cls ? ` ${cls}` : ''}" aria-hidden="true" focusable="false">${body}</svg>`;
}
