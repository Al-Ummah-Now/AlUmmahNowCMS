/**
 * Per-request presentation: the site theme (docs/ADMIN_UI_SPEC.md §5), light/dark, UI language.
 *
 * Theme: `site.theme` from the videos admin (`GET ${ADMIN_API_URL}/public/site-theme` → `{ theme }`),
 * cached 30 s per isolate, 500 ms timeout, Fawanees on any failure. On QA, stage and local a
 * `?theme=<id>` preview is kept in a cookie for that browser; production ignores it.
 */
import { getCookie, setCookie } from "hono/cookie";
import { pickLang, type Lang } from "../lib/i18n.ts";
import type { Ctx } from "../types.ts";
import { THEME_IDS, type ThemeId } from "./theme/vendor.generated.ts";

export const DEFAULT_THEME: ThemeId = "fawanees";
/**
 * Light or dark (owner decision 2026-11-13: no "System" option). `null` = no choice saved yet: the
 * page follows the device (MODE_SCRIPT in ui/layout.tsx, before paint) until the first click.
 */
export type Mode = "light" | "dark";
export const MODES: readonly Mode[] = ["light", "dark"];

const TTL_MS = 30_000;
const TIMEOUT_MS = 500;
const PREVIEW_COOKIE = "cms_theme_preview";
const MODE_COOKIE = "cms_mode";
export const LANG_COOKIE = "cms_lang";
const YEAR = 365 * 24 * 60 * 60;

export const isThemeId = (v: unknown): v is ThemeId => typeof v === "string" && (THEME_IDS as readonly string[]).includes(v);

let cache: { url: string; at: number; theme: ThemeId } | undefined;

/** Test hook. */
export function resetThemeCache(): void {
   cache = undefined;
}

export async function siteTheme(adminApiUrl: string | undefined, fetcher: typeof fetch, now = Date.now()): Promise<ThemeId> {
   if (!adminApiUrl) return DEFAULT_THEME;
   const url = `${adminApiUrl.replace(/\/+$/, "")}/public/site-theme`;
   if (cache && cache.url === url && now - cache.at < TTL_MS) return cache.theme;
   let theme: ThemeId = DEFAULT_THEME;
   try {
      const res = await fetcher(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json" } });
      if (res.ok) {
         const body = (await res.json()) as { theme?: unknown };
         if (isThemeId(body.theme)) theme = body.theme;
      }
   } catch {
      // slow or down: the default renders, and the next request tries again after the TTL
   }
   cache = { url, at: now, theme };
   return theme;
}

export interface Prefs {
   lang: Lang;
   /** The saved choice; null follows the device. */
   mode: Mode | null;
   theme: ThemeId;
   /** The site's own theme (differs from `theme` while previewing). */
   siteTheme: ThemeId;
   previewing: boolean;
}

const secure = (c: Ctx) => new URL(c.req.url).protocol === "https:";

export async function resolvePrefs(c: Ctx, fetcher: typeof fetch): Promise<Prefs> {
   const url = new URL(c.req.url);
   const opts = { path: "/", sameSite: "Lax" as const, secure: secure(c), httpOnly: true, maxAge: YEAR };

   const qLang = url.searchParams.get("lang");
   let lang: Lang;
   if (qLang === "en" || qLang === "ar") {
      lang = qLang;
      setCookie(c, LANG_COOKIE, qLang, opts);
   } else {
      const saved = getCookie(c, LANG_COOKIE);
      lang = saved === "en" || saved === "ar" ? saved : pickLang(url, c.req.header("Accept-Language") ?? null);
   }

   const qMode = url.searchParams.get("mode");
   let mode: Mode | null;
   if (qMode && (MODES as readonly string[]).includes(qMode)) {
      mode = qMode as Mode;
      setCookie(c, MODE_COOKIE, mode, opts);
   } else {
      const saved = getCookie(c, MODE_COOKIE);
      mode = saved && (MODES as readonly string[]).includes(saved) ? (saved as Mode) : null;
      // "system" (or anything else) saved by an older release: dropped once, so the page shows the
      // device's mode (the value "system" resolved to) until the next click saves light or dark
      if (saved !== undefined && mode === null) setCookie(c, MODE_COOKIE, "", { ...opts, maxAge: 0 });
   }

   const site = await siteTheme(c.env.ADMIN_API_URL, fetcher);
   let theme = site;
   let previewing = false;
   if (c.env.ENVIRONMENT !== "production") {
      const q = url.searchParams.get("theme");
      if (q === "site") setCookie(c, PREVIEW_COOKIE, "", { ...opts, maxAge: 0 });
      const preview = q && q !== "site" ? q : q === "site" ? undefined : getCookie(c, PREVIEW_COOKIE);
      if (isThemeId(preview)) {
         theme = preview;
         previewing = preview !== site;
         if (q === preview) setCookie(c, PREVIEW_COOKIE, preview, opts);
      }
   }
   return { lang, mode, theme, siteTheme: site, previewing };
}
