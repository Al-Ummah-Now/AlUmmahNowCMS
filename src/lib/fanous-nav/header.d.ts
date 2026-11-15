export type HeaderLang = 'en' | 'ar' | string;
export type HeaderSlot = 'menu' | 'brand' | 'env' | 'primary' | 'actions' | 'apps' | 'lang' | 'mode' | 'account';
export declare const HEADER_ORDER: readonly HeaderSlot[];
interface Labels {
  readonly siteName: string;
  readonly apps: string;
  readonly www: string;
  readonly videos: string;
  readonly signIn: string;
  readonly switchLang: string;
  readonly otherLang: string;
  readonly env: { readonly qa: string; readonly stage: string };
}
export declare const HEADER_LABELS: { readonly en: Labels; readonly ar: Labels };
export declare function escapeHtml(value: unknown): string;
export declare function brandHtml(opts: { lang: HeaderLang; href: string; app?: string; name?: string; logoSrc?: string }): string;
/** A same-site path from the request: leading slashes/backslashes collapse to one "/" (never protocol-relative). */
export declare function samePath(path: unknown): string;
export declare function envBadgeHtml(environment: string | undefined | null, lang: HeaderLang): string;
export declare function appLinksHtml(opts: { lang: HeaderLang; links: { id: string; href: string }[]; iconBase?: string }): string;
export declare function langButtonHtml(opts: { lang: HeaderLang; href: string }): string;
export declare function modeButtonHtml(opts: { lang: HeaderLang; dark: boolean; id?: string }): string;
export declare function signInHtml(opts: { lang: HeaderLang; href: string }): string;
