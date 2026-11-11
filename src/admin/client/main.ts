/**
 * The staff screens' one client script (built by scripts/build-admin-client.ts into
 * src/admin/client.generated.ts). Pages work without it for reading; it adds the drawer, menus,
 * toasts, the session watcher and the editors' behaviour, all driven by data-* attributes.
 */
import { $$, api, strings, toast } from "./dom.ts";
import { initBlocks } from "./blocks.ts";
import { initAi } from "./ai.ts";
import { initAiSettings } from "./ai-settings.ts";
import { initAutocomplete } from "./autocomplete.ts";
import { initLeaveGuard } from "./dialogs.ts";
import { initEditor } from "./editor.ts";
import { initHistory } from "./history.ts";
import { initPicker } from "./picker.ts";
import { initRows } from "./rows.ts";
import { initShell } from "./shell.ts";
import { initFeedFlag, initTimeline } from "./timeline.ts";
import { initTimes } from "./time.ts";
import { initTrash } from "./trash.ts";
import { initScholars } from "./scholars.ts";
import { initLibrary } from "./library.ts";
import { initPageType } from "./page-type.ts";

initShell();
initAutocomplete();
initLeaveGuard();
initTimes();
initPicker();
initBlocks();
initEditor();
initHistory();
initAi();
initRows();
initTimeline();
initFeedFlag();
initTrash();
initAiSettings();
initScholars();
initLibrary();
initPageType();

// Overview: requeue block videos the snapshot queue gave up on.
for (const b of $$<HTMLButtonElement>("[data-retry-videos]")) {
   b.addEventListener("click", async () => {
      b.disabled = true;
      try {
         const res = await api<{ data: { requeued: number } }>("POST", "/admin/api/video-snapshots/retry");
         const n = res.data.requeued;
         toast(n === 1 ? String(b.dataset.doneOne) : String(b.dataset.done).split("{0}").join(String(n)));
         b.closest("[data-video-flag]")?.remove();
      } catch {
         toast(String(b.dataset.failed), "bad");
         b.disabled = false;
      }
   });
}

// <select data-autosubmit> submits its form (list sort).
for (const s of $$<HTMLSelectElement>("select[data-autosubmit]")) s.addEventListener("change", () => s.form?.requestSubmit());

// ?done=… after a save or delete: one toast, then the parameter leaves the address bar.
const url = new URL(location.href);
const done = url.searchParams.get("done");
if (done) {
   const T = strings<Record<string, string>>("i18n-shell");
   const msg = T[done];
   if (msg) toast(msg);
   url.searchParams.delete("done");
   history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
}
