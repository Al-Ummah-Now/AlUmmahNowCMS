/**
 * Times in the reader's own time zone. The server renders `time[data-local]` in UTC (it can't know
 * the zone); this rewrites them with the browser's zone and fills `[data-tz]` with its name.
 */
import { $$ } from "./dom.ts";

const tag = () => (document.documentElement.lang === "ar" ? "ar-u-nu-latn" : "en-GB");

export function formatLocal(d: Date, locale = tag()): string {
   return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
   }).format(d);
}

export const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/** "2026-11-10T14:30" in the browser's zone, for a datetime-local input. */
export function toLocalInput(d: Date): string {
   const p = (n: number) => String(n).padStart(2, "0");
   return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function initTimes(root: ParentNode = document): void {
   for (const t of $$<HTMLTimeElement>("time[data-local]", root)) {
      const d = new Date(t.dateTime);
      if (!Number.isNaN(d.getTime())) t.textContent = formatLocal(d);
   }
   for (const z of $$("[data-tz]", root)) z.textContent = timeZone();
}
