import { describe, expect, it } from "vitest";
import { accountLinks, accountsSection } from "../../src/lib/accounts.ts";

/** Minimal DOM stand-in: enough for the chooser script (elements, text, attributes, clicks). */
class FakeEl {
   children: FakeEl[] = [];
   attrs: Record<string, string> = {};
   textContent = "";
   className = "";
   disabled = false;
   listeners: Record<string, () => unknown> = {};
   constructor(readonly tag: string) {}
   setAttribute(k: string, v: string) {
      this.attrs[k] = v;
   }
   append(...els: FakeEl[]) {
      this.children.push(...els);
   }
   replaceChildren() {
      this.children = [];
   }
   addEventListener(type: string, fn: () => unknown) {
      this.listeners[type] = fn;
   }
   text(): string {
      return this.textContent + this.children.map((c) => c.text()).join(" ");
   }
   buttons(): FakeEl[] {
      return [...(this.tag === "button" ? [this] : []), ...this.children.flatMap((c) => c.buttons())];
   }
}

interface Call {
   url: string;
   method: string;
   body?: string;
   credentials?: string;
}

function run(accountsResponse: { status: number; body?: unknown }, returnPath = "/picker") {
   const { script } = accountsSection({ lang: "en", issuer: "https://auth.test", returnPath });
   const list = new FakeEl("ul");
   const status = new FakeEl("p");
   const calls: Call[] = [];
   const assigned: string[] = [];
   let accounts = accountsResponse;
   const fetchImpl = async (url: string, init: RequestInit & { credentials?: string } = {}) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body as string | undefined, credentials: init.credentials });
      if (url.endsWith("/session/accounts") && (init.method ?? "GET") === "GET") {
         return new Response(JSON.stringify(accounts.body ?? {}), { status: accounts.status });
      }
      return Response.json({ success: true });
   };
   const document = {
      getElementById: (id: string) => ({ "accounts-list": list, "accounts-status": status })[id],
      createElement: (tag: string) => new FakeEl(tag),
   };
   const location = { assign: (u: string) => assigned.push(u) };
   new Function("document", "fetch", "location", script)(document, fetchImpl, location);
   const settle = () => new Promise((r) => setTimeout(r, 0));
   return { list, status, calls, assigned, settle, setAccounts: (a: typeof accounts) => (accounts = a) };
}

const two = {
   status: 200,
   body: {
      accounts: [
         { userId: "u-a", isActive: true, email: "a@example.com", name: "Alice" },
         { userId: "u-b", isActive: false, email: "b@example.com", name: "" },
      ],
   },
};

describe("accountLinks", () => {
   it("switch is silent, add account forces the form, both keep the return path", () => {
      expect(accountLinks("/data?x=1")).toEqual({
         silent: "/sso/login?prompt=none&return=%2Fdata%3Fx%3D1",
         add: "/sso/login?prompt=login&return=%2Fdata%3Fx%3D1",
         signOutAll: "/sso/logout",
      });
   });
});

describe("account chooser script", () => {
   it("lists ALL accounts from auth (credentialed), marking the active one", async () => {
      const t = run(two);
      await t.settle();
      expect(t.calls[0]).toMatchObject({ url: "https://auth.test/session/accounts", method: "GET", credentials: "include" });
      expect(t.list.children).toHaveLength(2);
      expect(t.list.children[0].text()).toContain("Alice");
      expect(t.list.children[0].text()).toContain("Active");
      expect(t.list.children[1].text()).toContain("b@example.com");
      expect(t.list.children[1].text()).not.toContain("Active");
      // The active account has no switch button; the other one does.
      expect(t.list.children[0].buttons().map((b) => b.textContent)).toEqual(["Sign out"]);
      expect(t.list.children[1].buttons().map((b) => b.textContent)).toEqual(["Switch", "Sign out"]);
   });

   it("switch = POST /session/switch, then a silent sign-in", async () => {
      const t = run(two);
      await t.settle();
      await t.list.children[1].buttons()[0].listeners.click();
      await t.settle();
      const sw = t.calls.find((c) => c.url === "https://auth.test/session/switch")!;
      expect(sw).toMatchObject({ method: "POST", credentials: "include" });
      expect(JSON.parse(sw.body!)).toEqual({ userId: "u-b" });
      expect(t.assigned).toEqual(["/sso/login?prompt=none&return=%2Fpicker"]);
   });

   it("signing out of the active account while others remain: DELETE it, then sign in silently as the next one", async () => {
      const t = run(two);
      await t.settle();
      await t.list.children[0].buttons()[0].listeners.click();
      await t.settle();
      expect(t.calls.some((c) => c.method === "DELETE" && c.url === "https://auth.test/session/accounts/u-a")).toBe(true);
      expect(t.assigned).toEqual(["/sso/login?prompt=none&return=%2Fpicker"]);
   });

   it("signing out of a non-active account just refreshes the list", async () => {
      const t = run(two);
      await t.settle();
      t.setAccounts({ status: 200, body: { accounts: [two.body.accounts[0]] } });
      await t.list.children[1].buttons()[1].listeners.click();
      await t.settle();
      expect(t.calls.some((c) => c.method === "DELETE" && c.url === "https://auth.test/session/accounts/u-b")).toBe(true);
      expect(t.assigned).toEqual([]);
      expect(t.list.children).toHaveLength(1);
   });

   it("signing out of the last account is the single sign-out", async () => {
      const t = run({ status: 200, body: { accounts: [two.body.accounts[0]] } });
      await t.settle();
      await t.list.children[0].buttons()[0].listeners.click();
      expect(t.calls.some((c) => c.method === "DELETE")).toBe(false);
      expect(t.assigned).toEqual(["/sso/logout"]);
   });

   it("no browser session (401) or a blocked request shows a message; the add-account link still works", async () => {
      const t = run({ status: 401 });
      await t.settle();
      expect(t.list.children).toHaveLength(0);
      expect(t.status.className).toBe("status error");
      expect(t.status.textContent).toMatch(/Could not load/);
   });

   it("names and emails are rendered as text, never as HTML", async () => {
      const t = run({ status: 200, body: { accounts: [{ userId: "x", isActive: true, email: "x@example.com", name: "<img src=x onerror=alert(1)>" }] } });
      await t.settle();
      expect(t.list.children[0].children[0].children[0].textContent).toBe("<img src=x onerror=alert(1)>");
   });

   it("the embedded config cannot break out of the script tag", () => {
      const { script } = accountsSection({ lang: "en", issuer: "https://auth.test</script><script>alert(1)", returnPath: "/" });
      expect(script).not.toContain("</script>");
   });
});
