/**
 * The search boxes' autocomplete behaviour, apart from the DOM so every key is tested in Node
 * (test/node/autocomplete.test.ts). Same behaviour as the videos admin (AlUmmahNow
 * apps/admin-web/src/components/search/autocomplete-model.ts), so both admins feel the same.
 *
 * WAI-ARIA 1.2 combobox, listbox popup, list autocomplete with manual selection: focus stays in the
 * input, the active option is pointed at with aria-activedescendant, nothing is chosen until Enter
 * or a click. Enter with no option active still submits the search form (the full search).
 */

export interface Suggestion {
   kind: string;
   id: string;
   /** Title: what the editor recognises */
   label: string;
   /** Status, language and address: what tells two similar titles apart */
   secondary: string | null;
   imageUrl: string | null;
   /** The page that opens when it is chosen */
   href: string;
   /** The language of the label, for the screen reader and the font */
   lang?: string | null;
}

export type Option = { type: "suggestion"; suggestion: Suggestion } | { type: "searchAll"; query: string };

export type Status = "idle" | "loading" | "ready" | "error";

export interface State {
   query: string;
   open: boolean;
   /** Index into options; -1 when none is active */
   active: number;
   options: Option[];
   status: Status;
}

export const MIN_QUERY = 2;
export const DEBOUNCE_MS = 200;

export const initialState = (query = ""): State => ({ query, open: false, active: -1, options: [], status: "idle" });

/** The suggestions, then "Search everything for …" (what Enter does). */
export function optionsFor(query: string, suggestions: Suggestion[]): Option[] {
   const options: Option[] = suggestions.map((suggestion) => ({ type: "suggestion", suggestion }));
   const q = query.trim();
   if (q) options.push({ type: "searchAll", query: q });
   return options;
}

export function typed(state: State, query: string): State {
   const asks = query.trim().length >= MIN_QUERY;
   return { query, open: asks, active: -1, options: asks ? state.options : [], status: asks ? "loading" : "idle" };
}

/** Suggestions arrived; an answer for an older query is dropped. */
export function received(state: State, query: string, suggestions: Suggestion[]): State {
   if (query.trim() !== state.query.trim()) return state;
   return { ...state, options: optionsFor(query, suggestions), status: "ready", active: -1 };
}

/** The request failed: "Search everything" still works. */
export function failed(state: State, query: string): State {
   if (query.trim() !== state.query.trim()) return state;
   return { ...state, options: optionsFor(query, []), status: "error", active: -1 };
}

export const closed = (state: State): State => ({ ...state, open: false, active: -1 });

export type Effect = { type: "none" } | { type: "choose"; option: Option } | { type: "default" } | { type: "clear" };

export interface KeyResult {
   state: State;
   effect: Effect;
   preventDefault: boolean;
}

const NONE: Effect = { type: "none" };

export function keyDown(state: State, key: string, alt = false): KeyResult {
   const last = state.options.length - 1;
   switch (key) {
      case "ArrowDown": {
         if (alt) return { state: { ...state, open: state.options.length > 0 || state.status === "loading" }, effect: NONE, preventDefault: true };
         if (state.options.length === 0) return { state, effect: NONE, preventDefault: true };
         if (!state.open) return { state: { ...state, open: true, active: 0 }, effect: NONE, preventDefault: true };
         return { state: { ...state, active: state.active >= last ? 0 : state.active + 1 }, effect: NONE, preventDefault: true };
      }
      case "ArrowUp": {
         if (alt) return { state: closed(state), effect: NONE, preventDefault: true };
         if (state.options.length === 0) return { state, effect: NONE, preventDefault: true };
         if (!state.open) return { state: { ...state, open: true, active: last }, effect: NONE, preventDefault: true };
         return { state: { ...state, active: state.active <= 0 ? last : state.active - 1 }, effect: NONE, preventDefault: true };
      }
      case "Enter": {
         const option = state.open && state.active >= 0 ? state.options[state.active] : undefined;
         if (option) return { state: closed(state), effect: { type: "choose", option }, preventDefault: true };
         return { state: closed(state), effect: { type: "default" }, preventDefault: false };
      }
      case "Escape": {
         if (state.open) return { state: closed(state), effect: NONE, preventDefault: true };
         if (state.query) return { state: initialState(), effect: { type: "clear" }, preventDefault: true };
         return { state, effect: NONE, preventDefault: false };
      }
      case "Tab":
         return { state: closed(state), effect: NONE, preventDefault: false };
      default:
         return { state, effect: NONE, preventDefault: false };
   }
}

/** The polite announcement for the current state ("" when the list is closed). */
export function announcement(state: State, T: { searching: string; failed: string; none: string; count: string }): string {
   if (!state.open) return "";
   const n = state.options.filter((o) => o.type === "suggestion").length;
   if (state.status === "loading" && state.options.length === 0) return T.searching;
   if (state.status === "error") return T.failed;
   if (n === 0) return T.none;
   return T.count.split("{0}").join(String(n));
}

/** `const isCurrent = begin();` … after the await: `if (!isCurrent()) return;` — only the last begun call is current. */
export function latestOnly(): () => () => boolean {
   let seq = 0;
   return () => {
      const mine = ++seq;
      return () => mine === seq;
   };
}
