/**
 * The staff screens' one client script (built by scripts/build-admin-client.ts into
 * src/admin/client.generated.ts). Pages work without it for reading; it adds the drawer, menus,
 * toasts, the session watcher and the editors' behaviour, all driven by data-* attributes.
 */
import { $$, strings, toast } from "./dom.ts";
import { initEditor } from "./editor.ts";
import { initPicker } from "./picker.ts";
import { initRows } from "./rows.ts";
import { initShell } from "./shell.ts";
import { initTimes } from "./time.ts";

initShell();
initTimes();
initPicker();
initEditor();
initRows();

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
