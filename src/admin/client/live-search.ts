/** Runs a dialog's search as the editor types, after the same pause as the search boxes' suggestions. */
import { DEBOUNCE_MS } from "./autocomplete-model.ts";

export function liveSearch(input: HTMLInputElement | null, run: (q: string) => void): void {
   if (!input) return;
   let timer: ReturnType<typeof setTimeout> | undefined;
   input.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => run(input.value.trim()), DEBOUNCE_MS);
   });
}
