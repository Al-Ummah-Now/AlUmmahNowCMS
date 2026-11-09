/** @jsxImportSource hono/jsx */
/**
 * The video picker as a dialog inside edit screens (X1). Searches through the Worker's proxy
 * (/picker/api/search: public results only); the client decides what choosing does
 * (insert a ::video line, add a curated row, or change a row's video).
 */
import { Icon } from "./icons.tsx";
import type { View } from "./layout.tsx";

export function PickerDialog(props: { v: View; kinds?: ("video" | "playlist" | "channel")[] }) {
   const { t } = props.v;
   const kinds = props.kinds ?? ["video"];
   return (
      <dialog class="dlg picker" id="picker" aria-labelledby="picker-h">
         <div class="dlg-h">
            <h2 id="picker-h">{t.picker.title}</h2>
            <button class="ic" type="button" data-picker-close aria-label={t.picker.close} style="color:inherit">
               <Icon name="x" />
            </button>
         </div>
         <div class="dlg-b stack">
            <form class="picker-form" data-picker-form role="search" novalidate>
               {kinds.length > 1 ? (
                  <div class="seg" role="radiogroup" aria-label={t.picker.kind}>
                     {kinds.map((k, i) => (
                        <label>
                           <input type="radio" name="kind" value={k} checked={i === 0} />
                           {t.picker.kinds[k]}
                        </label>
                     ))}
                  </div>
               ) : (
                  <input type="hidden" name="kind" value={kinds[0]} />
               )}
               <div class="search" style="background:var(--fanous-c-form-input-bg);box-shadow:inset 0 0 0 1px var(--fanous-c-form-input-border)">
                  <label class="vh" for="picker-q">
                     {t.picker.query}
                  </label>
                  <input id="picker-q" name="q" type="search" minlength={2} maxlength={100} placeholder={t.picker.query} autocomplete="off" style="color:var(--fanous-c-form-input-text)" />
                  <button type="submit" aria-label={t.picker.search}>
                     <Icon name="search" />
                  </button>
               </div>
            </form>
            <p class="muted" data-picker-status role="status" aria-live="polite" style="margin:0" />
            <ul class="picker-results" data-picker-results />
         </div>
      </dialog>
   );
}
