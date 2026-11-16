/**
 * Page-builder Translate in the editor DOM (src/admin/client/block-translate.ts), against a mocked
 * POST /admin/api/translate (no provider): Copy and translate keeps markdown markup and sends only
 * text, a Qur'an block is refused and left as copied with the official-text link while the others
 * translate, a failing block doesn't stop the rest, and per-field Translate fills from the other
 * page's block with Undo when it replaced text. Nothing is saved: no other request is made.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { blockFields, decorateFields, translateBlocks, translateOneField, type BtStrings } from "../../src/admin/client/block-translate.ts";
import { ADMIN_STRINGS } from "../../src/admin/i18n.ts";
import { normalizePageBlocks, pageBlockTexts, type PageBlock } from "../../src/lib/page-blocks.generated.ts";
import { samplePageBlocks } from "../../src/lib/page-blocks.sample.generated.ts";

const t = ADMIN_STRINGS.en;
const T: BtStrings = {
   ...t.blocks.bt,
   translateField: t.blocks.bt.translateField("{0}"),
   translateFieldLabel: t.blocks.bt.translateFieldLabel("{0}"),
   fieldFilled: t.blocks.bt.fieldFilled("{0}", "{1}"),
   fieldReplaced: t.blocks.bt.fieldReplaced("{0}", "{1}"),
   nothingToTranslate: t.blocks.bt.nothingToTranslate("{0}"),
   progress: t.blocks.bt.progress("{0}" as unknown as number, "{1}" as unknown as number),
   waiting: t.blocks.bt.waiting("{0}" as unknown as number),
   done: t.blocks.bt.done("{0}" as unknown as number, "{1}" as unknown as number),
   langNames: t.blocks.langNames,
   l10n: t.l10n,
};

// The editor's own server markup. Imported at run time only: this file is type-checked by the client
// project (tsconfig.client.json), which must not compile server code (worker types).
type BlockItemFn = (p: { c: unknown; b: PageBlock }) => unknown;
let BlockItem: BlockItemFn;
let emptyRefs: () => unknown;
beforeAll(async () => {
   const screens = "../../src/admin/screens/blocks.tsx";
   ({ BlockItem, emptyRefs } = (await import(/* @vite-ignore */ screens)) as { BlockItem: BlockItemFn; emptyRefs: () => unknown });
});

