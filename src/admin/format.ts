/** Admin display helpers, built on the one formatter (src/lib/format.ts): Arabic shows Eastern Arabic (Hindi) numerals ٠–٩. */
import type { Lang } from "../lib/i18n.ts";
import { formatDateTime, formatNumber, formatRelative, toDate } from "../lib/format.ts";

export { toDate };

export function relative(v: unknown, lang: Lang, now = Date.now()): string {
   return formatRelative(v, lang, now, (d) => absolute(d, lang));
}

export function absolute(v: unknown, lang: Lang): string {
   const d = toDate(v);
   if (!d) return "—";
   return formatDateTime(d, lang, { timeZone: "UTC" }) + " UTC";
}

export function bytes(n: unknown, lang: Lang): string {
   const v = Number(n);
   if (!Number.isFinite(v)) return "—";
   const f = (x: number) => formatNumber(x, lang, { maximumFractionDigits: 1 });
   if (v < 1024) return `${f(v)} B`;
   if (v < 1024 * 1024) return `${f(v / 1024)} KB`;
   return `${f(v / 1024 / 1024)} MB`;
}
