export declare const MODE_ICON_ATTRS: string;
export declare const SUN_ICON_BODY: string;
export declare const MOON_ICON_BODY: string;
export declare const MODE_TOGGLE_LABELS: {
  readonly en: { readonly toLight: string; readonly toDark: string };
  readonly ar: { readonly toLight: string; readonly toDark: string };
};
export declare function modeToggleLabel(lang: string, dark: boolean): string;
export declare function modeIconSvg(icon: 'sun' | 'moon', cls?: string): string;
