import { describe, expect, it } from "vitest";
import { ADMIN_LINKS, ADMIN_SESSION_SCRIPT } from "../../src/lib/admin-ui.ts";

function boot(path: string, me: () => Promise<Response>) {
   const replaced: string[] = [];
   const listeners: Record<string, () => unknown> = {};
   const location = { pathname: path, search: "", replace: (u: string) => replaced.push(u) };
   const history = {
      pushState(_s: unknown, _t: string, url: string) {
         location.pathname = url;
      },
      replaceState(_s: unknown, _t: string, url: string) {
         location.pathname = url;
      },
   };
   const document = { visibilityState: "visible", addEventListener: (t: string, fn: () => unknown) => (listeners[`doc:${t}`] = fn) };
   const addEventListener = (t: string, fn: () => unknown) => (listeners[t] = fn);
   const intervals: number[] = [];
   const setInterval = (_fn: () => unknown, ms: number) => intervals.push(ms);
   new Function("location", "history", "document", "addEventListener", "fetch", "setInterval", ADMIN_SESSION_SCRIPT)(
      location,
      history,
      document,
      addEventListener,
      me,
      setInterval,
   );
   return { replaced, listeners, history, intervals };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("admin UI additions", () => {
   it("links to the account chooser and the picker", () => {
      expect(ADMIN_LINKS).toContain('href="/sso/accounts?return=%2F"');
      expect(ADMIN_LINKS).toContain('href="/picker"');
   });

   it("an SPA navigation to bknd's own login page goes to SSO instead", () => {
      const t = boot("/data", async () => Response.json({ user: {} }));
      expect(t.replaced).toEqual([]);
      t.history.pushState(null, "", "/auth/login");
      expect(t.replaced).toEqual(["/sso/login?return=%2F"]);
   });

   it("an expired session (me → 403) re-enters SSO on focus, keeping the current page", async () => {
      const t = boot("/data/entity/posts", async () => Response.json({ user: null }, { status: 403 }));
      expect(t.intervals).toEqual([5 * 60 * 1000]);
      await t.listeners.focus();
      await settle();
      expect(t.replaced).toEqual(["/sso/login?return=%2Fdata%2Fentity%2Fposts"]);
   });

   it("a live session or a network error does nothing", async () => {
      const ok = boot("/", async () => Response.json({ user: { id: 1 } }));
      await ok.listeners.focus();
      const offline = boot("/", async () => {
         throw new TypeError("offline");
      });
      await offline.listeners["doc:visibilitychange"]();
      await settle();
      expect(ok.replaced).toEqual([]);
      expect(offline.replaced).toEqual([]);
   });
});
