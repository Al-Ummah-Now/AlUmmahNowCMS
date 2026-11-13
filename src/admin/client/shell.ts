/** Shell behaviour: drawer, popover menus, session watcher. */
import { $, $$, fitToViewport } from "./dom.ts";

export function initShell(): void {
   const drawer = $<HTMLDialogElement>("#drawer");
   const opener = $<HTMLButtonElement>("[data-open-drawer]");
   opener?.addEventListener("click", () => {
      drawer?.showModal();
      opener.setAttribute("aria-expanded", "true");
   });
   $("[data-close-drawer]")?.addEventListener("click", () => drawer?.close());
   drawer?.addEventListener("close", () => {
      opener?.setAttribute("aria-expanded", "false");
      opener?.focus();
   });
   drawer?.addEventListener("click", (e) => {
      if (e.target === drawer) drawer.close();
   });

   // <details data-pop> menus: one open at a time, close on outside click and Escape.
   const pops = $$<HTMLDetailsElement>("details[data-pop]");
   for (const d of pops) {
      d.addEventListener("toggle", () => {
         if (!d.open) return;
         for (const o of pops) if (o !== d) o.open = false;
         fitToViewport(d.querySelector<HTMLElement>(".aun-menu"));
      });
   }
   document.addEventListener("click", (e) => {
      for (const d of pops) if (d.open && !d.contains(e.target as Node)) d.open = false;
   });
   document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      for (const d of pops)
         if (d.open) {
            d.open = false;
            d.querySelector("summary")?.focus();
         }
   });

   // Session watcher: an expired session goes straight to SSO (silent while auth has a session).
   let busy = false;
   const check = async () => {
      if (busy) return;
      busy = true;
      try {
         const r = await fetch("/api/auth/me", { credentials: "same-origin", headers: { accept: "application/json" } });
         if (r.status === 401 || r.status === 403) location.replace(`/sso/login?return=${encodeURIComponent(location.pathname + location.search)}`);
      } catch {
         /* offline: try later */
      } finally {
         busy = false;
      }
   };
   addEventListener("focus", check);
   document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
   });
   setInterval(check, 5 * 60 * 1000);
}
