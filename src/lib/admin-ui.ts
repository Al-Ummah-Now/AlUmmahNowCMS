/** Additions to bknd's prebuilt admin UI (injected by the Worker with HTMLRewriter). */
const ADMIN_LINK_STYLE =
   "background:#0b5394;color:#fff;padding:.6rem 1rem;border-radius:.5rem;font:600 14px/1.2 system-ui,sans-serif;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.25)";
/**
 * Fixed links added to bknd's admin UI. bknd's prebuilt admin SPA has no hook for extra user-menu
 * entries (its `userMenu` option exists only when the admin is bundled from source), so the
 * account menu is a link to the CMS's own /sso/accounts page.
 */
export const ADMIN_LINKS = `<nav aria-label="CMS" style="position:fixed;inset-block-end:1rem;inset-inline-end:1rem;z-index:2147483647;display:flex;gap:.5rem">
<a href="/sso/accounts?return=%2F" style="${ADMIN_LINK_STYLE}">Accounts · الحسابات</a>
<a href="/picker" style="${ADMIN_LINK_STYLE}">Video picker · منتقي الفيديو</a>
</nav>`;

/**
 * Keeps bknd's admin SPA on SSO when its session ends while the page is open: bknd would otherwise
 * show a "missing permission" screen whose Login button routes (client-side) to its own login
 * page. Any SPA navigation to /auth/login, and a signed-out /api/auth/me (checked on focus and
 * every 5 minutes), go straight to /sso/login, which is silent while auth has a browser session.
 */
export const ADMIN_SESSION_SCRIPT = `(() => {
const sso = (path) => location.replace("/sso/login?return=" + encodeURIComponent(path));
const onLogin = () => { if (location.pathname === "/auth/login") sso("/"); };
for (const m of ["pushState", "replaceState"]) { const orig = history[m]; history[m] = function () { const r = orig.apply(this, arguments); onLogin(); return r; }; }
addEventListener("popstate", onLogin);
let busy = false;
const check = async () => {
  if (busy) return; busy = true;
  try { const r = await fetch("/api/auth/me", { credentials: "same-origin", headers: { accept: "application/json" } }); if (r.status === 401 || r.status === 403) sso(location.pathname + location.search); } catch (e) { /* offline: try again later */ }
  finally { busy = false; }
};
addEventListener("focus", check);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
setInterval(check, 5 * 60 * 1000);
onLogin();
})();`;
