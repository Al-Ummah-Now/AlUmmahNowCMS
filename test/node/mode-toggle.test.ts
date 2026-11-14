/**
 * The Light / Dark control in the CMS (src/lib/mode-toggle.ts)
 * is an exact copy of AlUmmahNow packages/fanous-tokens/nav/mode-toggle.js, whose markup the
 * videos site checks against lucide-react 0.487. Pinned here so a drift fails in this repo too.
 */
import { describe, expect, it } from 'vitest';
import { MODE_TOGGLE_LABELS, modeIconSvg, modeToggleLabel } from '../../src/lib/mode-toggle.ts';

const ATTRS = 'xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

describe('mode toggle', () => {
  it('draws Lucide sun and moon exactly', () => {
    expect(modeIconSvg('sun')).toBe(
      `<svg ${ATTRS} class="lucide lucide-sun" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>`,
    );
    expect(modeIconSvg('moon', 'theme-icon mode-moon')).toBe(
      `<svg ${ATTRS} class="lucide lucide-moon theme-icon mode-moon" aria-hidden="true" focusable="false"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>`,
    );
  });

  it('is named for the mode it switches to, in English and Arabic', () => {
    expect(MODE_TOGGLE_LABELS).toEqual({
      en: { toLight: 'Switch to light mode', toDark: 'Switch to dark mode' },
      ar: { toLight: 'التبديل إلى الوضع الفاتح', toDark: 'التبديل إلى الوضع الداكن' },
    });
    expect(modeToggleLabel('en', false)).toBe('Switch to dark mode');
    expect(modeToggleLabel('ar', true)).toBe('التبديل إلى الوضع الفاتح');
  });
});
