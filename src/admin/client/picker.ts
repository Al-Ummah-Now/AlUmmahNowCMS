/** The picker dialog: search the public videos platform and hand the chosen item to a callback. */
import { $, api, el, strings } from "./dom.ts";
import { liveSearch } from "./live-search.ts";

export interface PickedItem {
   kind: "video" | "playlist" | "channel";
   id: string;
   title: string;
   thumbnail_url: string | null;
   channel_name: string | null;
   embed_url: string | null;
}

interface PickerStrings {
   picker: { searching: string; noResults: string; failed: string; choose: string; by: string; queryHint: string; kinds: Record<string, string> };
}

let onPick: ((item: PickedItem) => void | Promise<void>) | null = null;
let opener: HTMLElement | null = null;

export function openPicker(cb: (item: PickedItem) => void | Promise<void>, from?: HTMLElement): void {
   const dlg = $<HTMLDialogElement>("#picker");
   if (!dlg) return;
   onPick = cb;
   opener = from ?? null;
   dlg.showModal();
   $<HTMLInputElement>("#picker-q", dlg)?.focus();
}

export function initPicker(): void {
   const dlg = $<HTMLDialogElement>("#picker");
   if (!dlg) return;
   const T = strings<PickerStrings>().picker;
   const status = $("[data-picker-status]", dlg)!;
   const results = $("[data-picker-results]", dlg)!;
   $("[data-picker-close]", dlg)?.addEventListener("click", () => dlg.close());
   dlg.addEventListener("close", () => opener?.focus());
   dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
   });
   const pickerForm = $<HTMLFormElement>("[data-picker-form]", dlg);
   // Results follow the typing; a one-letter query waits for more (the submit handler says so on Enter).
   liveSearch($<HTMLInputElement>("input[name=q]", pickerForm ?? dlg), (q) => {
      if (q.length >= 2) pickerForm?.requestSubmit();
   });
   pickerForm?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const form = ev.target as HTMLFormElement;
      const fd = new FormData(form);
      const q = String(fd.get("q") ?? "").trim();
      const kind = String(fd.get("kind") ?? "video");
      if (q.length < 2) {
         status.textContent = T.queryHint;
         return;
      }
      status.textContent = T.searching;
      results.replaceChildren();
      try {
         const { items } = await api<{ items: PickedItem[] }>("GET", `/picker/api/search?kind=${encodeURIComponent(kind)}&q=${encodeURIComponent(q)}`);
         status.textContent = items.length ? `${items.length} · ${T.kinds[kind] ?? kind}` : T.noResults;
         for (const it of items) {
            const li = el("li", { "data-pick-id": it.id });
            li.append(it.thumbnail_url ? el("img", { src: it.thumbnail_url, alt: "", loading: "lazy" }) : el("span", { class: "ph" }));
            const box = el("div", {}, el("div", { class: "t", dir: "auto" }, it.title));
            if (it.channel_name) box.append(el("div", { class: "m", dir: "auto" }, `${T.by} ${it.channel_name}`));
            li.append(box);
            const btn = el("button", { type: "button", class: "btn primary sm", "aria-label": `${T.choose}: ${it.title}` }, T.choose);
            btn.addEventListener("click", async () => {
               btn.setAttribute("disabled", "");
               try {
                  await onPick?.(it);
                  dlg.close();
               } finally {
                  btn.removeAttribute("disabled");
               }
            });
            li.append(btn);
            results.append(li);
         }
      } catch {
         status.textContent = T.failed;
      }
   });
}
