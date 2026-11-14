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

   // Below 1024px the header's search sits under the bar, opened by its icon (the link to the
   // list's own search is the no-script way). Escape or a click outside closes it.
   const searchBtn = $<HTMLAnchorElement>("[data-search-toggle]");
   const header = searchBtn?.closest("header");
   const setSearch = (open: boolean) => {
      if (!searchBtn || !header) return;
      header.classList.toggle("search-open", open);
      searchBtn.setAttribute("aria-expanded", String(open));
   };
   if (searchBtn && header) {
      searchBtn.setAttribute("role", "button");
      searchBtn.setAttribute("aria-expanded", "false");
      searchBtn.addEventListener("click", (e) => {
         e.preventDefault();
         const open = !header.classList.contains("search-open");
         setSearch(open);
         if (open) $<HTMLInputElement>("#global-q")?.focus();
      });
      document.addEventListener("click", (e) => {
         if (header.classList.contains("search-open") && !header.contains(e.target as Node)) setSearch(false);
      });
      document.addEventListener("keydown", (e) => {
         if (e.key !== "Escape" || !header.classList.contains("search-open")) return;
         setSearch(false);
         searchBtn.focus();
      });
   }

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
         const back = encodeURIComponent(location.pathname + location.search);
         // A staff passkey grace session past its deadline: the "Passkey needed" page (src/lib/passkeys.ts)
         const passkey = r.status === 403 && ((await r.json().catch(() => null)) as { error?: unknown } | null)?.error === "passkey_required";
         if (passkey) location.replace(`/sso/passkey-needed?return=${back}`);
         else if (r.status === 401 || r.status === 403) location.replace(`/sso/login?return=${back}`);
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
