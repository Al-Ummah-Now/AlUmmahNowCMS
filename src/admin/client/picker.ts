/**
 * The picker dialog: browse or search the public videos platform and hand the chosen item to a
 * callback.
 *
 * Opens with content (owner rule 2026-11-11): before anything is typed it lists a first page of
 * the chosen kind (newest videos and playlists, most viewed channels), and the next page loads as
 * the list is scrolled to its end or with "Load more". One typed letter filters what is loaded;
 * from two letters the platform is searched. While the first page loads the list shows skeleton
 * rows; nothing public says so; a failure offers Try again. Items the caller already has
 * (`added`, or the opener's data-picker-added="kind:id …") are marked and cannot be chosen again.
 */
import { $, $$, api, el, strings } from "./dom.ts";
import { latestOnly, liveSearch } from "./live-search.ts";

export interface PickedItem {
   kind: "video" | "playlist" | "channel";
   id: string;
   title: string;
   thumbnail_url: string | null;
   channel_name: string | null;
   embed_url: string | null;
}

interface PickerStrings {
   picker: {
      searching: string;
      noResults: string;
      failed: string;
      choose: string;
      by: string;
      queryHint: string;
      kinds: Record<string, string>;
      newest: string;
      popular: string;
      empty: string;
      loadMore: string;
      loadingMore: string;
      retry: string;
      alreadyAdded: string;
   };
}

export interface PickerOptions {
   /** "kind:id" of items already there: shown, marked, not choosable */
   added?: Iterable<string>;
}

let onPick: ((item: PickedItem) => void | Promise<void>) | null = null;
let opener: HTMLElement | null = null;
let added = new Set<string>();
let browseFirst: (() => void) | null = null;

export function openPicker(cb: (item: PickedItem) => void | Promise<void>, from?: HTMLElement, opts: PickerOptions = {}): void {
   const dlg = $<HTMLDialogElement>("#picker");
   if (!dlg) return;
   onPick = cb;
   opener = from ?? null;
   added = new Set([...(opts.added ?? []), ...(from?.dataset.pickerAdded ?? "").split(/\s+/).filter(Boolean)]);
   dlg.showModal();
   const q = $<HTMLInputElement>("#picker-q", dlg);
   if (q) q.value = "";
   q?.focus();
   browseFirst?.();
}

export const keyOf = (it: Pick<PickedItem, "kind" | "id">) => `${it.kind}:${it.id}`;

