/** @jsxImportSource hono/jsx */
/**
 * A search box with live suggestions: the ARIA 1.2 combobox markup that client/autocomplete.ts
 * fills. Wrap the search form (or its .search box) in <Autocomplete>; give the input
 * comboboxProps(listId). Without the script it is a plain search box.
 */
import type { Child } from "hono/jsx";

export function comboboxProps(listId: string) {
   return {
      role: "combobox",
      "aria-expanded": "false",
      "aria-controls": listId,
      "aria-autocomplete": "list",
      autocomplete: "off",
   } as const;
}

export function Autocomplete(props: { kind: "content" | "pages" | "posts" | "scholars" | "scholar-posts"; listId: string; label: string; locale?: string; children: Child }) {
   return (
      <div class="ac" data-ac={props.kind} data-ac-locale={props.locale || undefined}>
         {props.children}
         <ul id={props.listId} class="ac-list" role="listbox" aria-label={props.label} hidden />
         <p class="vh" role="status" aria-live="polite" data-ac-status />
      </div>
   );
}
