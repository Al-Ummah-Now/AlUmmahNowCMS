/** Small DOM helpers shared by the client modules. */
export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll<T>(sel)];

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
   const e = document.createElement(tag);
   for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
   e.append(...children);
   return e;
}

/** Page-provided strings (a JSON <script id="i18n">). */
export function strings<T = Record<string, string>>(): T {
   const node = document.getElementById("i18n");
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

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
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
