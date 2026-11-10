/**
 * Search-as-you-type for the dialogs (videos picker, posts chooser): runs the search after the same
 * pause as the search boxes' suggestions. Enter can also search at once, so two searches can overlap;
 * `latestOnly` makes sure only the newest one renders (an older answer arriving late is dropped
 * instead of adding its rows to the newer list).
 */
import { DEBOUNCE_MS } from "./autocomplete-model.ts";

export interface LiveSearch {
   /** Drops a pending debounced search (call when the form is submitted). */
   cancel(): void;
}

export function liveSearch(input: HTMLInputElement | null, run: (q: string) => void): LiveSearch {
   let timer: ReturnType<typeof setTimeout> | undefined;
   const cancel = () => clearTimeout(timer);
   if (!input) return { cancel };
   input.addEventListener("input", () => {
      cancel();
      timer = setTimeout(() => run(input.value.trim()), DEBOUNCE_MS);
   });
   return { cancel };
}

export { latestOnly } from "./autocomplete-model.ts";
