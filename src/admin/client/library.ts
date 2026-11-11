/**
 * The Videos screen (src/admin/screens/videos-library.tsx): add a video to the CMS video library from
 * the picker, set a video's language, delete (soft, with an optional reason; it leaves /videos only).
 */
import { $$, api, ApiError, strings, takeReason, toast } from "./dom.ts";
import { askConfirm } from "./dialogs.ts";
import { openPicker } from "./picker.ts";

interface S {
   failed: string;
   saved: string;
   added: string;
   already: string;
   deleted: string;
}

export function initLibrary(): void {
   const list = document.querySelector<HTMLElement>("[data-library]");
   const adders = $$<HTMLButtonElement>("[data-library-add]");
   if (!list && !adders.length) return;
   const T = strings<S>();
   const fail = (e: unknown) => toast(e instanceof ApiError ? `${T.failed} ${e.message}` : T.failed, "bad");

   for (const b of adders) {
      b.addEventListener("click", () =>
         openPicker(async (item) => {
            try {
               const res = await api<{ data: { added: boolean } }>("POST", "/admin/api/library", { kind: item.kind, ref_id: item.id, locale: "all" });
               toast(res.data.added ? T.added : T.already, res.data.added ? "ok" : "bad");
               if (res.data.added) setTimeout(() => location.reload(), 500);
            } catch (e) {
               fail(e);
            }
         }, b),
      );
   }

   list?.addEventListener("change", async (ev) => {
      const sel = (ev.target as HTMLElement).closest<HTMLSelectElement>("select[data-library-locale]");
      const li = sel?.closest<HTMLLIElement>("li[data-id]");
      if (!sel || !li) return;
      try {
         await api("PATCH", `/admin/api/library/${li.dataset.id}`, { locale: sel.value });
         toast(T.saved);
      } catch (e) {
         fail(e);
      }
   });

   list?.addEventListener("click", async (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-library-delete]");
      const li = btn?.closest<HTMLLIElement>("li[data-id]");
      if (!btn || !li) return;
      if (!(await askConfirm({ reason: true }))) return;
      const reason = takeReason(document.getElementById("confirm"));
      btn.disabled = true;
      try {
         await api("DELETE", `/admin/api/library/${li.dataset.id}`, reason ? { reason } : {});
         toast(T.deleted);
         li.remove();
      } catch (e) {
         fail(e);
         btn.disabled = false;
      }
   });
}
