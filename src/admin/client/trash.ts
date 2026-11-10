/** Recently deleted (src/admin/screens/trash.tsx): Restore and "Delete permanently now" (type to confirm). */
import { $, api, ApiError, strings, toast } from "./dom.ts";

interface S {
   restored: string;
   purgeQueued: string;
   conflict: string;
   purging: string;
   failed: string;
   word: string;
   confirm: string;
}

function ask(dlg: HTMLDialogElement): Promise<boolean> {
   dlg.showModal();
   return new Promise((resolve) => dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true }));
}

/** The typed word must match, ignoring case and surrounding spaces. */
export const wordMatches = (typed: string, word: string) => typed.trim().toLocaleLowerCase() === word.trim().toLocaleLowerCase();

export function initTrash(): void {
   const list = $("[data-trash]");
   const restoreDlg = $<HTMLDialogElement>("#trash-restore");
   const purgeDlg = $<HTMLDialogElement>("#trash-purge");
   if (!list || !restoreDlg || !purgeDlg) return;
   const T = strings<S>();
   const input = $<HTMLInputElement>("[data-purge-word]", purgeDlg)!;
   const ok = $<HTMLButtonElement>("[data-purge-ok]", purgeDlg)!;
   input.addEventListener("input", () => {
      ok.disabled = !wordMatches(input.value, T.word);
   });
   const fail = (e: unknown) => {
      const code = e instanceof ApiError && e.body && typeof e.body === "object" ? (e.body as { error?: string }).error : undefined;
      toast(code === "conflict" ? T.conflict : code === "purging" ? T.purging : T.failed, "bad");
   };
   list.addEventListener("click", async (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-trash-restore],[data-trash-purge]");
      const li = btn?.closest<HTMLLIElement>("li[data-trash-id]");
      if (!btn || !li) return;
      const id = li.dataset.trashId!;
      if (btn.hasAttribute("data-trash-restore")) {
         if (!(await ask(restoreDlg))) return;
         btn.disabled = true;
         try {
            await api("POST", `/admin/api/trash/${id}/restore`);
            li.remove();
            toast(T.restored);
         } catch (e) {
            btn.disabled = false;
            fail(e);
         }
         return;
      }
      input.value = "";
      ok.disabled = true;
      const confirmed = await ask(purgeDlg);
      if (!confirmed || !wordMatches(input.value, T.word)) return;
      btn.disabled = true;
      try {
         await api("POST", `/admin/api/trash/${id}/purge`, { confirm: T.confirm });
         toast(T.purgeQueued);
         location.reload();
      } catch (e) {
         btn.disabled = false;
         fail(e);
      }
   });
}
