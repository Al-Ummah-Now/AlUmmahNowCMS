/** @jsxImportSource hono/jsx */
/** Small shared pieces: page strings for the client script, the confirm dialog, times, status badges. */
import { raw } from "hono/html";
import type { Lang } from "../../lib/i18n.ts";
import type { PublishState } from "../../lib/schedule.ts";
import { absolute, toDate } from "../format.ts";
import { Icon } from "./icons.tsx";
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

/** In-app confirmation (never a browser prompt). `reason`: an optional reason field (soft deletes, docs/SOFT_DELETE.md). */
export function ConfirmDialog(props: { v: View; title: string; body: string; ok?: string; okIcon?: "trash" | "x"; reason?: boolean }) {
   const { t } = props.v;
   return (
      <dialog class="dlg sm" id="confirm" aria-labelledby="confirm-h">
         <form method="dialog">
            <div class="dlg-h">
               <h2 id="confirm-h">{props.title}</h2>
            </div>
            <div class="dlg-b">
               <p style="margin:0">{props.body}</p>
               {props.reason ? (
                  <div class="field" style="margin-block-start:14px">
                     <label for="confirm-reason">{t.common.reason}</label>
                     <textarea id="confirm-reason" class="input" rows={2} maxlength={500} dir="auto" data-confirm-reason />
                  </div>
               ) : null}
            </div>
            <div class="dlg-f">
               <button class="btn" value="cancel" autofocus>
                  {t.common.cancel}
               </button>
               <button class="btn danger" value="ok" data-confirm-ok>
                  <Icon name={props.okIcon ?? "trash"} size={16} /> {props.ok ?? t.common.delete}
               </button>
            </div>
         </form>
      </dialog>
   );
}
