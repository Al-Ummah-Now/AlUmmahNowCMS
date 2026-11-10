/**
 * The staff screens' in-app dialogs (never the browser's own confirm, prompt or leave-page prompt):
 *  - askConfirm: the page's #confirm dialog (src/admin/ui/dialogs.tsx ConfirmDialog), optionally with a reason
 *    field (soft deletes).
 *  - askLink: the shared #link-dlg "Insert link" dialog, with URL validation; restores the textarea selection.
 *  - the leave guard: an in-app link click while a guard reports a reason (an upload in flight, unsaved
 *    changes) opens #leave-dlg first; "Leave anyway" follows the link. Closing the tab is never prompted.
 * All three are server-rendered so their text is in the page's language. If one is missing, the answer is
 * the safe one (cancel / stay) and a toast says the action didn't work.
 */
import { validBlockUrl } from "../../lib/blocks.ts";
import { $, strings, toast, uploadInProgress } from "./dom.ts";

/** Opens a dialog with no stale answer (Esc keeps the previous returnValue) and resolves with the new one. */
function ask(dlg: HTMLDialogElement): Promise<string> {
   dlg.returnValue = "";
   dlg.showModal();
   return new Promise((resolve) => dlg.addEventListener("close", () => resolve(dlg.returnValue), { once: true }));
}

function missing(): void {
   toast(strings("i18n-shell").failed ?? "", "bad");
}

/* ── Confirm ────────────────────────────────────────────────────────────────────────────────── */

export interface ConfirmOptions {
   /** Prepended to the dialog's own body text (e.g. "This image is used on the site."). */
   extra?: string;
   /** Replace the title / body / destructive button label for this call. */
   title?: string;
   body?: string;
   ok?: string;
   /** Hide the trash icon on the destructive button (e.g. Unpublish). */
   noIcon?: boolean;
   /** Show the optional reason field (soft deletes; the caller reads it with takeReason). */
   reason?: boolean;
}

/** Remembers a node's server-rendered text so per-call overrides don't leak into the next call. */
function setText(node: HTMLElement | null, text: string | undefined, prefix = ""): void {
   if (!node) return;
   node.dataset.original ??= node.textContent ?? "";
   const base = text ?? node.dataset.original;
   node.textContent = prefix ? (base ? `${prefix} ${base}` : prefix) : base;
}

/** Asks the page's confirm dialog; resolves true only on the destructive button. */
export async function askConfirm(opts: ConfirmOptions = {}): Promise<boolean> {
   const dlg = $<HTMLDialogElement>("#confirm");
   if (!dlg) {
      missing();
      return false;
   }
   setText($("#confirm-h", dlg), opts.title);
   setText($("#confirm-p", dlg) ?? $(".dlg-b p", dlg), opts.body, opts.extra);
   setText($("[data-confirm-label]", dlg), opts.ok);
   const icon = $("[data-confirm-icon]", dlg);
   if (icon) icon.hidden = !!opts.noIcon;
   const reasonBox = $("[data-reason-field]", dlg);
   if (reasonBox) {
      reasonBox.hidden = !opts.reason;
      const field = $<HTMLTextAreaElement>("[data-confirm-reason]", reasonBox);
      if (field) field.value = "";
   }
   return (await ask(dlg)) === "ok";
}

/* ── Insert link ────────────────────────────────────────────────────────────────────────────── */

/**
 * A link the markdown renderers accept (site + preview): https://… or a path on this site (/…).
 * javascript:, data:, protocol-relative //host and anything else is refused. Returns the trimmed URL or null.
 */
export function checkLinkUrl(raw: string): string | null {
   const url = raw.trim();
   if (!url || url === "https://") return null;
   // The markdown link syntax ends at ")" or whitespace, so those can't be inside the address.
   if (/[\s()]/.test(url)) return null;
   return validBlockUrl(url) ? url : null;
}

