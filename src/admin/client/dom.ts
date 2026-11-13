/** Small DOM helpers shared by the client modules. */
export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
   const e = document.createElement(tag);
   for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
   e.append(...children);
   return e;
}

/** The confirm dialog's optional reason (soft deletes), read once and cleared for the next use. */
export function takeReason(dlg: ParentNode | null): string | undefined {
   const field = dlg?.querySelector<HTMLTextAreaElement>("[data-confirm-reason]");
   if (!field) return undefined;
   const value = field.value.trim();
   field.value = "";
   return value || undefined;
}

/** Page-provided strings (a JSON <script id="i18n">). */
export function strings<T = Record<string, string>>(id = "i18n"): T {
   const node = document.getElementById(id);
   return (node ? JSON.parse(node.textContent || "{}") : {}) as T;
}

const OK = '<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const BAD = '<svg class="icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>';

export function toast(message: string, kind: "ok" | "bad" = "ok"): void {
   const host = document.getElementById("toasts");
   if (!host) return;
   const t = el("div", { class: `toast ${kind}` });
   t.innerHTML = kind === "ok" ? OK : BAD;
   t.append(message);
   host.append(t);
   setTimeout(() => t.remove(), kind === "ok" ? 3500 : 7000);
}

/** JSON request to the same origin (bknd's API or ours). Throws ApiError on a non-2xx answer. */
export class ApiError extends Error {
   constructor(
      readonly status: number,
      readonly body: unknown,
   ) {
      super(errorMessage(body) ?? `HTTP ${status}`);
   }
}

export function errorMessage(body: unknown): string | undefined {
   if (!body || typeof body !== "object") return undefined;
   const b = body as Record<string, unknown>;
   for (const k of ["message", "error"]) if (typeof b[k] === "string") return b[k] as string;
   if (b.error && typeof b.error === "object") return errorMessage(b.error);
   return undefined;
}

/**
 * Uploads in flight (requests with a FormData body). Leaving the page cancels them (the editor's language
 * links, the UI language toggle and nav links are full page loads), so while any is running, in-app links
 * ask first (src/admin/client/dialogs.ts initLeaveGuard).
 */
let uploadsInFlight = 0;

export const uploadInProgress = (): boolean => uploadsInFlight > 0;

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
   if (body instanceof FormData) {
      uploadsInFlight++;
      try {
         return await request<T>(method, url, body);
      } finally {
         uploadsInFlight--;
      }
   }
   return request<T>(method, url, body);
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
   const init: RequestInit = { method, credentials: "same-origin", headers: { accept: "application/json" } };
   if (body instanceof FormData) init.body = body;
   else if (body !== undefined) {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)["content-type"] = "application/json";
   }
   const res = await fetch(url, init);
   const text = await res.text();
   let parsed: unknown;
   try {
      parsed = text ? JSON.parse(text) : undefined;
   } catch {
      parsed = text;
   }
   if (res.status === 401) location.replace(`/sso/login?return=${encodeURIComponent(location.pathname + location.search)}`);
   if (!res.ok) throw new ApiError(res.status, parsed);
   return parsed as T;
}

const GUTTER = 8;
const fitted = new Set<HTMLElement>();
const observers = new Map<HTMLElement, ResizeObserver>();
let listening = false;

function stopObserving(el: HTMLElement): void {
   observers.get(el)?.disconnect();
   observers.delete(el);
}

/** Re-fit when the popup's size changes (results arriving after it opened); the last size guards against our own cap. */
function observe(el: HTMLElement): void {
   if (observers.has(el) || typeof ResizeObserver === "undefined") return;
   let last = "";
   const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const size = `${Math.round(r.width)}x${Math.round(r.height)}`;
      if (size === last) return;
      last = size;
      fitToViewport(el);
   });
   ro.observe(el);
   observers.set(el, ro);
}

/** The visible area in getBoundingClientRect coordinates: the visual viewport (an on-screen keyboard counts). */
function viewport() {
   const vv = window.visualViewport;
   const width = document.documentElement.clientWidth;
   const height = window.innerHeight;
   if (!vv) return { left: 0, top: 0, right: width, bottom: height };
   return { left: Math.max(0, vv.offsetLeft), top: Math.max(0, vv.offsetTop), right: Math.min(width, vv.offsetLeft + vv.width), bottom: Math.min(height, vv.offsetTop + vv.height) };
}

/**
* Keeps an open popup (header menus, autocomplete and combobox lists) inside the viewport
* (AlUmmahNow docs/design/NAV.md; same function as AlUmmahNow packages/fanous-tokens/nav/menu-fit.js).
* Shift sideways to an 8px gutter, narrow if wider than the screen; below its anchor when it fits,
* else upwards when the anchor has more room above, capped to that room (never a minimum height:
* a 96px floor pushed a picker past a landscape phone's bottom). Re-fits on size change and resize.
*/
export function fitToViewport(el: HTMLElement | null | undefined): void {
   if (!el) return;
   el.style.removeProperty("translate");
   el.style.removeProperty("max-inline-size");
   el.style.removeProperty("max-block-size");
   if (el.hidden || !el.isConnected || el.getClientRects().length === 0) {
      fitted.delete(el);
      stopObserving(el);
      return;
   }
   fitted.add(el);
   observe(el);
   if (!listening) {
      listening = true;
      const refit = () => fitted.forEach((f) => fitToViewport(f));
      window.addEventListener("resize", refit);
      window.visualViewport?.addEventListener("resize", refit);
   }
   const vp = viewport();
   let r = el.getBoundingClientRect();
   if (r.width > vp.right - vp.left - 2 * GUTTER) {
      el.style.maxInlineSize = `${vp.right - vp.left - 2 * GUTTER}px`;
      r = el.getBoundingClientRect();
   }
   const dx = r.left < vp.left + GUTTER ? vp.left + GUTTER - r.left : r.right > vp.right - GUTTER ? vp.right - GUTTER - r.right : 0;
   let dy = 0;
   const below = Math.floor(vp.bottom - GUTTER - Math.max(r.top, vp.top + GUTTER));
   let cap: number | null = r.height > below ? below : null;
   if (cap !== null) {
      // No room below: open upwards when the anchor (the positioned box it hangs from) has more room
      // above. A fixed popup (a phone sheet) has no anchor to flip around.
      const anchor = getComputedStyle(el).position === "fixed" ? null : el.offsetParent;
      if (anchor && anchor !== document.body && anchor !== document.documentElement) {
         const a = anchor.getBoundingClientRect();
         const gap = Math.max(0, r.top - a.bottom);
         const above = Math.floor(a.top - gap - (vp.top + GUTTER));
         if (above > below) {
            const height = Math.min(r.height, above);
            cap = r.height > above ? above : null;
            dy = a.top - gap - height - r.top;
         }
      }
   }
   if (cap !== null) el.style.maxBlockSize = `${Math.max(cap, 0)}px`;
   if (dx || dy) el.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
}
