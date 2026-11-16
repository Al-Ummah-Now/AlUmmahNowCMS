/**
 * The one display formatter for the CMS (server screens and the admin client bundle).
 *
 * Arabic pages show Eastern Arabic (Hindi) numerals ٠–٩ for every formatted value: numbers, counts,
 * dates, times, durations and money. English pages show Arabic numerals 0–9. The numbering system
 * is always explicit (`ar-u-nu-arab`): plain `ar` gives 0–9 in Node and Chromium but ٠–٩ in WebKit,
 * so the server and every browser would disagree.
 *
 * Every `Intl.*` / `toLocale*String` display call goes through this module (test/node/format-guard
 * fails on new ones elsewhere). Ids, URLs, slugs, codes and inputs keep what was typed; inputs
 * accept ٠–٩ and `toAsciiDigits` turns them into 0–9.
 */
export type Lang = "en" | "ar";

/** The Intl locale for a UI language: Arabic always with Eastern Arabic (Hindi) numerals. */
export const intlLocale = (lang: Lang | string): string => (lang === "ar" ? "ar-u-nu-arab" : "en-GB");

const isAr = (lang: Lang | string) => lang === "ar";

export function formatNumber(n: number, lang: Lang | string, opts: Intl.NumberFormatOptions = {}): string {
   return new Intl.NumberFormat(intlLocale(lang), opts).format(n);
}

/** A number for a {placeholder}: numbers are formatted for the language, anything else passes through. */
export const num = (v: unknown, lang: Lang | string): string => (typeof v === "number" && Number.isFinite(v) ? formatNumber(v, lang) : String(v));

/** Fills "{0}", "{1}" (array) or "{name}" (object) placeholders; numbers are formatted for the language. */
export function fill(template: string, values: readonly unknown[] | Record<string, unknown>, lang: Lang | string): string {
   return template.replace(/\{(\w+)\}/g, (m, k: string) => {
      const v = Array.isArray(values) ? values[Number(k)] : (values as Record<string, unknown>)[k];
      return v === undefined ? m : num(v, lang);
   });
}

export const formatCompact = (n: number, lang: Lang | string) => formatNumber(n, lang, { notation: "compact", maximumFractionDigits: 1 });

/** 0.25 → "25%" / "٢٥٪". */
export const formatPercent = (ratio: number, lang: Lang | string, opts: Intl.NumberFormatOptions = {}) => formatNumber(ratio, lang, { style: "percent", maximumFractionDigits: 1, ...opts });

/** Money: Arabic uses the currency's Arabic name («١٫٥٠ دولار أمريكي»), never «US$» inside Arabic text. */
export function formatMoney(amount: number, currency: string, lang: Lang | string, opts: Intl.NumberFormatOptions = {}): string {
   return formatNumber(amount, lang, { style: "currency", currency, currencyDisplay: isAr(lang) ? "name" : "symbol", ...opts });
}

export function toDate(v: unknown): Date | null {
   if (v === null || v === undefined || v === "") return null;
   const d = v instanceof Date ? v : typeof v === "number" ? new Date(v) : new Date(String(v));
   return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDate(v: unknown, lang: Lang | string, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
   const d = toDate(v);
   return d ? new Intl.DateTimeFormat(intlLocale(lang), opts).format(d) : "";
}

export const formatTime = (v: unknown, lang: Lang | string, opts: Intl.DateTimeFormatOptions = {}) => formatDate(v, lang, { timeStyle: "short", ...opts });

export const formatDateTime = (v: unknown, lang: Lang | string, opts: Intl.DateTimeFormatOptions = {}) => formatDate(v, lang, { dateStyle: "medium", timeStyle: "short", ...opts });

/** "5 minutes ago" / «قبل ٥ دقائق»; older than 30 days → `older(d)` (default: a UTC date and time). */
export function formatRelative(v: unknown, lang: Lang | string, now = Date.now(), older?: (d: Date) => string): string {
   const d = toDate(v);
   if (!d) return "—";
   const s = Math.round((d.getTime() - now) / 1000);
   const rtf = new Intl.RelativeTimeFormat(intlLocale(lang), { numeric: "auto" });
   const abs = Math.abs(s);
   if (abs < 60) return rtf.format(s, "second");
   if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
   if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
   if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
   return older ? older(d) : formatDateTime(d, lang, { timeZone: "UTC" }) + " UTC";
}

/** Seconds → "m:ss" or "h:mm:ss", each part formatted for the language. */
export function formatDuration(seconds: number, lang: Lang | string): string {
   const t = Math.max(0, Math.round(seconds));
   const h = Math.floor(t / 3600);
   const m = Math.floor((t % 3600) / 60);
   const s = t % 60;
   const two = (n: number) => formatNumber(n, lang, { minimumIntegerDigits: 2, useGrouping: false });
   return h > 0 ? `${formatNumber(h, lang)}:${two(m)}:${two(s)}` : `${formatNumber(m, lang)}:${two(s)}`;
}

/** The weekday-and-time line the admin shows in the reader's own zone (time[data-local]). */
export const formatLocalLong = (d: Date, lang: Lang | string) =>
   formatDate(d, lang, { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });

/** The page language in a browser ("en" outside one): for modules shared with the server and tests. */
export const docLang = (): string => (globalThis as { document?: { documentElement?: { lang?: string } } }).document?.documentElement?.lang || "en";

/** The reader's IANA time zone (not a display value). */
export const browserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** Joins names: "a, b and c" / «a وb وc». */
export const formatList = (items: string[], lang: Lang | string) => new Intl.ListFormat(isAr(lang) ? "ar" : "en", { style: "long", type: "conjunction" }).format(items);

/** Input normalisation: Eastern Arabic (Hindi) ٠–٩ and Persian ۰–۹ numerals → Arabic numerals 0–9. */
export function toAsciiDigits(s: string): string {
   return s.replace(/[٠-٩۰-۹]/g, (c) => String((c.charCodeAt(0) & 0xf) % 10));
}

/** A typed number → Arabic numerals 0–9 with "." as the decimal mark (٫ → ., the ٬ group mark dropped). */
export const toAsciiNumber = (s: string): string => toAsciiDigits(s).replace(/\u066B/g, ".").replace(/\u066C/g, "");
