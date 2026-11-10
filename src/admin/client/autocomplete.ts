/**
 * Live suggestions in the search boxes (header search, the Pages and Posts lists). Each box is
 * server-rendered as an ARIA 1.2 combobox (ui/autocomplete.tsx); this fills its listbox as the
 * editor types, debounced, a newer keystroke aborting the older request. Enter with nothing
 * chosen still submits the form (the full search); choosing a suggestion opens it.
 * The behaviour lives in autocomplete-model.ts.
 */
import { $, $$, el, strings } from "./dom.ts";
import { DEBOUNCE_MS, MIN_QUERY, announcement, closed, failed, initialState, keyDown, received, typed, type Option, type State, type Suggestion } from "./autocomplete-model.ts";

interface Strings {
   acSearching: string;
   acFailed: string;
   acNone: string;
   acCount: string;
   acSearchAll: string;
}

export function initAutocomplete(): void {
   const T = strings<Strings>("i18n-shell");
   for (const root of $$<HTMLElement>("[data-ac]")) attach(root, T);
}

function attach(root: HTMLElement, T: Strings): void {
   const input = $<HTMLInputElement>("input[role=combobox]", root);
   const list = $<HTMLUListElement>("[role=listbox]", root);
   const live = $<HTMLElement>("[data-ac-status]", root);
   if (!input || !list || !live) return;
   const kind = root.dataset.ac ?? "content";
   const locale = root.dataset.acLocale ?? "";
   let state: State = initialState(input.value);
   let timer: ReturnType<typeof setTimeout> | undefined;
   let controller: AbortController | undefined;

   const optionId = (i: number) => `${list.id}-o${i}`;

   const render = () => {
      const expanded = state.open && (state.options.length > 0 || state.status !== "idle");
      input.setAttribute("aria-expanded", String(expanded));
      list.hidden = !expanded;
      if (state.active >= 0 && expanded) input.setAttribute("aria-activedescendant", optionId(state.active));
      else input.removeAttribute("aria-activedescendant");
      list.replaceChildren(...state.options.map((o, i) => optionEl(o, i)));
      if (expanded && state.status === "loading" && state.options.length === 0) list.append(el("li", { role: "presentation", class: "ac-note" }, T.acSearching));
      const said = announcement({ ...state, open: expanded }, { searching: T.acSearching, failed: T.acFailed, none: T.acNone, count: T.acCount });
      if (live.textContent !== said) live.textContent = said;
      if (state.active >= 0) document.getElementById(optionId(state.active))?.scrollIntoView({ block: "nearest" });
   };

   const optionEl = (o: Option, i: number): HTMLLIElement => {
      const li = el("li", { id: optionId(i), role: "option", "aria-selected": String(i === state.active), class: "ac-opt", "data-option": o.type });
      if (o.type === "searchAll") {
         li.append(el("span", { class: "ac-all" }, `${T.acSearchAll} `, el("bdi", {}, `“${o.query}”`)));
      } else {
         const s = o.suggestion;
         li.dataset.id = s.id;
         li.append(thumb(s));
         const label = el("span", { class: "ac-label", dir: "auto" }, s.label);
         if (s.lang) label.setAttribute("lang", s.lang);
         const text = el("span", { class: "ac-text" }, label);
         if (s.secondary) text.append(el("span", { class: "ac-sub", dir: "auto" }, s.secondary));
         li.append(text);
      }
      // mousedown would blur the input first and close the list
      li.addEventListener("mousedown", (e) => e.preventDefault());
      li.addEventListener("click", () => choose(o));
      li.addEventListener("mousemove", () => {
         if (state.active !== i) set({ ...state, active: i });
      });
      return li;
   };

   const set = (next: State) => {
      state = next;
      render();
   };

   const choose = (o: Option) => {
      set(closed(state));
      if (o.type === "searchAll") {
         input.value = o.query;
         input.form?.requestSubmit();
      } else location.assign(o.suggestion.href);
   };

   const ask = (q: string) => {
      controller?.abort();
      clearTimeout(timer);
      if (q.trim().length < MIN_QUERY) return;
      const mine = new AbortController();
      controller = mine;
      timer = setTimeout(async () => {
         const params = new URLSearchParams({ kind, q: q.trim() });
         if (locale) params.set("locale", locale);
         try {
            const res = await fetch(`/admin/api/suggest?${params}`, { credentials: "same-origin", headers: { accept: "application/json" }, signal: mine.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const { items } = (await res.json()) as { items: Suggestion[] };
            set(received(state, q, items));
         } catch {
            if (!mine.signal.aborted) set(failed(state, q));
         }
      }, DEBOUNCE_MS);
   };

   input.addEventListener("input", () => {
      set(typed(state, input.value));
      ask(input.value);
   });
   input.addEventListener("keydown", (e) => {
      if (e.isComposing) return;
      const r = keyDown(state, e.key, e.altKey);
      if (r.preventDefault) e.preventDefault();
      if (r.effect.type === "clear") input.value = "";
      set(r.state);
      if (r.effect.type === "choose") choose(r.effect.option);
   });
   input.addEventListener("blur", () => set(closed(state)));
   input.addEventListener("focus", () => {
      if (state.options.length > 0 && state.query.trim().length >= MIN_QUERY) set({ ...state, open: true });
   });
}

function thumb(s: Suggestion): HTMLElement {
   if (s.imageUrl) return el("img", { src: s.imageUrl, alt: "", loading: "lazy", class: "ac-img" });
   return el("span", { class: "ac-img ac-ph", "aria-hidden": "true" }, Array.from(s.label.trim())[0]?.toUpperCase() ?? "·");
}
