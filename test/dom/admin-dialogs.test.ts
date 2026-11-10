/**
 * The staff screens' in-app dialogs (src/admin/client/dialogs.ts) against the server-rendered markup
 * (src/admin/ui/dialogs.tsx): confirm (incl. the soft-delete reason field), insert link (URL rules, caret restore),
 * and the leave guard on in-app links. (ESLint forbids the browser's own prompts: eslint.config.js.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addLeaveGuard, askConfirm, askLeave, askLink, checkLinkUrl, initLeaveGuard } from "../../src/admin/client/dialogs.ts";
import { takeReason } from "../../src/admin/client/dom.ts";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";
import { ConfirmDialog, LeaveDialog, LinkDialog } from "../../src/admin/ui/dialogs.tsx";

const tick = () => new Promise((r) => setTimeout(r, 0));

function render(lang: "en" | "ar" = "en"): void {
   const t = ADMIN_STRINGS[lang];
   const v = { t };
   document.documentElement.lang = lang;
   document.body.innerHTML = [
      ConfirmDialog({ v, title: t.common.confirmDelete, body: t.common.confirmDeleteBody, reason: true }),
      LeaveDialog({ v }),
      LinkDialog({ v }),
      '<div id="toasts"></div>',
      `<script type="application/json" id="i18n-shell">${JSON.stringify({ failed: t.common.failed })}</script>`,
   ]
      .map(String)
      .join("");
}

const dlg = (id: string) => document.getElementById(id) as HTMLDialogElement;
const btn = (sel: string) => document.querySelector(sel) as HTMLButtonElement;

beforeEach(() => render());
afterEach(() => vi.restoreAllMocks());

describe("checkLinkUrl", () => {
   it.each(["https://example.com", "https://example.com/a?b=c#d", "/about", "/ar/posts/x", "  https://x.org  "])("accepts %s", (u) => {
      expect(checkLinkUrl(u)).toBe(u.trim());
   });
   it.each([
      "",
      "https://",
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<b>x</b>",
      "vbscript:x",
      "//evil.example",
      "/\\evil",
      "http://example.com",
      "example.com",
      "https://a b",
      "https://x.org/a)b",
      "/a(b)",
      "ftp://x.org",
   ])("rejects %j", (u) => {
      expect(checkLinkUrl(u)).toBeNull();
   });
});

describe("askConfirm", () => {
   it("resolves true on the destructive button, false on Cancel", async () => {
      const yes = askConfirm();
      expect(dlg("confirm").open).toBe(true);
      btn("[data-confirm-ok]").click();
      expect(await yes).toBe(true);
      const no = askConfirm();
      btn('#confirm button[value="cancel"]').click();
      expect(await no).toBe(false);
   });

   it("Esc after an earlier OK is still a cancel (no stale returnValue)", async () => {
      const first = askConfirm();
      btn("[data-confirm-ok]").click();
      await first;
      const second = askConfirm();
      dlg("confirm").close(); // what Esc / the backdrop do: close without a new value
      expect(await second).toBe(false);
   });

   it("Cancel is the initial focus target and the destructive button is danger-styled", () => {
      expect(btn('#confirm button[value="cancel"]').hasAttribute("autofocus")).toBe(true);
      expect(btn("[data-confirm-ok]").classList.contains("danger")).toBe(true);
      expect(dlg("confirm").getAttribute("aria-labelledby")).toBe("confirm-h");
      expect(dlg("confirm").getAttribute("aria-describedby")).toBe("confirm-p");
   });

   it("per-call text overrides don't leak into the next call", async () => {
      const t = ADMIN_STRINGS.en;
      const p = askConfirm({ title: t.common.unpublishTitle, body: t.common.unpublishBody, ok: t.common.unpublish, noIcon: true });
      expect(document.getElementById("confirm-h")!.textContent).toBe(t.common.unpublishTitle);
      expect(document.querySelector("[data-confirm-label]")!.textContent).toBe(t.common.unpublish);
      expect((document.querySelector("[data-confirm-icon]") as HTMLElement).hidden).toBe(true);
      dlg("confirm").close();
      await p;
      const q = askConfirm({ extra: "Used on the site." });
      expect(document.getElementById("confirm-h")!.textContent).toBe(t.common.confirmDelete);
      expect(document.getElementById("confirm-p")!.textContent).toBe(`Used on the site. ${t.common.confirmDeleteBody}`);
      expect(document.querySelector("[data-confirm-label]")!.textContent).toBe(t.common.delete);
      expect((document.querySelector("[data-confirm-icon]") as HTMLElement).hidden).toBe(false);
      dlg("confirm").close();
      await q;
   });

   it("the reason field shows only when asked, starts empty, and takeReason reads it once", async () => {
      const field = document.getElementById("confirm-reason") as HTMLTextAreaElement;
      const box = document.querySelector("[data-reason-field]") as HTMLElement;
      const p = askConfirm({ reason: true });
      expect(box.hidden).toBe(false);
      expect(btn("[data-confirm-ok]").disabled).toBe(false);
      field.value = " duplicate ";
      btn("[data-confirm-ok]").click();
      expect(await p).toBe(true);
      expect(takeReason(dlg("confirm"))).toBe("duplicate");
      expect(takeReason(dlg("confirm"))).toBeUndefined();
      // A cancelled ask doesn't leave its text for the next one; a plain confirm hides the field.
      const q = askConfirm({ reason: true });
      field.value = "left over";
      dlg("confirm").close();
      expect(await q).toBe(false);
      const r = askConfirm();
      expect(box.hidden).toBe(true);
      expect(field.value).toBe("");
      dlg("confirm").close();
      await r;
   });

   it("without the dialog: cancel (fail safe) and a toast, never window.confirm", async () => {
      const native = vi.fn(() => true);
      vi.stubGlobal("confirm", native);
      dlg("confirm").remove();
      expect(await askConfirm()).toBe(false);
      expect(native).not.toHaveBeenCalled();
      expect(document.querySelector("#toasts .toast.bad")?.textContent).toBe(ADMIN_STRINGS.en.common.failed);
      vi.unstubAllGlobals();
   });
});

describe("askLink", () => {
   const area = () => {
      const ta = document.createElement("textarea");
      ta.value = "read the guide here";
      document.body.append(ta);
      ta.setSelectionRange(9, 14); // "guide"
      return ta;
   };

   it("opens prefilled with https://, rejects a javascript: URL inline, inserts a valid one", async () => {
      const ta = area();
      const p = askLink(ta);
      const input = document.getElementById("link-url") as HTMLInputElement;
      const err = document.getElementById("link-err") as HTMLElement;
      expect(dlg("link-dlg").open).toBe(true);
      expect(input.value).toBe("https://");
      expect(input.type).toBe("url");
      expect(input.getAttribute("aria-describedby")).toContain("link-err");
      input.value = "javascript:alert(1)";
      btn("[data-link-ok]").click();
      await tick();
      expect(dlg("link-dlg").open).toBe(true);
      expect(err.hidden).toBe(false);
      expect(err.textContent).toBe(ADMIN_STRINGS.en.common.linkBad);
      expect(input.getAttribute("aria-invalid")).toBe("true");
      input.value = "https://example.com/guide";
      input.dispatchEvent(new Event("input"));
      expect(err.hidden).toBe(true);
      btn("[data-link-ok]").click();
      expect(await p).toBe("https://example.com/guide");
      // The selection is back, so the caller wraps the selected word
      expect([ta.selectionStart, ta.selectionEnd]).toEqual([9, 14]);
   });

   it("Enter in the field means Insert (not the first button, Cancel)", async () => {
      const p = askLink(area());
      const input = document.getElementById("link-url") as HTMLInputElement;
      input.value = "/about";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
      expect(await p).toBe("/about");
   });

   it("Cancel / Esc give null and still restore the selection", async () => {
      const ta = area();
      const p = askLink(ta);
      (document.getElementById("link-url") as HTMLInputElement).value = "https://example.com";
      btn('#link-dlg button[value="cancel"]').click();
      expect(await p).toBeNull();
      expect([ta.selectionStart, ta.selectionEnd]).toEqual([9, 14]);
      const q = askLink(ta);
      dlg("link-dlg").close();
      expect(await q).toBeNull();
   });

   it("an earlier error is cleared on the next open", async () => {
      const p = askLink();
      const input = document.getElementById("link-url") as HTMLInputElement;
      input.value = "data:text/html,x";
      btn("[data-link-ok]").click();
      await tick();
      dlg("link-dlg").close();
      await p;
      const q = askLink();
      expect((document.getElementById("link-err") as HTMLElement).hidden).toBe(true);
      expect(input.hasAttribute("aria-invalid")).toBe(false);
      dlg("link-dlg").close();
      await q;
   });

   it("is in Arabic on an Arabic page", () => {
      render("ar");
      expect(document.getElementById("link-h")!.textContent).toBe("إدراج رابط");
      expect(document.querySelector("[data-link-ok]")!.textContent).toContain("إدراج");
   });
});

describe("leave guard", () => {
   let reason: "uploading" | "unsaved" | null = null;
   const assign = vi.fn();
   beforeEach(() => {
      reason = null;
      assign.mockReset();
      vi.spyOn(window.location, "assign").mockImplementation(assign);
   });
   // Installed once per module, like the page's main.ts.
   addLeaveGuard(() => reason);
   initLeaveGuard();

   const link = (attrs = "") => {
      document.body.insertAdjacentHTML("beforeend", `<a id="go" href="/pages" ${attrs}>Pages</a>`);
      return document.getElementById("go") as HTMLAnchorElement;
   };
   /** Dispatches a click; reports whether the guard (document, capture) blocked it, then stops the test navigation. */
   const click = (a: HTMLElement, init: MouseEventInit = {}) => {
      // The guard also stops propagation, so a click that never reaches the link was blocked.
      let prevented = true;
      a.addEventListener(
         "click",
         (ev) => {
            prevented = ev.defaultPrevented;
            ev.preventDefault();
         },
         { once: true },
      );
      a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init }));
      return prevented;
   };

   it("does nothing without a reason", () => {
      expect(click(link())).toBe(false);
      expect(dlg("leave-dlg").open).toBe(false);
   });

   it("unsaved changes: Stay keeps the page; Stay has the initial focus", async () => {
      reason = "unsaved";
      expect(click(link())).toBe(true);
      expect(dlg("leave-dlg").open).toBe(true);
      expect(document.getElementById("leave-p")!.textContent).toBe(ADMIN_STRINGS.en.common.leaveUnsaved);
      expect(btn('#leave-dlg button[value="stay"]').hasAttribute("autofocus")).toBe(true);
      btn('#leave-dlg button[value="stay"]').click();
      await tick();
      expect(assign).not.toHaveBeenCalled();
   });

   it("upload in flight: Leave anyway follows the link", async () => {
      reason = "uploading";
      click(link());
      expect(document.getElementById("leave-p")!.textContent).toBe(ADMIN_STRINGS.en.common.leaveUploading);
      expect(btn('#leave-dlg button[value="leave"]').classList.contains("danger")).toBe(true);
      btn('#leave-dlg button[value="leave"]').click();
      await tick();
      expect(assign).toHaveBeenCalledWith(new URL("/pages", location.href).href);
   });

   it("Esc stays", async () => {
      reason = "unsaved";
      click(link());
      dlg("leave-dlg").close();
      await tick();
      expect(assign).not.toHaveBeenCalled();
   });

   it("ignores new-tab, download, hash and modified clicks", () => {
      reason = "unsaved";
      for (const attrs of ['target="_blank"', "download"]) {
         document.getElementById("go")?.remove();
         expect(click(link(attrs))).toBe(false);
      }
      document.body.insertAdjacentHTML("beforeend", '<a id="hash" href="#main">x</a>');
      expect(click(document.getElementById("hash")!)).toBe(false);
      document.getElementById("go")?.remove();
      expect(click(link(), { ctrlKey: true })).toBe(false);
      expect(dlg("leave-dlg").open).toBe(false);
   });

   it("askLeave without the dialog stays", async () => {
      dlg("leave-dlg").remove();
      expect(await askLeave("uploading")).toBe(false);
   });
});
