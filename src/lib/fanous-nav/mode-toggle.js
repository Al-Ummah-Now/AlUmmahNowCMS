/**
 * The Light / Dark control, the same in every app (docs/design/NAV.md "Header", Light/dark): one icon
 * button that switches to the other mode, as in the videos site's header (apps/web
 * ThemeDemo/AppShell `theme-toggle`).
 *
 * - Light mode on screen: the Moon icon, named "Switch to dark mode".
 * - Dark mode on screen: the Sun icon, named "Switch to light mode".
 * - The name is the action, so the button has no aria-pressed. `title` repeats the name.
 * - No "System" option (owner decision 2026-11-13).
 *
 * The icons are Lucide 0.487's `sun` and `moon` (ISC licence), the ones the videos site renders
 * through lucide-react; apps/web checks that these strings still equal lucide-react's output.
 * Apps outside the monorepo copy the markup exactly and test it against the same strings.
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
};

/** The name for the mode on screen (`dark` true: "Switch to light mode"). */
export function modeToggleLabel(lang, dark) {
  const l = MODE_TOGGLE_LABELS[lang === 'ar' ? 'ar' : 'en'];
  return dark ? l.toLight : l.toDark;
}

/**
 * One icon as markup, decorative (the button carries the name). `cls` adds classes after Lucide's
 * own (`lucide lucide-sun`), e.g. for CSS that shows the icon of the mode on screen.
 */
export function modeIconSvg(icon, cls = '') {
  const body = icon === 'sun' ? SUN_ICON_BODY : MOON_ICON_BODY;
  const classes = `lucide lucide-${icon === 'sun' ? 'sun' : 'moon'}${cls ? ` ${cls}` : ''}`;
  return `<svg ${MODE_ICON_ATTRS} class="${classes}" aria-hidden="true" focusable="false">${body}</svg>`;
}
