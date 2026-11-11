/** @jsxImportSource hono/jsx */
/**
 * The page editor's "Page type" (docs/specs/WWW-PAGES.md): Content page (blocks), Curated list (its
 * own list, edited on /pages/:id/list) or Filter (kinds and an optional tag, with a live preview).
 * Behaviour: src/admin/client/page-type.ts; the editor saves list_kind and list_filter.
 */
import type { Child } from "hono/jsx";
import { ITEM_KINDS, storedFilter } from "../../lib/list-filter.ts";
import { Autocomplete, comboboxProps } from "../ui/autocomplete.tsx";
import { Icon } from "../ui/icons.tsx";
import type { View } from "../ui/layout.tsx";

export type PageType = "" | "curated" | "filter";

export const pageTypeOf = (v: unknown): PageType => (v === "curated" || v === "filter" ? v : "");

/** The type switch, shown with the page's title and summary. */
export function PageTypeField(props: { v: View; type: PageType }) {
   const P = props.v.t.pageList;
   const options: [PageType, string, "text" | "list" | "search"][] = [
      ["", P.typeContent, "text"],
      ["curated", P.typeCurated, "list"],
      ["filter", P.typeFilter, "search"],
   ];
   return (
      <div class="field">
         <span class="label" id="f-ptype-l">
            {P.type}
         </span>
         <div class="seg" role="radiogroup" aria-labelledby="f-ptype-l" aria-describedby="f-ptype-help" data-page-type={props.type}>
            {options.map(([value, label, icon]) => (
               <label>
                  <input type="radio" name="list_kind" value={value} checked={props.type === value} data-page-type-input />
                  <Icon name={icon} size={16} /> {label}
               </label>
            ))}
         </div>
         <p class="help" id="f-ptype-help">
            {P.typeHelp}
         </p>
      </div>
   );
}

/** The three panels; only the chosen type's panel is shown. `blocks` is the existing blocks editor. */
export function PageTypePanels(props: { v: View; type: PageType; id: number | null; locale: "en" | "ar"; filter: unknown; blocks: Child }) {
   const { v } = props;
   const P = v.t.pageList;
   const f = storedFilter(props.filter) ?? { kinds: [], tag: null };
   return (
      <>
         <div data-page-panel="" hidden={props.type !== ""}>
            {props.blocks}
         </div>
         <section class="card stack" data-page-panel="curated" hidden={props.type !== "curated"} aria-labelledby="f-curated-h">
            <h2 id="f-curated-h" style="margin:0">
               {P.typeCurated}
            </h2>
            <p class="help" style="margin:0">
               {P.curatedHelp}
            </p>
            {props.id ? (
               <a class="btn primary" style="justify-self:start" href={`/pages/${props.id}/list`} data-edit-list>
                  <Icon name="list" size={18} /> {P.editList}
               </a>
            ) : (
               <p class="notice" style="margin:0">
                  {P.saveFirst}
               </p>
            )}
         </section>
         <section class="card stack" data-page-panel="filter" hidden={props.type !== "filter"} aria-labelledby="f-filter-h" data-filter-locale={props.locale}>
            <h2 id="f-filter-h" style="margin:0">
               {P.typeFilter}
            </h2>
            <fieldset class="field" style="border:0;padding:0;margin:0" aria-describedby="f-kinds-help">
               <legend class="label">{P.kinds}</legend>
               <div style="display:flex;flex-wrap:wrap;gap:8px 18px">
                  {ITEM_KINDS.map((k) => (
                     <label style="display:inline-flex;gap:6px;align-items:center;font-weight:600">
                        <input type="checkbox" name="list_kinds" value={k} checked={f.kinds.includes(k)} data-filter-kind />
                        {P.kindNames[k]}
                     </label>
                  ))}
               </div>
               <p class="help" id="f-kinds-help">
                  {P.kindsHelp}
               </p>
               <p class="err" id="f-kinds-err" hidden>
                  {P.kindsRequired}
               </p>
            </fieldset>
            <div class="field">
               <label for="f-filter-tag">{P.tag}</label>
               <Autocomplete kind="tags" listId="f-filter-tag-list" label={P.tag} locale={props.locale} fill initial>
                  <input id="f-filter-tag" class="input" name="list_tag" value={f.tag ?? ""} maxlength={40} lang={props.locale} dir="auto" aria-describedby="f-tag-help" data-filter-tag {...comboboxProps("f-filter-tag-list")} />
               </Autocomplete>
               <p class="help" id="f-tag-help">
                  {P.tagHelp}
               </p>
            </div>
            <div class="stack" style="gap:6px">
               <h3 style="margin:0;font-size:15px">{P.preview}</h3>
               <p class="muted" role="status" aria-live="polite" style="margin:0" data-filter-count />
               <ul class="list" data-filter-preview />
            </div>
         </section>
      </>
   );
}
