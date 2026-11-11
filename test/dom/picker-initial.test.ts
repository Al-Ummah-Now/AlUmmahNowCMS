/**
 * The video picker opens with content (owner rule 2026-11-11): the first page before anything is
 * typed, a skeleton while it loads, "Load more" / scroll paging, one letter filtering what is
 * loaded, the error with Try again, the empty note, and items already added marked, not choosable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initPicker, openPicker } from "../../src/admin/client/picker.ts";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => {
   for (let i = 0; i < 5; i++) await tick();
};

type Item = { kind: "video"; id: string; title: string; thumbnail_url: null; channel_name: string | null; embed_url: null };
const item = (id: string, title = `Talk ${id}`): Item => ({ kind: "video", id, title, thumbnail_url: null, channel_name: "Ch", embed_url: null });

function render(lang: "en" | "ar" = "en", kinds?: ("video" | "playlist" | "channel")[]): void {
   const t = ADMIN_STRINGS[lang];
   document.documentElement.lang = lang;
   document.body.innerHTML = [
      pickerMarkup(t.picker, kinds ?? ["video"]),
      '<div id="toasts"></div>',
      `<script type="application/json" id="i18n">${JSON.stringify({ picker: t.picker })}</script>`,
      '<button id="opener">Add</button>',
   ]
      .map(String)
      .join("");
   const dlg = document.getElementById("picker") as HTMLDialogElement & { showModal(): void };
   dlg.showModal = function () {
      this.setAttribute("open", "");
   };
   dlg.close = function () {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
   };
}

/** The dialog as ui/picker.tsx renders it (that file is server JSX, outside the client type-check). */
function pickerMarkup(p: (typeof ADMIN_STRINGS)["en"]["picker"], kinds: string[]): string {
   const kindField =
      kinds.length > 1
         ? `<div class="seg" role="radiogroup">${kinds.map((k, i) => `<label><input type="radio" name="kind" value="${k}"${i === 0 ? " checked" : ""}>${p.kinds[k as "video"]}</label>`).join("")}</div>`
         : `<input type="hidden" name="kind" value="${kinds[0]}">`;
   return `<dialog class="dlg picker" id="picker"><div class="dlg-h"><button type="button" data-picker-close></button></div><div class="dlg-b stack">
      <form class="picker-form" data-picker-form role="search" novalidate>${kindField}<div class="search"><label for="picker-q">${p.query}</label><input id="picker-q" name="q" type="search"><button type="submit"></button></div></form>
      <p data-picker-status role="status" aria-live="polite"></p><ul class="picker-results" data-picker-results></ul></div></dialog>`;
}

type Answer = { items: Item[]; next_cursor?: string | null } | Error;
function serve(pages: (url: URL) => Answer) {
   const calls: URL[] = [];
   vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
         const url = new URL(input, "https://cms.test");
         calls.push(url);
         const a = pages(url);
         if (a instanceof Error) return new Response("x", { status: 502 });
         return Response.json(a);
      }),
   );
   return calls;
}

const rows = () => [...document.querySelectorAll<HTMLLIElement>("[data-picker-results] li[data-pick-id]")];
const status = () => document.querySelector("[data-picker-status]")!.textContent;
const T = ADMIN_STRINGS.en.picker;

beforeEach(() => render());
afterEach(() => {
   vi.unstubAllGlobals();
   vi.restoreAllMocks();
});

describe("picker opens with results", () => {
   it("lists the newest public videos before anything is typed, with a skeleton while loading", async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const calls = serve(() => ({ items: [item("v1"), item("v2")], next_cursor: null }));
      const realFetch = globalThis.fetch;
      vi.stubGlobal("fetch", async (...a: Parameters<typeof fetch>) => {
         await gate;
         return realFetch(...a);
      });
      initPicker();
      openPicker(() => {}, document.getElementById("opener")!);
      expect(document.querySelectorAll("[data-picker-skeleton]").length).toBe(4);
      expect(document.querySelector("[data-picker-results]")!.getAttribute("aria-busy")).toBe("true");
      release();
      await flush();
      expect(calls[0].pathname).toBe("/picker/api/search");
      expect(calls[0].searchParams.get("q")).toBe("");
      expect(calls[0].searchParams.get("kind")).toBe("video");
      expect(rows().map((r) => r.dataset.pickId)).toEqual(["v1", "v2"]);
      expect(document.querySelectorAll("[data-picker-skeleton]").length).toBe(0);
      expect(status()).toContain("Type to search");
   });

   it("pages with Load more and on scroll; one typed letter filters what is loaded", async () => {
      const calls = serve((u) => (u.searchParams.get("cursor") === "c2" ? { items: [item("v3", "Fiqh basics")], next_cursor: null } : { items: [item("v1", "Seerah"), item("v2", "Tafsir")], next_cursor: "c2" }));
      initPicker();
      openPicker(() => {});
      await flush();
      (document.querySelector("[data-picker-more]") as HTMLButtonElement).click();
      await flush();
      expect(calls[1].searchParams.get("cursor")).toBe("c2");
      expect(rows().map((r) => r.dataset.pickId)).toEqual(["v1", "v2", "v3"]);
      expect(document.querySelector("[data-picker-more]")).toBeNull();
      const q = document.getElementById("picker-q") as HTMLInputElement;
      q.value = "f";
      q.dispatchEvent(new Event("input"));
      await new Promise((r) => setTimeout(r, 260));
      expect(rows().map((r) => r.dataset.pickId)).toEqual(["v2", "v3"]);
      expect(calls.length).toBe(2);
   });

   it("marks items already added and keeps them from being chosen; choosing calls back", async () => {
      serve(() => ({ items: [item("v1"), item("v2")] }));
      initPicker();
      const opener = document.getElementById("opener")!;
      opener.dataset.pickerAdded = "video:v1";
      const picked: string[] = [];
      openPicker((it) => void picked.push(it.id), opener);
      await flush();
      const [first, second] = rows();
      expect(first.hasAttribute("data-added")).toBe(true);
      expect(first.querySelector("button")).toBeNull();
      expect(first.textContent).toContain(T.alreadyAdded);
      second.querySelector("button")!.click();
      await flush();
      expect(picked).toEqual(["v2"]);
   });

   it("says when there is nothing, and offers Try again after a failure", async () => {
      let fail = true;
      serve(() => (fail ? new Error("down") : { items: [] }));
      initPicker();
      openPicker(() => {});
      await flush();
      expect(status()).toBe(T.failed);
      fail = false;
      (document.querySelector("[data-picker-retry]") as HTMLButtonElement).click();
      await flush();
      expect(status()).toBe(T.empty);
   });

   it("speaks Arabic and browses the other kind when it is switched (channels: most viewed)", async () => {
      render("ar", ["video", "channel"]);
      const calls = serve(() => ({ items: [item("c1")] }));
      initPicker();
      openPicker(() => {});
      await flush();
      const radio = document.querySelector<HTMLInputElement>('input[name=kind][value=channel]')!;
      radio.checked = true;
      radio.dispatchEvent(new Event("change"));
      await flush();
      expect(calls.at(-1)!.searchParams.get("kind")).toBe("channel");
      expect(status()).toMatch(/[؀-ۿ]/);
      expect(status()).toContain(ADMIN_STRINGS.ar.picker.popular.split("{kind}")[1].trim().split(".")[0]);
   });
});
