export type HeaderLang = 'en' | 'ar' | string;
export type HeaderSlot = 'menu' | 'brand' | 'env' | 'primary' | 'actions' | 'lang' | 'mode' | 'account';
export declare const HEADER_ORDER: readonly HeaderSlot[];
interface Labels {
  readonly siteName: string;
  readonly signIn: string;
  readonly menu: string;
  readonly switchLang: string;
  readonly otherLang: string;
  readonly env: { readonly qa: string; readonly stage: string };
  readonly search: string;
  readonly back: string;
}
export declare const HEADER_LABELS: { readonly en: Labels; readonly ar: Labels };
export declare function escapeHtml(value: unknown): string;
export declare function brandHtml(opts: { lang: HeaderLang; href: string; app?: string; name?: string; logoSrc?: string }): string;
/** A same-site path from the request: leading slashes/backslashes collapse to one "/" (never protocol-relative). */
export declare function samePath(path: unknown): string;
export declare function envBadgeHtml(environment: string | undefined | null, lang: HeaderLang): string;
export declare function langButtonHtml(opts: { lang: HeaderLang; href: string }): string;
export declare function modeButtonHtml(opts: { lang: HeaderLang; dark: boolean; id?: string }): string;
export declare const MENU_ICON_BODY: string;
/** The menu button opening an `.aun-header-panel` popover (shown below 1024px). */
export declare function menuButtonHtml(opts: { lang: HeaderLang; panel: string }): string;
export declare function signInHtml(opts: { lang: HeaderLang; href: string }): string;
export declare const SEARCH_ICON_BODY: string;
export declare const BACK_ICON_BODY: string;
/** The header search: the phone icon button and the slot (a popover sheet below 1024px) holding the GET form. */
export declare function searchHtml(opts: { lang: HeaderLang; action: string; name?: string; value?: string; placeholder?: string; id?: string }): string;
