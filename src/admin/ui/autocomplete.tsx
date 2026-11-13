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

export function Autocomplete(props: {
   kind: "content" | "pages" | "posts" | "scholars" | "scholar-posts" | "library" | "tags" | "list-pages";
   listId: string;
   label: string;
   locale?: string;
   /** Choosing fills the input (a form field) instead of opening the item. */
   fill?: boolean;
   /** Opens with content on focus, before anything is typed. */
   initial?: boolean;
   children: Child;
}) {
   return (
      <div class="ac" data-ac={props.kind} data-ac-locale={props.locale || undefined} data-ac-fill={props.fill ? "1" : undefined} data-ac-initial={props.initial ? "1" : undefined}>
         {props.children}
         <ul id={props.listId} class="ac-list" role="listbox" aria-label={props.label} hidden />
         <p class="vh" role="status" aria-live="polite" data-ac-status />
      </div>
   );
}
