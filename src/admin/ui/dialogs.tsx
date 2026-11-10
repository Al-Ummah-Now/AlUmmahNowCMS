/** @jsxImportSource hono/jsx */
/**
 * The staff screens' in-app dialogs, rendered in the page's language; src/admin/client/dialogs.ts drives them.
 * Only strings and icons here (no server modules), so the DOM tests can render them as-is.
 */
import type { AdminStrings } from "../i18n.ts";
import { Icon } from "./icons.tsx";

/** Anything with the page's strings (a View). */
type HasStrings = { t: AdminStrings };

/**
 * The page's confirm dialog (src/admin/client/dialogs.ts `askConfirm`). Cancel has the initial focus; Esc or
 * the backdrop cancel. The client can swap the title, body and button label per call. `reason` renders the optional reason
 * field for soft deletes (docs/SOFT_DELETE.md); a call shows it with `askConfirm({ reason: true })`.
 */
export function ConfirmDialog(props: { v: HasStrings; title: string; body: string; ok?: string; okIcon?: "trash" | "x"; reason?: boolean }) {
   const { t } = props.v;
   return (
      <dialog class="dlg sm" id="confirm" aria-labelledby="confirm-h" aria-describedby="confirm-p">
         <form method="dialog">
            <div class="dlg-h">
               <h2 id="confirm-h">{props.title}</h2>
            </div>
            <div class="dlg-b" style="display:grid;gap:14px">
               <p id="confirm-p" style="margin:0">
                  {props.body}
               </p>
               {props.reason ? (
                  <div class="field" data-reason-field hidden>
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
                  <span data-confirm-icon>
                     <Icon name={props.okIcon ?? "trash"} size={16} />
                  </span>{" "}
                  <span data-confirm-label>{props.ok ?? t.common.delete}</span>
               </button>
            </div>
         </form>
      </dialog>
   );
}

/**
 * "Leave this page?" — shown on in-app link clicks while an upload runs or the editor has unsaved changes
 * (src/admin/client/dialogs.ts). Stay has the initial focus; Esc or the backdrop stay.
 */
export function LeaveDialog(props: { v: HasStrings }) {
   const { t } = props.v;
   return (
      <dialog class="dlg sm" id="leave-dlg" aria-labelledby="leave-h" aria-describedby="leave-p" data-uploading={t.common.leaveUploading} data-unsaved={t.common.leaveUnsaved}>
         <form method="dialog">
            <div class="dlg-h">
               <h2 id="leave-h">{t.common.leaveTitle}</h2>
            </div>
            <div class="dlg-b">
               <p id="leave-p" style="margin:0" />
            </div>
            <div class="dlg-f">
               <button class="btn" value="stay" autofocus>
                  {t.common.stay}
               </button>
               <button class="btn danger" value="leave">
                  {t.common.leaveAnyway}
               </button>
            </div>
         </form>
      </dialog>
   );
}

/** The markdown toolbars' "Insert link" dialog (src/admin/client/dialogs.ts `askLink`). */
export function LinkDialog(props: { v: HasStrings }) {
   const { t } = props.v;
   return (
      <dialog class="dlg sm" id="link-dlg" aria-labelledby="link-h">
         <form method="dialog" novalidate>
            <div class="dlg-h">
               <h2 id="link-h">{t.common.linkTitle}</h2>
            </div>
            <div class="dlg-b">
               <div class="field">
                  <label for="link-url">{t.common.linkLabel}</label>
                  <input id="link-url" type="url" dir="ltr" inputmode="url" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck={false} maxlength={2048} aria-describedby="link-help link-err" />
                  <p class="help" id="link-help">
                     {t.common.linkHelp}
                  </p>
                  <p class="err" id="link-err" aria-live="polite" hidden data-msg={t.common.linkBad} />
               </div>
            </div>
            <div class="dlg-f">
               <button class="btn" value="cancel" formnovalidate>
                  {t.common.cancel}
               </button>
               <button class="btn primary" value="ok" data-link-ok>
                  <Icon name="link" size={16} /> {t.common.insert}
               </button>
            </div>
         </form>
      </dialog>
   );
}