function render(raw: Record<string, unknown>[], locale: "en" | "ar" = "ar") {
   const blocks = normalizePageBlocks(raw);
   const c = { v: { t: ADMIN_STRINGS.en, user: { role: "admin" } }, locale, refs: emptyRefs() };
   document.body.innerHTML = `<form><ol data-k="blocks">${blocks.map((b) => String(BlockItem({ c, b }))).join("")}</ol></form>`;
   return { list: document.querySelector<HTMLElement>("ol[data-k=blocks]")!, items: [...document.querySelectorAll<HTMLElement>("ol[data-k=blocks] > li")] };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
/** The mocked endpoint: Arabic for every numbered piece (or the whole text), Qur'an refused, "FAIL" fails. */
function answer(text: string): Response {
   if (/[﴿﴾]/.test(text)) return json({ error: "quran", quranUrl: "https://quran.com/112" }, 422);
   if (text.includes("FAIL")) return json({ error: "invalid_output" }, 503 - 3);
   const lines = text.split("\n");
   if (lines.length > 1 || /^\[1\] /.test(text)) return json({ text: lines.map((l) => l.replace(/^\[(\d+)\] (.*)$/, "[$1] ع($2)")).join("\n") });
   return json({ text: `ع(${text})` });
}

let fetchMock: ReturnType<typeof vi.fn>;
const sent = () => fetchMock.mock.calls.map((c) => ({ url: String(c[0]), body: JSON.parse(String(c[1].body)) as { text: string; from: string; to: string } }));
const hooks = { progress: vi.fn(), onWait: async () => false, stopped: () => false };

beforeEach(() => {
   fetchMock = vi.fn(async (_url: string, init: RequestInit) => answer((JSON.parse(String(init.body)) as { text: string }).text));
   vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("block fields in the editor", () => {
   it("finds an input for every text of every block type (the sample page)", () => {
      const { items } = render(samplePageBlocks("en"), "en");
      const blocks = normalizePageBlocks(samplePageBlocks("en"));
      const found = new Set(items.flatMap((li) => blockFields(li).map((f) => `${li.querySelector<HTMLInputElement>(":scope > input[data-k=id]")!.value}.${f.path.list === undefined ? f.path.key : `${f.path.list}.${f.path.index}.${f.path.key}`}`)));
      for (const x of pageBlockTexts(blocks)) expect(found.has(x.path), x.path).toBe(true);
   });

   it("adds one labelled Translate button per text field, once", () => {
      const { list, items } = render([{ id: "c1", type: "cta", heading: "Join", text: "Now", label: "Go", url: "/x" }]);
      decorateFields(list, { locale: "ar", otherLocale: "en", T, otherBlocks: async () => null });
      decorateFields(list, { locale: "ar", otherLocale: "en", T, otherBlocks: async () => null });
      const btns = items[0]!.querySelectorAll<HTMLButtonElement>("[data-bt-field]");
      expect(btns.length).toBe(3);
      // Accessible name = the visible text, then the field (label-content-name-match).
      expect(btns[0]!.textContent).toMatch(/^Translate from English: .+/);
      expect(btns[0]!.querySelector(".vh")!.textContent).toMatch(/^: .+/);
      expect(btns[0]!.hasAttribute("aria-label")).toBe(false);
   });
});

describe("Copy and translate", () => {
   it("translates rich text through its text only: markup, links and video lines stay", async () => {
      const md = "## Our **videos**\n\n- Watch [live streams](https://videos.test/live)\n\n::video[abc]";
      const { items } = render([{ id: "m1", type: "markdown", text: md }]);
      const r = await translateBlocks(items, "en", "ar", T, hooks);
      expect(r).toEqual({ done: 1, quran: 0, failed: 0, stopped: 0 });
      const req = sent();
      expect(req).toHaveLength(1);
      expect(req[0]!.url).toBe("/admin/api/translate");
      expect(req[0]!.body).toMatchObject({ from: "en", to: "ar" });
      for (const bad of ["##", "**", "https://", "](", "::video"]) expect(req[0]!.body.text).not.toContain(bad);
      const value = items[0]!.querySelector<HTMLTextAreaElement>("textarea[data-k=text]")!.value;
      expect(value).toBe("## ع(Our) **ع(videos)**\n\n- ع(Watch) [ع(live streams)](https://videos.test/live)\n\n::video[abc]");
      const note = items[0]!.querySelector<HTMLElement>("[data-bt-note]")!;
      expect(note.dataset.btNote).toBe("mt");
      expect(note.textContent).toContain("Machine-translated, check before publishing");
   });

   it("skips a Qur'an block (left as copied, official text linked) and translates the rest", async () => {
      const verse = "﴿ قُلْ هُوَ اللَّهُ أَحَدٌ ﴾ Say: He is Allah, the One";
      const { items } = render([
         { id: "h1", type: "hero", title: "Welcome", subtitle: "Watch and share", buttons: [{ label: "Explore", url: "/videos/", variant: "primary" }] },
         { id: "q1", type: "quote", text: verse, cite: "Al-Ikhlas 1" },
         { id: "c1", type: "cta", heading: "Join us", text: "Create an account", label: "Sign up", url: "/account/" },
      ]);
      const r = await translateBlocks(items, "en", "ar", T, hooks);
      expect(r).toEqual({ done: 2, quran: 1, failed: 0, stopped: 0 });
      expect(items[1]!.querySelector<HTMLTextAreaElement | HTMLInputElement>("[data-k=text]")!.value).toBe(verse);
      expect(items[1]!.querySelector<HTMLInputElement>("[data-k=cite]")!.value).toBe("Al-Ikhlas 1");
      const note = items[1]!.querySelector<HTMLElement>("[data-bt-note]")!;
      expect(note.dataset.btNote).toBe("quran");
      expect(note.querySelector("a")!.getAttribute("href")).toBe("https://quran.com/112");
      expect(items[0]!.querySelector<HTMLInputElement>("[data-k=title]")!.value).toBe("ع(Welcome)");
      expect(items[0]!.querySelector<HTMLInputElement>("[data-k=url]")!.value).toBe("/videos/");
      expect(items[2]!.querySelector<HTMLInputElement>("[data-k=label]")!.value).toBe("ع(Sign up)");
   });

   it("a failing block leaves the others translated", async () => {
      const { items } = render([
         { id: "a", type: "cta", heading: "First", label: "Go", url: "/a" },
         { id: "b", type: "cta", heading: "FAIL here", label: "Go", url: "/b" },
         { id: "c", type: "image", alt: "A lantern", caption: "At night", media_id: 1 },
      ]);
      const r = await translateBlocks(items, "en", "ar", T, hooks);
      expect(r).toEqual({ done: 2, quran: 0, failed: 1, stopped: 0 });
      expect(items[1]!.querySelector<HTMLInputElement>("[data-k=heading]")!.value).toBe("FAIL here");
      expect(items[1]!.querySelector<HTMLElement>("[data-bt-note]")!.dataset.btNote).toBe("failed");
      expect(items[2]!.querySelector<HTMLInputElement>("[data-k=caption]")!.value).toBe("ع(At night)");
      expect(items[2]!.querySelector<HTMLInputElement>("[data-k=media_id]")!.value).toBe("1");
      // One request per block, nothing else (never a save).
      expect(sent().every((x) => x.url === "/admin/api/translate")).toBe(true);
      expect(sent()).toHaveLength(3);
   });

   it("an unavailable service stops the rest and says so", async () => {
      fetchMock.mockImplementation(async () => json({ error: "budget_reached" }, 503));
      const { items } = render([
         { id: "a", type: "cta", heading: "First", label: "Go", url: "/a" },
         { id: "b", type: "cta", heading: "Second", label: "Go", url: "/b" },
      ]);
      const r = await translateBlocks(items, "en", "ar", T, hooks);
      expect(r).toEqual({ done: 0, quran: 0, failed: 0, stopped: 2 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(items[1]!.querySelector("[data-bt-note]")!.textContent).toContain(t.l10n.unavailable);
   });
});

describe("Translate one field", () => {
   const other = normalizePageBlocks([{ id: "c1", type: "cta", heading: "Join us", text: "", label: "Sign up", url: "/x" }]) as PageBlock[];

   it("fills from the other page's block with the same id; replacing offers Undo", async () => {
      const { items } = render([{ id: "c1", type: "cta", heading: "قديم", label: "", url: "/x" }]);
      const li = items[0]!;
      const f = blockFields(li).find((x) => x.path.key === "heading")!;
      expect(await translateOneField(li, f, { locale: "ar", otherLocale: "en", T, otherBlocks: async () => other })).toBe(true);
      expect(sent()[0]!.body).toEqual({ text: "Join us", from: "en", to: "ar" });
      expect(f.input.value).toBe("ع(Join us)");
      const undo = li.querySelector<HTMLButtonElement>("[data-bt-undo]")!;
      undo.click();
      expect(f.input.value).toBe("قديم");
   });

   it("no matching block: translates the field's own text when it is still in the other language", async () => {
      const { items } = render([{ id: "new1", type: "cta", heading: "Copied English", label: "", url: "/x" }]);
      const f = blockFields(items[0]!).find((x) => x.path.key === "heading")!;
      await translateOneField(items[0]!, f, { locale: "ar", otherLocale: "en", T, otherBlocks: async () => other });
      expect(f.input.value).toBe("ع(Copied English)");
      expect(items[0]!.querySelector("[data-bt-undo]")).not.toBeNull();
   });

   it("nothing in the other language: says so, no call", async () => {
      const { items } = render([{ id: "new1", type: "cta", heading: "بالعربية", label: "", url: "/x" }]);
      const f = blockFields(items[0]!).find((x) => x.path.key === "heading")!;
      expect(await translateOneField(items[0]!, f, { locale: "ar", otherLocale: "en", T, otherBlocks: async () => null })).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(items[0]!.querySelector("[data-bt-note]")!.textContent).toContain("There is no English text");
   });
});
