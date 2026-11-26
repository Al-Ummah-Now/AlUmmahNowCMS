import { afterEach, expect, it, vi } from "vitest";
import { initScholars } from "../../src/admin/client/scholars.ts";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";

afterEach(() => {
   document.body.replaceChildren();
   vi.unstubAllGlobals();
});

it.each([["en", "Main channel"], ["ar", "القناة الرئيسية"]] as const)("chooses a main channel and falls back after unlinking in %s", async (lang, title) => {
   const t = ADMIN_STRINGS[lang];
   const endpoint = "/admin/api/scholars/me";
   document.body.innerHTML = `
      <form data-scholar-form data-endpoint="${endpoint}" data-updated="initial">
         <div data-avatar><img data-avatar-img><button data-avatar-remove></button><button data-avatar-choose></button></div>
         <fieldset data-channels>
            <label><input type="checkbox" name="channel_ids" value="c1" checked>C1</label>
            <label><input type="checkbox" name="channel_ids" value="c2" checked>C2</label>
            <label><input type="checkbox" name="channel_ids" value="c3">C3</label>
         </fieldset>
         <fieldset data-primary-channels>
            <legend>${t.scholars.primaryChannel}</legend>
            <label><input type="radio" name="primary_channel_id" value="c1" checked>C1</label>
            <label><input type="radio" name="primary_channel_id" value="c2">C2</label>
            <label hidden><input type="radio" name="primary_channel_id" value="c3" disabled>C3</label>
         </fieldset>
         <button type="submit">Save</button>
      </form>
      <script type="application/json" id="i18n-shell">${JSON.stringify({ sch: t.scholars })}</script>`;
   const request = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ data: { updated_at: "saved" } }));
   vi.stubGlobal("fetch", request);

   initScholars();
   const form = document.querySelector<HTMLFormElement>("form[data-scholar-form]")!;
   const main = document.querySelector<HTMLFieldSetElement>("[data-primary-channels]")!;
   const radio = (id: string) => main.querySelector<HTMLInputElement>(`input[value="${id}"]`)!;
   const checkbox = (id: string) => form.querySelector<HTMLInputElement>(`input[name=channel_ids][value="${id}"]`)!;
   expect(main.querySelector("legend")?.textContent).toBe(title);
   expect(radio("c1").checked).toBe(true);
   expect(radio("c3").disabled).toBe(true);
   expect(radio("c3").closest("label")?.hidden).toBe(true);

   const save = async (channel_ids: string[], primary_channel_id: string | null) => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      expect(request).toHaveBeenLastCalledWith(endpoint, expect.objectContaining({ method: "PUT" }));
      const [, init] = request.mock.lastCall!;
      expect(JSON.parse(String(init.body))).toMatchObject({ channel_ids, primary_channel_id });
      await vi.waitFor(() => expect(form.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled).toBe(false));
      expect(form.dataset.updated).toBe("saved");
   };

   radio("c2").click();
   await save(["c1", "c2"], "c2");

   checkbox("c2").click();
   expect(radio("c2").disabled).toBe(true);
   expect(radio("c1").checked).toBe(true);
   await save(["c1"], "c1");

   checkbox("c1").click();
   expect(main.hidden).toBe(true);
   await save([], null);

   checkbox("c3").click();
   expect(main.hidden).toBe(false);
   expect(radio("c3").checked).toBe(true);
   await save(["c3"], "c3");
});
