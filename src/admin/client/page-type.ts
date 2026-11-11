/**
 * The page editor's "Page type" (src/admin/screens/page-type.tsx, docs/specs/WWW-PAGES.md): shows the
 * chosen type's panel, confirms a change of type on a saved page (in-app dialog), and keeps the
 * filter's live preview. readPageType() is what the editor saves (list_kind, list_filter).
 */
import { $, $$, api, el, strings } from "./dom.ts";
import { askConfirm } from "./dialogs.ts";

interface S {
   pageList: { switchTitle: string; switchBody: string; switchOk: string; previewCount: string; previewCount1: string; previewEmpty: string; kindNames: Record<string, string> };
   failed: string;
}

export type PageTypeRead = { ok: true; value: { list_kind: string | null; list_filter?: { kinds: string[]; tag: string | null } } } | { ok: false };

/** What the editor saves; null when the form is not a page form. Shows the "choose a kind" error. */
export function readPageType(form: HTMLFormElement): PageTypeRead | null {
   const checked = $<HTMLInputElement>("input[data-page-type-input]:checked", form);
   if (!checked) return null;
   const type = checked.value || null;
   if (type !== "filter") return { ok: true, value: { list_kind: type } };
   const kinds = $$<HTMLInputElement>("input[data-filter-kind]:checked", form).map((i) => i.value);
   const err = $("#f-kinds-err", form);
   if (err) err.hidden = kinds.length > 0;
   if (!kinds.length) {
      $<HTMLInputElement>("input[data-filter-kind]", form)?.focus();
      return { ok: false };
   }
   const tag = $<HTMLInputElement>("input[data-filter-tag]", form)?.value.trim() || null;
   return { ok: true, value: { list_kind: "filter", list_filter: { kinds, tag } } };
}

export function initPageType(): void {
   const form = $<HTMLFormElement>("form[data-editor=pages]");
   if (!form) return;
   const radios = $$<HTMLInputElement>("input[data-page-type-input]", form);
   if (!radios.length) return;
   const T = strings<S>();
   const saved = form.dataset.pageType ?? "";
   let current = saved;
   const show = (type: string) => {
      for (const p of $$<HTMLElement>("[data-page-panel]", form)) p.hidden = p.dataset.pagePanel !== type;
      if (type === "filter") void preview();
   };

   for (const r of radios) {
      r.addEventListener("change", async () => {
         if (!r.checked) return;
         // A saved page changing type: say what happens to the other type's content first.
         if (form.dataset.id && r.value !== current && r.value !== saved) {
            const yes = await askConfirm({ title: T.pageList.switchTitle, body: T.pageList.switchBody, ok: T.pageList.switchOk, noIcon: true });
            if (!yes) {
               const back = radios.find((x) => x.value === current);
               if (back) back.checked = true;
               return;
            }
         }
         current = r.value;
         show(current);
      });
   }

   // The filter's preview: the first 10 items and the total, as www will list them.
   const panel = $<HTMLElement>("[data-page-panel=filter]", form);
   const count = panel ? $<HTMLElement>("[data-filter-count]", panel) : null;
   const listEl = panel ? $<HTMLElement>("[data-filter-preview]", panel) : null;
   let seq = 0;
   let timer: ReturnType<typeof setTimeout> | undefined;
   const preview = async () => {
      if (!panel || !count || !listEl) return;
      const kinds = $$<HTMLInputElement>("input[data-filter-kind]:checked", panel).map((i) => i.value);
      const tag = $<HTMLInputElement>("input[data-filter-tag]", panel)?.value.trim() ?? "";
      const err = $("#f-kinds-err", form);
      if (err && kinds.length) err.hidden = true;
      const mine = ++seq;
      if (!kinds.length) {
         count.textContent = T.pageList.previewEmpty;
         listEl.replaceChildren();
         return;
      }
      const params = new URLSearchParams({ locale: panel.dataset.filterLocale ?? "en", kinds: kinds.join(","), ...(tag ? { tag } : {}) });
      try {
         const res = await api<{ data: { items: { key: string; kind: string; title: string; date: string }[]; total: number } }>("GET", `/admin/api/lists/preview?${params}`);
         if (mine !== seq) return; // a newer preview is on its way
         const n = res.data.total;
         count.textContent = n === 0 ? T.pageList.previewEmpty : n === 1 ? T.pageList.previewCount1 : T.pageList.previewCount.split("{0}").join(String(n));
         listEl.replaceChildren(
            ...res.data.items.map((i) =>
               el("li", { class: "li" }, el("div", { class: "li-body" }, el("span", { class: "li-title", dir: "auto" }, i.title), el("div", { class: "li-meta" }, el("span", {}, T.pageList.kindNames[i.kind] ?? i.kind), el("span", { dir: "ltr" }, i.date.slice(0, 10))))),
            ),
         );
      } catch {
         if (mine === seq) count.textContent = T.failed;
      }
   };
   const later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void preview(), 250);
   };
   panel?.addEventListener("change", later);
   $<HTMLInputElement>("input[data-filter-tag]", form)?.addEventListener("input", later);
   if (current === "filter") void preview();
}
