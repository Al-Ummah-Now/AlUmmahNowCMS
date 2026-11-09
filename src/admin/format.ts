/** Display helpers (dates in the UI language, Western digits as on www). */
import type { Lang } from "../lib/i18n.ts";

const tag = (lang: Lang) => (lang === "ar" ? "ar-u-nu-latn" : "en-GB");

export function toDate(v: unknown): Date | null {
   if (v === null || v === undefined || v === "") return null;
   const d = typeof v === "number" ? new Date(v) : new Date(String(v));
   return Number.isNaN(d.getTime()) ? null : d;
}

export function relative(v: unknown, lang: Lang, now = Date.now()): string {
   const d = toDate(v);
   if (!d) return "—";
   const s = Math.round((d.getTime() - now) / 1000);
   const rtf = new Intl.RelativeTimeFormat(tag(lang), { numeric: "auto" });
   const abs = Math.abs(s);
   if (abs < 60) return rtf.format(s, "second");
   if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
   if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
   if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), "day");
   return absolute(d, lang);
}

export function absolute(v: unknown, lang: Lang): string {
   const d = toDate(v);
   if (!d) return "—";
   return new Intl.DateTimeFormat(tag(lang), { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(d) + " UTC";
}

export function bytes(n: unknown, lang: Lang): string {
   const v = Number(n);
   if (!Number.isFinite(v)) return "—";
   const nf = new Intl.NumberFormat(tag(lang), { maximumFractionDigits: 1 });
   if (v < 1024) return `${nf.format(v)} B`;
   if (v < 1024 * 1024) return `${nf.format(v / 1024)} KB`;
   return `${nf.format(v / 1024 / 1024)} MB`;
}
