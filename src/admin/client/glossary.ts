/**
 * The translation glossary screen (src/admin/screens/glossary.tsx): add a term, search as you type,
 * delete (admins, in-app confirm; restorable for 30 days) and restore.
 */
import { $, api, ApiError, el, strings, toast } from "./dom.ts";
import { askConfirm } from "./dialogs.ts";
import { liveSearch, latestOnly } from "./live-search.ts";

interface Entry {
   id: string;
   source_locale: "en" | "ar";
   source_term: string;
   target_locale: "en" | "ar";
   target_term: string;
   note: string | null;
   flag_id: string | null;
   created_by_email: string | null;
   created_at: number;
   deleted_at: number | null;
   deleted_by_email: string | null;
}

interface GStrings {
   arToEn: string;
   enToAr: string;
   fromFlag: string;
   by: string;
   deletedBy: string;
   delete: string;
   restore: string;
   added: string;
   removed: string;
   restored: string;
   exists: string;
   failed: string;
   empty: string;
   emptySearch: string;
   admin: boolean;
   results: string;
   result1: string;
   lang: "en" | "ar";
}

const dir = (l: string) => (l === "ar" ? "rtl" : "ltr");

export function initGlossary(): void {
   const list = $<HTMLUListElement>("[data-gl-list]");
   if (!list) return;
   const G = strings<{ glossary: GStrings }>().glossary;
   const deleted = list.dataset.deleted === "1";
   const count = $("[data-gl-count]");
   const fmt = new Intl.DateTimeFormat(G.lang === "ar" ? "ar-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" });

   const row = (e: Entry) => {
      const when = new Date(deleted ? (e.deleted_at ?? e.created_at) : e.created_at);
      const meta = el(
         "div",
         { class: "li-meta" },
         el("span", { class: "badge loc" }, `${e.source_locale.toUpperCase()} → ${e.target_locale.toUpperCase()}`),
         ...(e.flag_id ? [el("span", { class: "badge trf" }, G.fromFlag)] : []),
         ...(e.note ? [el("span", { dir: "auto" }, e.note)] : []),
         ...(deleted ? [el("span", {}, G.deletedBy.replace("{0}", e.deleted_by_email ?? "—"))] : e.created_by_email ? [el("span", {}, G.by.replace("{0}", e.created_by_email))] : []),
         el("time", { datetime: when.toISOString() }, fmt.format(when)),
      );
      const terms = el(
         "div",
         { class: "gl-terms" },
         el("span", { lang: e.source_locale, dir: dir(e.source_locale) }, e.source_term),
         el("span", { "aria-hidden": "true" }, "→"),
         el("span", { class: "vh" }, e.source_locale === "ar" ? G.arToEn : G.enToAr),
         el("span", { lang: e.target_locale, dir: dir(e.target_locale) }, e.target_term),
      );
      const action = !G.admin
         ? el("span")
         : deleted
           ? el("button", { class: "btn sm", type: "button", "data-gl-restore": e.id }, G.restore)
           : el("button", { class: "btn ghost sm", type: "button", "data-gl-delete": e.id, "aria-label": `${G.delete}: ${e.source_term}` }, G.delete);
      return el("li", { class: "li", "data-gl-id": e.id }, el("div", { class: "li-body" }, terms, meta), action);
   };

   const showCount = (n: number, q: string) => {
      if (count) count.textContent = n === 1 ? G.result1 : G.results.split("{0}").join(String(n));
      let empty = $("[data-gl-empty]");
      if (!n) {
         if (!empty) {
            empty = el("p", { class: "help", "data-gl-empty": "" });
            list.after(empty);
         }
         empty.textContent = q ? G.emptySearch : G.empty;
      } else empty?.remove();
   };

   // Search as you type (the list opened with the newest terms).
   const q = $<HTMLInputElement>("#gl-q");
   const latest = latestOnly();
   const search = async (term: string) => {
      const current = latest();
      try {
         const res = await api<{ entries: Entry[] }>("GET", `/admin/api/glossary?${new URLSearchParams({ q: term, ...(deleted ? { deleted: "1" } : {}) })}`);
         if (!current()) return;
         list.replaceChildren(...res.entries.map(row));
         showCount(res.entries.length, term);
      } catch {
         toast(G.failed, "bad");
      }
   };
   const live = liveSearch(q, search);
   $<HTMLFormElement>("[data-gl-search]")?.addEventListener("submit", (e) => {
      e.preventDefault();
      live.cancel();
      void search(q?.value.trim() ?? "");
   });

   // Add a term.
   const add = $<HTMLFormElement>("[data-gl-add]");
   const err = $("[data-gl-err]");
   add?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(add);
      const src = $<HTMLInputElement>("#gl-src", add)!;
      const tgt = $<HTMLInputElement>("#gl-tgt", add)!;
      for (const input of [src, tgt]) input.toggleAttribute("aria-invalid", !input.value.trim());
      if (!src.value.trim()) return src.focus();
      if (!tgt.value.trim()) return tgt.focus();
      const btn = $<HTMLButtonElement>("button[type=submit]", add)!;
      btn.disabled = true;
      if (err) err.hidden = true;
      try {
         const res = await api<{ entry: Entry }>("POST", "/admin/api/glossary", Object.fromEntries(fd));
         list.prepend(row(res.entry));
         showCount(list.children.length, "");
         src.value = "";
         tgt.value = "";
         ($<HTMLInputElement>("#gl-note", add) ?? src).value = "";
         toast(G.added);
         src.focus();
      } catch (x) {
         const msg = x instanceof ApiError && x.status === 409 ? G.exists : G.failed;
         if (err) {
            err.textContent = msg;
            err.hidden = false;
         }
      } finally {
         btn.disabled = false;
      }
   });

   // Delete (in-app confirm) and restore.
   list.addEventListener("click", async (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>("[data-gl-delete],[data-gl-restore]");
      if (!btn) return;
      const li = btn.closest("li");
      const restoring = btn.hasAttribute("data-gl-restore");
      const id = btn.dataset.glDelete ?? btn.dataset.glRestore ?? "";
      if (!restoring && !(await askConfirm())) return;
      btn.disabled = true;
      try {
         if (restoring) await api("POST", `/admin/api/glossary/${encodeURIComponent(id)}/restore`);
         else await api("DELETE", `/admin/api/glossary/${encodeURIComponent(id)}`);
         const next = (li?.nextElementSibling ?? li?.previousElementSibling) as HTMLElement | null;
         li?.remove();
         showCount(list.children.length, q?.value.trim() ?? "");
         toast(restoring ? G.restored : G.removed);
         ($("button", next ?? document.body) ?? q)?.focus();
      } catch (x) {
         toast(x instanceof ApiError && x.status === 409 ? G.exists : G.failed, "bad");
         btn.disabled = false;
      }
   });
}
