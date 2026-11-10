/** @jsxImportSource hono/jsx */
/** Small shared pieces: page strings for the client script, times, status badges (the dialogs: ./dialogs.tsx). */
import { raw } from "hono/html";
import type { Lang } from "../../lib/i18n.ts";
import type { PublishState } from "../../lib/schedule.ts";
import { absolute, toDate } from "../format.ts";
import type { View } from "./layout.tsx";

/**
 * A moment shown in the reader's own time zone: the server writes UTC (it can't know the zone),
 * the client script rewrites `time[data-local]` with the browser's zone (src/admin/client/time.ts).
 */
export function LocalTime(props: { iso: unknown; lang: Lang; class?: string }) {
   const d = toDate(props.iso);
   if (!d) return <span>—</span>;
   return (
      <time class={props.class} datetime={d.toISOString()} data-local>
         {absolute(d, props.lang)}
      </time>
   );
}

/** Draft / Scheduled / Published, the same pill everywhere (lists, overview, editor). */
export function StateBadge(props: { v: View; state: PublishState; attrs?: Record<string, string> }) {
   return (
      <span class={`badge ${props.state}`} {...(props.attrs ?? {})}>
         {props.v.t.status[props.state]}
      </span>
   );
}

/** Strings the client script needs, as JSON (`<` escaped so it can't close the script). */
export function I18nScript(props: { nonce: string; strings: unknown }) {
   const json = JSON.stringify(props.strings).replace(/</g, "\\u003c");
   return (
      <script type="application/json" id="i18n" nonce={props.nonce}>
         {raw(json)}
      </script>
   );
}

export { ConfirmDialog, LeaveDialog, LinkDialog } from "./dialogs.tsx";
