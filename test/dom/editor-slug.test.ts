/**
 * The editor's address (slug) field (src/admin/client/editor.ts, src/lib/slug.ts): generated from the
 * title as it is typed, the editor's own once typed in, "Regenerate from title" to go back, and a live
 * row's address locked behind the in-app confirm dialog.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { initEditor } from "../../src/admin/client/editor.ts";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";
import { ConfirmDialog } from "../../src/admin/ui/dialogs.tsx";

const tick = () => new Promise((r) => setTimeout(r, 0));
const t = ADMIN_STRINGS.en;

function render(opts: { id?: string; slug?: string; live?: boolean } = {}): void {
   const strings = {
      slugBad: t.content.slugBad,
      slugHome: t.content.slugHome,
      slugTaken: t.content.slugTaken,
      slugNumeric: t.content.slugNumeric,
      slugChangeTitle: t.content.slugChangeTitle,
      slugChangeBody: t.content.slugChangeBody,
      slugChangeOk: t.content.slugChangeOk,
      required: t.common.required,
   };
   const id = opts.id ?? "";
   document.body.innerHTML = [
      String(ConfirmDialog({ v: { t }, title: t.common.confirmDelete, body: t.common.confirmDeleteBody })),
      `<script type="application/json" id="i18n">${JSON.stringify(strings)}</script>`,
      `<div id="toasts"></div>`,
      `<form data-editor="posts" data-id="${id}" data-locale="ar" data-state="${opts.live ? "published" : "draft"}" data-slug="${opts.slug ?? ""}">`,
      `<input id="f-title" />`,
      `<input id="f-slug" value="${opts.slug ?? ""}" ${id ? "" : 'data-auto-slug="1"'} ${opts.live ? 'readonly data-slug-live="1"' : ""} />`,
      `<p id="f-slug-err" hidden></p>`,
      opts.live ? `<p data-slug-locked></p><button type="button" data-slug-unlock>Change</button>` : "",
      `<button type="button" data-slug-regen ${id ? "" : "hidden"}>Regenerate</button>`,
      `</form>`,
   ].join("");
   initEditor();
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
function type(el: HTMLInputElement, value: string) {
   el.value = value;
   el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("editor slug", () => {
   beforeEach(() => render());

   it("fills the address from the title as it is typed (Arabic transliterated)", () => {
      const slug = $<HTMLInputElement>("#f-slug");
      expect(slug.value).toBe("");
      type($("#f-title"), "إن الدين");
      expect(slug.value).toBe("inna-al-din");
      type($("#f-title"), "إن الدين عند الله الإسلام");
      expect(slug.value).toBe("inna-al-din-inda-allah-al-islam");
      expect($("[data-slug-regen]").hidden).toBe(true);
   });

   it("stops following the title once the editor types an address, until Regenerate", () => {
      const slug = $<HTMLInputElement>("#f-slug");
      type($("#f-title"), "Ramadan guide");
      type(slug, "my-own-address");
      type($("#f-title"), "Ramadan guide 2026");
      expect(slug.value).toBe("my-own-address");
      const regen = $<HTMLButtonElement>("[data-slug-regen]");
      expect(regen.hidden).toBe(false);
      regen.click();
      return tick().then(() => {
         expect(slug.value).toBe("ramadan-guide-2026");
         expect(regen.hidden).toBe(true);
         type($("#f-title"), "Ramadan guide 2027");
         expect(slug.value).toBe("ramadan-guide-2027");
      });
   });

   it("keeps an existing row's address when its title changes", () => {
      render({ id: "7", slug: "old-address" });
      type($("#f-title"), "A brand new title");
      expect($<HTMLInputElement>("#f-slug").value).toBe("old-address");
      expect($("[data-slug-regen]").hidden).toBe(false);
   });

   it("locks a live address behind the in-app confirm dialog", async () => {
      render({ id: "9", slug: "live-post", live: true });
      const slug = $<HTMLInputElement>("#f-slug");
      const dlg = document.getElementById("confirm") as HTMLDialogElement;
      expect(slug.readOnly).toBe(true);
      // Cancel: still locked.
      $<HTMLButtonElement>("[data-slug-unlock]").click();
      await tick();
      expect(dlg.open).toBe(true);
      expect(dlg.textContent).toContain(t.content.slugChangeTitle);
      dlg.close("");
      await tick();
      expect(slug.readOnly).toBe(true);
      // Confirm: editable.
      $<HTMLButtonElement>("[data-slug-unlock]").click();
      await tick();
      dlg.close("ok");
      await tick();
      expect(slug.readOnly).toBe(false);
      expect($("[data-slug-unlock]").hidden).toBe(true);
   });
});
