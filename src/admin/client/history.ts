/** Content history (#8): restore a version through the same lock as a save. */
import { $, api, ApiError, strings, toast } from "./dom.ts";

interface S {
   conflict: string;
   slugTaken: string;
   failed: string;
}

export function initHistory(): void {
   const root = $("[data-history]");
   const button = $<HTMLButtonElement>("[data-restore]");
   const dlg = $<HTMLDialogElement>("#restore-dlg");
   if (!root || !button || !dlg) return;
   const T = strings<S>();
   button.addEventListener("click", () => dlg.showModal());
   dlg.addEventListener("close", async () => {
      if (dlg.returnValue !== "ok") {
         button.focus();
         return;
      }
      button.setAttribute("disabled", "");
      try {
         await api("POST", `/admin/api/revisions/${button.dataset.restore}/restore`, { updated_at: root.dataset.updated ?? "" });
         location.assign(`/${root.dataset.history}/${root.dataset.id}?done=restored`);
      } catch (e) {
         // Friendly messages only: the lock (someone saved since), a taken address, anything else.
         const code = e instanceof ApiError && e.body && typeof e.body === "object" ? (e.body as { error?: string }).error : undefined;
         toast(code === "conflict" ? T.conflict : code === "slug_taken" ? T.slugTaken : T.failed, "bad");
         button.removeAttribute("disabled");
         button.focus();
      }
   });
}
