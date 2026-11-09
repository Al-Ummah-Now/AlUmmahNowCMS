/** @jsxImportSource hono/jsx */
/** Small shared pieces: page strings for the client script, the confirm dialog. */
import { raw } from "hono/html";
import { Icon } from "./icons.tsx";
import type { View } from "./layout.tsx";

/** Strings the client script needs, as JSON (`<` escaped so it can't close the script). */
export function I18nScript(props: { nonce: string; strings: unknown }) {
   const json = JSON.stringify(props.strings).replace(/</g, "\\u003c");
   return (
      <script type="application/json" id="i18n" nonce={props.nonce}>
         {raw(json)}
      </script>
   );
}

export function ConfirmDialog(props: { v: View; title: string; body: string }) {
   const { t } = props.v;
   return (
      <dialog class="dlg sm" id="confirm" aria-labelledby="confirm-h">
         <form method="dialog">
            <div class="dlg-h">
               <h2 id="confirm-h">{props.title}</h2>
            </div>
            <div class="dlg-b">
               <p style="margin:0">{props.body}</p>
            </div>
            <div class="dlg-f">
               <button class="btn" value="cancel" autofocus>
                  {t.common.cancel}
               </button>
               <button class="btn danger" value="ok" data-confirm-ok>
                  <Icon name="trash" size={16} /> {t.common.delete}
               </button>
            </div>
         </form>
      </dialog>
   );
}
