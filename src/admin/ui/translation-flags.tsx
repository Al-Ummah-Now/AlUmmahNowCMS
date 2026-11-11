/** @jsxImportSource hono/jsx */
/**
 * Translation flags in the page/post editor (docs/TRANSLATION_FLAGS.md): the side card, the selection
 * popover and the dialogs. Server-rendered in the page's language; src/admin/client/translation-flags.ts
 * fills and drives them. Rendered only on a saved row that has a version in the other language.
 */
import { REASONS } from "../../lib/translation-flags/store.ts";
import { Icon } from "./icons.tsx";
import type { View } from "./layout.tsx";

type Locale = "en" | "ar";

/** Strings the client needs (JSON: no functions). */
export function trFlagsClientStrings(v: View) {
   const f = v.t.trFlags;
   return { ...f, locales: v.t.locales, common: { cancel: v.t.common.cancel } };
}

export function TrFlagsCard(props: { v: View; canResolve: boolean }) {
   const f = props.v.t.trFlags;
   return (
      <section class="card stack" aria-labelledby="trf-h" data-trf-card style="gap:12px">
         <h2 id="trf-h" style="margin:0;display:flex;align-items:center;gap:8px">
            <Icon name="flag" size={18} /> {f.card} <span class="badge draft" data-trf-count hidden />
         </h2>
         <p class="help">{props.canResolve ? f.intro : f.introWriter}</p>
         <p class="vh" role="status" aria-live="polite" data-trf-live />
         <ul class="list trf-list" data-trf-list aria-labelledby="trf-h" />
         <p class="help" data-trf-none>
            {f.none}
         </p>
         <details class="trf-history" data-trf-history-box>
            <summary>{f.history}</summary>
            <ul class="list trf-list" data-trf-history />
            <p class="help" data-trf-history-none>
               {f.noHistory}
            </p>
         </details>
      </section>
   );
}

/** The selection popover: a small toolbar with one button. Placed next to the selection by the client. */
export function TrFlagsPopover(props: { v: View }) {
   return (
      <div class="trf-pop" data-trf-pop role="toolbar" aria-label={props.v.t.trFlags.flag} hidden>
         <button class="btn sm primary" type="button" data-trf-pop-btn>
            <Icon name="flag" size={16} /> {props.v.t.trFlags.flag}
         </button>
      </div>
   );
}