export function initPicker(): void {
   const dlg = $<HTMLDialogElement>("#picker");
   if (!dlg) return;
   const T = strings<PickerStrings>().picker;
   const status = $("[data-picker-status]", dlg)!;
   const results = $<HTMLUListElement>("[data-picker-results]", dlg)!;
   const body = $<HTMLElement>(".dlg-b", dlg) ?? dlg;
   const pickerForm = $<HTMLFormElement>("[data-picker-form]", dlg);
   const input = $<HTMLInputElement>("input[name=q]", pickerForm ?? dlg);
   $("[data-picker-close]", dlg)?.addEventListener("click", () => dlg.close());
   dlg.addEventListener("close", () => opener?.focus());
   dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
   });

   const kindNow = () => String(new FormData(pickerForm ?? undefined).get("kind") ?? "video");
   const fill = (s: string, kind: string) => s.replace("{kind}", (T.kinds[kind] ?? kind).toLocaleLowerCase());

   // The browsed pages of the current kind (kept while the dialog is open, reloaded when it reopens)
   let browsed: { kind: string; items: PickedItem[]; next: string | null; state: "loading" | "more" | "ready" | "error" } | null = null;
   // Browsing and searching each keep only their newest answer
   const beginBrowse = latestOnly();
   const beginSearch = latestOnly();

   const row = (it: PickedItem): HTMLLIElement => {
      const have = added.has(keyOf(it));
      const li = el("li", { "data-pick-id": it.id, ...(have ? { "data-added": "" } : {}) });
      li.append(it.thumbnail_url ? el("img", { src: it.thumbnail_url, alt: "", loading: "lazy" }) : el("span", { class: "ph" }));
      const box = el("div", {}, el("div", { class: "t", dir: "auto" }, it.title));
      if (it.channel_name) box.append(el("div", { class: "m", dir: "auto" }, `${T.by} ${it.channel_name}`));
      li.append(box);
      if (have) {
         li.append(el("span", { class: "muted picker-added" }, T.alreadyAdded));
         return li;
      }
      const btn = el("button", { type: "button", class: "btn primary sm", "aria-label": `${T.choose}: ${it.title}` }, T.choose);
      btn.addEventListener("click", async () => {
         btn.setAttribute("disabled", "");
         try {
            await onPick?.(it);
            added.add(keyOf(it));
            dlg.close();
         } finally {
            btn.removeAttribute("disabled");
         }
      });
      li.append(btn);
      return li;
   };

   const skeleton = () =>
      Array.from({ length: 4 }, () => {
         const li = el("li", { class: "sk-row", "aria-hidden": "true", "data-picker-skeleton": "" });
         li.append(el("span", { class: "ph" }), el("div", {}, el("div", { class: "sk-line" }), el("div", { class: "sk-line short" })));
         return li;
      });

   /** Draws the browsed list (all of it, or the items containing one typed letter). */
   const drawBrowsed = () => {
      if (!browsed) return;
      const typed = (input?.value ?? "").trim().toLocaleLowerCase();
      const items = typed ? browsed.items.filter((it) => `${it.title} ${it.channel_name ?? ""}`.toLocaleLowerCase().includes(typed)) : browsed.items;
      results.setAttribute("aria-busy", String(browsed.state === "loading" || browsed.state === "more"));
      if (browsed.state === "loading") {
         status.textContent = T.searching;
         results.replaceChildren(...skeleton());
         return;
      }
      results.replaceChildren(...items.map(row));
      const tail: HTMLElement[] = [];
      if (browsed.state === "error") {
         status.textContent = T.failed;
         const retry = el("button", { type: "button", class: "btn sm", "data-picker-retry": "" }, T.retry);
         retry.addEventListener("click", () => browse(browsed?.items.length ? browsed.next : null));
         tail.push(el("li", { class: "picker-more" }, retry));
      } else if (browsed.items.length === 0) {
         status.textContent = T.empty;
      } else {
         status.textContent = typed ? (items.length ? `${items.length} · ${T.kinds[browsed.kind] ?? browsed.kind}` : T.noResults) : fill(browsed.kind === "channel" ? T.popular : T.newest, browsed.kind);
         if (browsed.state === "more") tail.push(el("li", { class: "picker-more muted", "data-picker-loading-more": "" }, T.loadingMore));
         else if (browsed.next && !typed) {
            const more = el("button", { type: "button", class: "btn sm", "data-picker-more": "" }, T.loadMore);
            more.addEventListener("click", () => browse(browsed?.next ?? null));
            tail.push(el("li", { class: "picker-more" }, more));
         }
      }
      results.append(...tail);
   };

   /** Loads the first page (cursor null) or the page after the loaded ones. */
   const browse = async (cursor: string | null) => {
      const kind = kindNow();
      const isCurrent = beginBrowse();
      browsed = cursor && browsed?.kind === kind ? { ...browsed, state: "more" } : { kind, items: [], next: null, state: "loading" };
      drawBrowsed();
      try {
         const res = await api<{ items: PickedItem[]; next_cursor?: string | null }>("GET", `/picker/api/search?kind=${encodeURIComponent(kind)}&q=${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
         if (!isCurrent() || !browsed) return;
         const seen = new Set(browsed.items.map((i) => i.id));
         browsed = { kind, items: [...(cursor ? browsed.items : []), ...res.items.filter((i) => !seen.has(i.id))], next: res.next_cursor ?? null, state: "ready" };
      } catch {
         if (!isCurrent() || !browsed) return;
         browsed = { ...browsed, state: "error" };
      }
      if ((input?.value ?? "").trim().length < 2) drawBrowsed();
   };
   browseFirst = () => browse(null);

   // Scrolled near the end of the browsed list: the next page
   body.addEventListener("scroll", () => {
      if (!browsed || browsed.state !== "ready" || !browsed.next || (input?.value ?? "").trim()) return;
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 80) void browse(browsed.next);
   });

   for (const radio of $$<HTMLInputElement>("input[name=kind]", pickerForm ?? dlg)) {
      radio.addEventListener("change", () => {
         if ((input?.value ?? "").trim().length >= 2) pickerForm?.requestSubmit();
         else void browse(null);
      });
   }

   // Results follow the typing: no letters lists the browsed page, one filters it, two or more search.
   const live = liveSearch(input, (q) => {
      if (q.length >= 2) pickerForm?.requestSubmit();
      else {
         beginSearch();
         if (browsed?.kind === kindNow()) drawBrowsed();
         else void browse(null);
      }
   });
   pickerForm?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      live.cancel();
      const isCurrent = beginSearch();
      const fd = new FormData(ev.target as HTMLFormElement);
      const q = String(fd.get("q") ?? "").trim();
      const kind = String(fd.get("kind") ?? "video");
      if (q.length < 2) {
         if (browsed?.kind === kind) drawBrowsed();
         else void browse(null);
         if (q.length === 1 && !browsed?.items.length) status.textContent = T.queryHint;
         return;
      }
      status.textContent = T.searching;
      results.setAttribute("aria-busy", "true");
      results.replaceChildren(...skeleton());
      try {
         const { items } = await api<{ items: PickedItem[] }>("GET", `/picker/api/search?kind=${encodeURIComponent(kind)}&q=${encodeURIComponent(q)}`);
         // A newer search started while this one was in flight: its answer is the one to show.
         if (!isCurrent()) return;
         results.setAttribute("aria-busy", "false");
         status.textContent = items.length ? `${items.length} · ${T.kinds[kind] ?? kind}` : T.noResults;
         results.replaceChildren(...items.map(row));
      } catch {
         if (!isCurrent()) return;
         results.setAttribute("aria-busy", "false");
         results.replaceChildren();
         status.textContent = T.failed;
      }
   });
}
