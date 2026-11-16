/** @jsxImportSource hono/jsx */
/**
 * The shared localized field pair (docs/LOCALIZED_FIELDS.md): English | العربية side by side, each
 * input with its own lang/dir, and a Translate button under each that fills the OTHER language from it
 * (POST /admin/api/translate). The result stays in the form for the editor to check and change; the
 * screen saves it. Overwriting a non-empty field offers Undo in the pair's live status (never a browser
 * prompt). Errors are tied to their field (aria-invalid + aria-describedby). Behaviour:
 * src/admin/client/localized-pair.ts.
 */
import type { AdminStrings } from "../i18n.ts";

/** What the pair needs of the screen's View (kept narrow: the client tests render it without the server). */
type View = { t: AdminStrings };
import { Icon } from "./icons.tsx";

type L = "en" | "ar";

export interface LocalizedPairProps {
   v: View;
   /** Unique id prefix for this pair's elements. */
   id: string;
   legend: string;
   help?: string;
   values: { en: string | null; ar: string | null };
   /** The form field names each side saves as (data-l10n-name). */
   names: { en: string; ar: string };
   max: number;
   /** Required pair: both sides must be filled (else: both or neither). */
   required?: boolean;
   multiline?: boolean;
   /** Extra content after the inputs (e.g. the pair's own Save button). */
   children?: unknown;
}

/** The strings the client needs, on the pair itself (any screen can use it without its own i18n block). */
export function pairStrings(v: View) {
   const t = v.t.l10n;
   return JSON.stringify({
      english: t.english,
      arabic: t.arabic,
      translating: t.translating,
      filled: t.filled,
      replaced: t.replaced,
      undo: t.undo,
      undone: t.undone,
      typeFirst: t.typeFirst,
      required: t.required,
      quran: t.quran,
      officialText: t.officialText,
      busy: t.busy,
      dailyCap: t.dailyCap,
      unavailable: t.unavailable,
      failed: t.failed,
      notSaved: t.notSaved,
   });
}

export function LocalizedPair(p: LocalizedPairProps) {
   const t = p.v.t.l10n;
   const side = (l: L) => {
      const fid = `${p.id}-${l}`;
      const other: L = l === "en" ? "ar" : "en";
      const common = {
         id: fid,
         class: p.multiline ? "textarea" : "input",
         lang: l,
         dir: l === "ar" ? "rtl" : "ltr",
         maxlength: p.max,
         spellcheck: true,
         autocomplete: "off",
         "data-l10n-input": l,
         "data-l10n-name": p.names[l],
         "aria-describedby": `${fid}-err${p.help ? ` ${p.id}-help` : ""}`,
      };
      return (
         <div class="field l10n-side" data-l10n-side={l}>
            <label for={fid}>{l === "en" ? t.english : t.arabic}</label>
            {p.multiline ? <textarea {...common} rows={3}>{p.values[l] ?? ""}</textarea> : <input {...common} value={p.values[l] ?? ""} />}
            <p class="field-err" id={`${fid}-err`} data-l10n-err={l} hidden />
            <button type="button" class="btn ghost sm l10n-go" data-l10n-translate={l} data-l10n-to={other} aria-describedby={`${p.id}-status`}>
               <Icon name="languages" size={16} /> {l === "en" ? t.toAr : t.toEn}
            </button>
         </div>
      );
   };
   return (
      <fieldset class="l10n-pair" data-l10n-pair data-l10n-required={p.required ? "1" : undefined} data-l10n-strings={pairStrings(p.v)} id={p.id}>
         <legend class="label">{p.legend}</legend>
         {p.help ? (
            <p class="help" id={`${p.id}-help`}>
               {p.help}
            </p>
         ) : null}
         <div class="l10n-cols">
            {side("en")}
            {side("ar")}
         </div>
         <div class="l10n-foot">
            <p class="muted l10n-status" id={`${p.id}-status`} role="status" aria-live="polite" data-l10n-status />
            {p.children}
         </div>
      </fieldset>
   );
}