/**
 * Asks for a link address. The textarea's selection is restored afterwards (whatever the answer), so the
 * caller's wrap() puts the link around the text that was selected.
 */
export async function askLink(area?: HTMLTextAreaElement): Promise<string | null> {
   const dlg = $<HTMLDialogElement>("#link-dlg");
   const input = dlg ? $<HTMLInputElement>("#link-url", dlg) : null;
   if (!dlg || !input) {
      missing();
      return null;
   }
   const start = area?.selectionStart ?? 0;
   const end = area?.selectionEnd ?? 0;
   const dir = area?.selectionDirection ?? "none";
   const err = $("#link-err", dlg);
   const form = dlg.querySelector("form");
   const okBtn = $<HTMLButtonElement>("[data-link-ok]", dlg);
   const showError = (on: boolean) => {
      if (err) {
         err.textContent = on ? (err.dataset.msg ?? "") : "";
         err.hidden = !on;
      }
      if (on) input.setAttribute("aria-invalid", "true");
      else input.removeAttribute("aria-invalid");
   };
   const onSubmit = (e: SubmitEvent) => {
      if ((e.submitter as HTMLButtonElement | null)?.value !== "ok") return;
      if (checkLinkUrl(input.value)) return;
      e.preventDefault();
      showError(true);
      input.focus();
   };
   const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      // Enter would submit with the first button (Cancel): treat it as Insert.
      e.preventDefault();
      if (okBtn) form?.requestSubmit(okBtn);
   };
   const onInput = () => showError(false);
   form?.addEventListener("submit", onSubmit);
   input.addEventListener("keydown", onKey);
   input.addEventListener("input", onInput);
   input.value = "https://";
   showError(false);
   const opened = ask(dlg);
   // The URL field gets the focus (caret at the end) so the address can be typed or pasted straight away.
   input.focus();
   input.setSelectionRange?.(input.value.length, input.value.length);
   const answer = await opened;
   form?.removeEventListener("submit", onSubmit);
   input.removeEventListener("keydown", onKey);
   input.removeEventListener("input", onInput);
   if (area) {
      area.focus();
      area.setSelectionRange(start, end, dir);
   }
   return answer === "ok" ? checkLinkUrl(input.value) : null;
}

/* ── Leave guard ────────────────────────────────────────────────────────────────────────────── */

export type LeaveReason = "uploading" | "unsaved";
type Guard = () => LeaveReason | null;

const guards: Guard[] = [() => (uploadInProgress() ? "uploading" : null)];
let leaveInstalled = false;

/** Adds a reason to ask before leaving the page by an in-app link (e.g. the editor's unsaved changes). */
export function addLeaveGuard(guard: Guard): void {
   guards.push(guard);
}

export function leaveReason(): LeaveReason | null {
   for (const g of guards) {
      const r = g();
      if (r) return r;
   }
   return null;
}

/** Asks "Leave this page?"; resolves true on "Leave anyway". Without the dialog: stay. */
export async function askLeave(reason: LeaveReason): Promise<boolean> {
   const dlg = $<HTMLDialogElement>("#leave-dlg");
   if (!dlg) {
      missing();
      return false;
   }
   const p = $("#leave-p", dlg);
   if (p) p.textContent = dlg.dataset[reason] ?? "";
   return (await ask(dlg)) === "leave";
}

/**
 * Same-page links (language switch, nav, menus) ask first while a guard has a reason. Reload, close, back
 * and typed URLs are not intercepted: no browser prompt, ever.
 */
export function initLeaveGuard(): void {
   if (leaveInstalled) return;
   leaveInstalled = true;
   document.addEventListener(
      "click",
      (e) => {
         if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
         const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
         if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download") || a.getAttribute("href")?.startsWith("#")) return;
         const reason = leaveReason();
         if (!reason) return;
         e.preventDefault();
         e.stopPropagation();
         const href = a.href;
         askLeave(reason).then((leave) => {
            if (leave) location.assign(href);
         });
      },
      true,
   );
}
