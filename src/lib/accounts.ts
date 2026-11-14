/**
 * Account chooser for the CMS's own pages (/sso/no-access, /sso/accounts).
 *
 * The list comes from auth's accounts API on the auth origin, read from the BROWSER with a
 * credentialed fetch (auth's `__session` cookie is host-only on the auth origin; the CMS server
 * never sees it). Auth's CORS allow-list must contain the CMS origin.
 *
 *   GET    {AUTH}/session/accounts            → { accounts: [{ userId, isActive, email, name }] } | 401
 *   POST   {AUTH}/session/switch {userId}      → makes that account auth's active one
 *   DELETE {AUTH}/session/accounts/:userId     → signs one account out of the browser session
 *
 * Switch = POST switch, then a silent `/sso/login?prompt=none` (auth issues a code for the new
 * active account). Add account = `/sso/login?prompt=login`. Signing out of the last account is the
 * existing single sign-out (`/sso/logout` → auth `/logout`).
 */
import { esc } from "./html.ts";
import { STRINGS, type Lang } from "./i18n.ts";

/** Where the chooser's buttons go (pure; unit-tested). */
export function accountLinks(returnPath: string) {
   const r = encodeURIComponent(returnPath);
   return {
      silent: `/sso/login?prompt=none&return=${r}`,
      add: `/sso/login?prompt=login&return=${r}`,
      signOutAll: "/sso/logout",
   };
}

/** Styles live in the CMS component system (src/admin/ui/styles.ts, `.gate-accounts`); kept for older callers. */
export const ACCOUNTS_CSS = "";

export function accountsSection(o: { lang: Lang; issuer: string; returnPath: string; hint?: boolean }): { html: string; script: string } {
   const t = STRINGS[o.lang].accounts;
   const links = accountLinks(o.returnPath);
   const html = `<section class="gate-accounts" aria-labelledby="accounts-h">
<h2 id="accounts-h">${esc(t.heading)}</h2>
${o.hint ? `<p>${esc(t.noAccessHint)}</p>` : ""}
<p id="accounts-status" class="status" role="status" aria-live="polite">${esc(t.loading)}</p>
<ul class="list" id="accounts-list"></ul>
<div class="gate-actions">
<a class="btn" id="accounts-add" href="${esc(links.add)}">${esc(t.add)}</a>
<a class="btn ghost" href="${esc(links.signOutAll)}">${esc(t.signOutAll)}</a>
</div>
</section>`;
   const cfg = JSON.stringify({ auth: o.issuer, links, t }).replace(/</g, "\\u003c");
   const script = `(() => {
const C = ${cfg}, T = C.t;
const list = document.getElementById("accounts-list"), status = document.getElementById("accounts-status");
const el = (tag, attrs, text) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v); if (text) e.textContent = text; return e; };
const fail = (msg) => { status.className = "status error"; status.textContent = msg; };
const call = (path, init) => fetch(C.auth + path, { credentials: "include", ...init, headers: { accept: "application/json", ...(init && init.headers) } });
async function load() {
  let accounts;
  try {
    const res = await call("/session/accounts");
    if (!res.ok) throw new Error(String(res.status));
    accounts = ((await res.json()) || {}).accounts;
    if (!Array.isArray(accounts)) throw new Error("bad body");
  } catch (e) { list.replaceChildren(); fail(T.loadFailed); return; }
  status.className = "status"; status.textContent = "";
  list.replaceChildren();
  for (const a of accounts) {
    const label = (typeof a.name === "string" && a.name.trim()) || a.email || a.userId;
    const li = el("li", { class: "li" });
    li.append(el("span", { class: "gate-av", "aria-hidden": "true" }, (Array.from(String(label).trim())[0] || "?").toUpperCase()));
    const who = el("div", { class: "who" });
    const name = el("div", { class: "who-name" });
    name.append(el("span", {}, label));
    if (a.isActive) {
      // "Active" retries the sign-in with this account (silent: auth already has it as the active one)
      const retry = el("button", { type: "button", class: "badge published", title: T.activeRetry, "aria-label": T.active + ": " + T.activeRetry + " (" + label + ")" }, T.active);
      retry.addEventListener("click", () => act(retry, async () => { location.assign(C.links.silent); }));
      name.append(retry);
    }
    who.append(name);
    if (a.email && a.email !== label) who.append(el("div", { class: "email" }, a.email));
    li.append(who);
    const end = el("div", { class: "li-end" });
    if (!a.isActive) {
      const sw = el("button", { type: "button", class: "btn primary", "aria-label": T.switchTo + " " + label }, T.switch);
      sw.addEventListener("click", () => act(sw, async () => {
        const res = await call("/session/switch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: a.userId }) });
        if (!res.ok) throw new Error(String(res.status));
        location.assign(C.links.silent);
      }));
      end.append(sw);
    }
    const out = el("button", { type: "button", class: "btn ghost", "aria-label": T.signOutOf + " " + label }, T.signOut);
    out.addEventListener("click", () => act(out, async () => {
      if (accounts.length <= 1) { location.assign(C.links.signOutAll); return; }
      const res = await call("/session/accounts/" + encodeURIComponent(a.userId), { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      if (a.isActive) location.assign(C.links.silent); else await load();
    }));
    end.append(out);
    li.append(end);
    list.append(li);
  }
}
async function act(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (e) { fail(T.failed); btn.disabled = false; }
}
load();
})();`;
   return { html, script };
}