export function TrFlagsDialogs(props: { v: View; locale: Locale; other: Locale }) {
   const { v, locale, other } = props;
   const f = v.t.trFlags;
   const dir = (l: Locale) => (l === "ar" ? "rtl" : "ltr");
   return (
      <>
         <dialog class="dlg" id="trf-dlg" aria-labelledby="trf-dlg-h">
            <form method="dialog" novalidate>
               <div class="dlg-h">
                  <h2 id="trf-dlg-h">{f.dialogTitle}</h2>
                  <button class="btn ghost sm icon-only" value="cancel" aria-label={f.cancel} formnovalidate>
                     <Icon name="x" size={18} />
                  </button>
               </div>
               <div class="dlg-b stack" style="gap:14px">
                  <div class="stack-sm">
                     <span class="label" id="trf-quote-l">
                        {f.selected}
                     </span>
                     <blockquote class="ai-quote trf-quote" lang={locale} dir={dir(locale)} aria-labelledby="trf-quote-l" data-trf-quote />
                  </div>
                  <div class="stack-sm">
                     <span class="label" id="trf-src-l">
                        {f.source} <span class="muted" data-trf-src-scope />
                     </span>
                     <blockquote class="ai-quote" lang={other} dir={dir(other)} aria-labelledby="trf-src-l" data-trf-src />
                     <p class="help" data-trf-src-none hidden>
                        {f.sourceNone}
                     </p>
                  </div>
                  <fieldset class="field trf-reasons">
                     <legend class="label">{f.reason}</legend>
                     {REASONS.map((r, i) => (
                        <label class="check">
                           <input type="radio" name="trf-reason" value={r} checked={i === 0} /> {f.reasons[r]}
                        </label>
                     ))}
                  </fieldset>
                  <label class="check">
                     <input type="checkbox" data-trf-quran aria-describedby="trf-quran-help" /> {f.isQuran}
                  </label>
                  <p class="help" id="trf-quran-help" style="margin-block-start:-8px">
                     {f.isQuranHelp}
                  </p>
                  <div class="field">
                     <label for="trf-suggestion">{f.suggestion}</label>
                     <textarea id="trf-suggestion" class="textarea" rows={2} maxlength={2000} lang={locale} dir={dir(locale)} style="min-height:60px" />
                  </div>
                  <div class="field">
                     <label for="trf-note">{f.note}</label>
                     <textarea id="trf-note" class="textarea" rows={2} maxlength={1000} dir="auto" style="min-height:60px" />
                  </div>
               </div>
               <div class="dlg-f">
                  <button class="btn" value="cancel" formnovalidate>
                     {f.cancel}
                  </button>
                  <button class="btn primary" value="ok" data-trf-submit>
                     <Icon name="flag" size={18} /> {f.submit}
                  </button>
               </div>
            </form>
         </dialog>

         <dialog class="dlg" id="trf-alt-dlg" aria-labelledby="trf-alt-h">
            <form method="dialog">
               <div class="dlg-h">
                  <h2 id="trf-alt-h">{f.altTitle}</h2>
                  <button class="btn ghost sm icon-only" value="cancel" aria-label={f.cancel}>
                     <Icon name="x" size={18} />
                  </button>
               </div>
               <div class="dlg-b stack" style="gap:12px">
                  <p class="help">{f.altIntro}</p>
                  <blockquote class="ai-quote trf-quote" lang={locale} dir={dir(locale)} data-trf-alt-quote />
                  <p class="help ai-status" role="status" aria-live="polite" data-trf-alt-status />
                  <fieldset class="field trf-alts" data-trf-alts hidden>
                     <legend class="vh">{f.altTitle}</legend>
                  </fieldset>
               </div>
               <div class="dlg-f">
                  <button class="btn" value="cancel">
                     {f.cancel}
                  </button>
                  <button class="btn primary" value="ok" data-trf-alt-use disabled>
                     {f.altUse}
                  </button>
               </div>
            </form>
         </dialog>

         <dialog class="dlg sm" id="trf-edit-dlg" aria-labelledby="trf-edit-h" aria-describedby="trf-edit-p">
            <form method="dialog">
               <div class="dlg-h">
                  <h2 id="trf-edit-h">{f.editTitle}</h2>
               </div>
               <div class="dlg-b stack" style="gap:10px">
                  <p id="trf-edit-p" style="margin:0">
                     {f.editBody}
                  </p>
                  <ul class="trf-edit-list" data-trf-edit-list lang={locale} dir={dir(locale)} />
               </div>
               <div class="dlg-f">
                  <button class="btn" value="keep" autofocus>
                     {f.editKeep}
                  </button>
                  <button class="btn primary" value="resolve">
                     <Icon name="check" size={16} /> {f.editResolve}
                  </button>
               </div>
            </form>
         </dialog>

         <dialog class="dlg sm" id="trf-gloss-dlg" aria-labelledby="trf-gloss-h">
            <form method="dialog" novalidate>
               <div class="dlg-h">
                  <h2 id="trf-gloss-h">{f.glossTitle}</h2>
               </div>
               <div class="dlg-b stack" style="gap:12px">
                  <p class="help">{f.glossIntro}</p>
                  <div class="field">
                     <label for="trf-gloss-src">{f.glossSource.replace("{0}", v.t.locales[other])}</label>
                     <input id="trf-gloss-src" class="input" maxlength={200} lang={other} dir={dir(other)} required />
                  </div>
                  <div class="field">
                     <label for="trf-gloss-tgt">{f.glossTarget.replace("{0}", v.t.locales[locale])}</label>
                     <input id="trf-gloss-tgt" class="input" maxlength={200} lang={locale} dir={dir(locale)} required />
                  </div>
                  <p class="err" data-trf-gloss-err role="alert" hidden />
               </div>
               <div class="dlg-f">
                  <button class="btn" value="cancel" formnovalidate>
                     {f.cancel}
                  </button>
                  <button class="btn primary" value="ok" data-trf-gloss-ok>
                     <Icon name="book" size={16} /> {f.addGlossary}
                  </button>
               </div>
            </form>
         </dialog>
      </>
   );
}
