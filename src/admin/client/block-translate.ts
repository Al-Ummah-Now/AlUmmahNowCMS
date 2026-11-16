/**
 * Translate in the page builder (owner rule 2026-11-16, docs/LOCALIZED_FIELDS.md "Page blocks"):
 *
 *   - "Copy and translate" (page-builder.ts) copies the other language's blocks, then `translateBlocks`
 *     machine-translates every text field of every block into this page's language: one request per
 *     block (src/lib/block-translate.ts packs its pieces), with progress and Stop. Structure, links,
 *     media, ids and styling are never touched: only the text inputs change.
 *   - Every text field gets a "Translate" button: it fills the field from the other language's page
 *     (the block with the same id, which is what Copy keeps), or, with no such block, from the field's
 *     own text when it is still in the other language.
 *   - Nothing is saved or published here. Each translated block shows "Machine-translated, check
 *     before publishing"; replacing text that was there offers Undo in that note (never a browser prompt).
 *   - Qur'an is refused by the endpoint per block: the block stays as copied, with the official-text link.
 *
 * All calls go to POST /admin/api/translate (src/admin/translate-api.ts): Workers AI only, glossary,
 * «مرئي/مرئيات», caps and the ai_usage audit live there.
 */
import { BLOCK_TEXT_FIELDS, blockFieldValue, pack, pathString, rebuild, segment, unpack, type FieldPath } from "../../lib/block-translate.ts";
import type { PageBlock, PageBlockType } from "../../lib/page-blocks.generated.ts";
import { $, $$, api, ApiError, el } from "./dom.ts";

type L = "en" | "ar";
type Input = HTMLInputElement | HTMLTextAreaElement;

/** Strings (the client gets "{0}" templates): the builder's own and the shared pair's (t.l10n). */
export interface BtStrings {
   translateField: string;
   translateFieldLabel: string;
   machineNote: string;
   fieldFilled: string;
   fieldReplaced: string;
   nothingToTranslate: string;
   blockQuran: string;
   blockFailed: string;
   blockStopped: string;
   progress: string;
   waiting: string;
   done: string;
   langNames: Record<string, string>;
   l10n: { undo: string; undone: string; officialText: string; busy: string; dailyCap: string; unavailable: string; failed: string; translating: string };
}

const fmt = (s: string, ...a: (string | number)[]) => a.reduce<string>((out, v, i) => out.split(`{${i}}`).join(String(v)), s ?? "");
/** A count in the admin's language: Arabic UI writes ٠–٩. */
export const num = (x: number) => (document.documentElement.lang === "ar" ? x.toLocaleString("ar-u-nu-arab", { useGrouping: false }) : String(x));
const ARABIC = /\p{Script=Arabic}/u;
const LATIN = /[A-Za-z]/;
/** Text that is (still) in `l`: Arabic letters for ar, Latin letters and no Arabic for en. */
export const looksLike = (s: string, l: L) => (l === "ar" ? ARABIC.test(s) : LATIN.test(s) && !ARABIC.test(s));

/* ── The editor DOM: a block's text inputs ───────────────────────────────────────────────────── */

const itemOf = (node: Element) => node.parentElement?.closest("[data-seq-item]") ?? null;

function own(scope: Element, k: string): Input | null {
   return (
      $$<Input>(`input[data-k="${k}"], textarea[data-k="${k}"]`, scope).find((x) => itemOf(x) === scope && x.type !== "hidden" && x.type !== "radio" && x.type !== "checkbox" && !x.closest("template")) ?? null
   );
}

export interface BlockField {
   path: FieldPath;
   input: Input;
   markdown: boolean;
}

export const blockIdOf = (li: Element) => li.querySelector<HTMLInputElement>(":scope > input[data-k=id]")?.value ?? "";

/** Every text input of a block card, in editor order, with its place in the block. */
export function blockFields(li: HTMLElement): BlockField[] {
   const type = li.dataset.blockType as PageBlockType | undefined;
   const spec = type ? BLOCK_TEXT_FIELDS[type] : undefined;
   if (!spec) return [];
   const out: BlockField[] = [];
   for (const [key, markdown] of spec.fields) {
      const input = own(li, key);
      if (input) out.push({ path: { key }, input, markdown });
   }
   for (const [list, fields] of Object.entries(spec.lists ?? {})) {
      const ol = $$<HTMLElement>(`ol[data-k="${list}"]`, li).find((x) => itemOf(x) === li);
      if (!ol) continue;
      $$<HTMLElement>(":scope > li[data-seq-item]", ol).forEach((sub, index) => {
         for (const [key, markdown] of fields) {
            const input = own(sub, key);
            if (input) out.push({ path: { list, index, key }, input, markdown });
         }
      });
   }
   return out;
}

function fieldLabel(input: Input): string {
   const by = input.getAttribute("aria-labelledby");
   const named = by ? document.getElementById(by.split(" ")[0]!) : input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`) : null;
   return (named?.textContent ?? input.dataset.k ?? "").trim();
}

function setValue(input: Input, value: string): void {
   input.value = value;
   input.dispatchEvent(new Event("input", { bubbles: true }));
}

/* ── Calls ────────────────────────────────────────────────────────────────────────────────────── */

export type Failure = { ok: false; code: string; quranUrl?: string; retryAfter?: number };
type Answer = { ok: true; text: string } | Failure;

async function translateOnce(text: string, from: L, to: L): Promise<Answer> {
   try {
      const r = await api<{ text: string }>("POST", "/admin/api/translate", { text, from, to });
      return { ok: true, text: r.text };
   } catch (e) {
      const b = e instanceof ApiError ? (e.body as { error?: string; quranUrl?: string; retryAfter?: number } | null) : null;
      const code = b?.error ?? (e instanceof ApiError ? `http_${e.status}` : "network");
      return { ok: false, code: e instanceof ApiError && e.status === 503 ? "unavailable" : code, quranUrl: b?.quranUrl, retryAfter: b?.retryAfter };
   }
}

export interface RunOptions {
   /** Rate limited: wait this many seconds and retry (resolves false to give up). */
   onWait?: (seconds: number) => Promise<boolean>;
   /** A packed answer that doesn't map back: retry its pieces one by one (one field; never a whole page). */
   singles?: boolean;
}

/**
 * Translates field texts (markdown keeps its markup), packing their pieces into as few requests as
 * the endpoint's cap allows. All or nothing: any refusal or failure returns it, and no text.
 */
export async function translateTexts(texts: { value: string; markdown: boolean }[], from: L, to: L, o: RunOptions = {}): Promise<{ ok: true; values: string[] } | Failure> {
   const segs = texts.map((t) => segment(t.value, t.markdown));
   const all: string[] = [];
   const at: [number, number][] = [];
   segs.forEach((s, f) => s.pieces.forEach((p, i) => (all.push(p), at.push([f, i]))));
   const out = segs.map((s) => [...s.pieces]);
   const call = async (text: string): Promise<Answer> => {
      for (;;) {
         const r = await translateOnce(text, from, to);
         if (r.ok || r.code !== "rate_limited" || !o.onWait) return r;
         if (!(await o.onWait(r.retryAfter ?? 60))) return r;
      }
   };
   for (const chunk of pack(all)) {
      const r = await call(chunk.text);
      if (!r.ok) return r;
      let got = unpack(chunk, r.text);
      if (!got && o.singles) {
         got = [];
         for (const id of chunk.ids) {
            const one = await call(all[id]!);
            if (!one.ok) return one;
            got.push(one.text.trim());
         }
      }
      if (!got) return { ok: false, code: "invalid_output" };
      chunk.ids.forEach((id, n) => {
         const [f, i] = at[id]!;
         out[f]![i] = got[n]!;
      });
   }
   return { ok: true, values: segs.map((s, f) => rebuild(s, out[f]!)) };
}

/* ── The per-block note ──────────────────────────────────────────────────────────────────────── */

type NoteKind = "mt" | "quran" | "failed" | "stopped";

/** The block's review note (top of its body): what happened, a live status, links and Undo. */
export function blockNote(li: HTMLElement, kind: NoteKind, text: string, ...extra: Node[]): HTMLElement {
   const body = $<HTMLElement>(":scope > .blk-b", li) ?? li;
   let note = $<HTMLElement>(":scope > [data-bt-note]", body);
   if (!note) {
      note = el("div", { class: "notice bt-note", "data-bt-note": "" });
      body.prepend(note);
   }
   note.dataset.btNote = kind;
   note.classList.toggle("bad", kind !== "mt");
   // One live region per note, kept across updates so each new message is announced.
   let msg = $<HTMLElement>(":scope > [data-bt-msg]", note);
   if (!msg) {
      msg = el("p", { class: "bt-msg", role: "status", "aria-live": "polite", "data-bt-msg": "" });
      note.append(msg);
   }
   msg.replaceChildren(text);
   if (extra.length) msg.append(" ", ...extra);
   return note;
}

function quranLink(T: BtStrings, url?: string): HTMLAnchorElement {
   return el("a", { href: url ?? "https://quran.com", target: "_blank", rel: "noopener" }, T.l10n.officialText);
}

function failureText(T: BtStrings, f: Failure): string {
   if (f.code === "rate_limited") return fmt(T.l10n.busy, num(f.retryAfter ?? 60));
   if (f.code === "daily_cap") return T.l10n.dailyCap;
   if (f.code === "unavailable" || f.code === "budget_reached" || f.code === "not_configured") return T.l10n.unavailable;
   return T.blockFailed;
}

/** Codes after which the rest of the page can't be translated either. */
const FATAL = new Set(["daily_cap", "unavailable", "budget_reached", "not_configured", "rate_limited", "forbidden", "http_403"]);

/* ── Copy and translate: every block ─────────────────────────────────────────────────────────── */

export interface BulkResult {
   done: number;
   quran: number;
   failed: number;
   stopped: number;
}

export interface BulkHooks {
   progress: (index: number, total: number) => void;
   onWait: (seconds: number) => Promise<boolean>;
   stopped: () => boolean;
}

/**
 * Translates the text of `items` (block cards just copied from the `from` page) into `to`, one
 * request per block. Every non-empty field goes, mixed-language ones included, so the endpoint sees
 * the whole block and refuses it when any of it is Qur'an. A refused (Qur'an) or failed block stays as copied with its note; the others
 * still translate. Stops early on a cap or an unavailable service, marking the rest.
 */
export async function translateBlocks(items: HTMLElement[], from: L, to: L, T: BtStrings, hooks: BulkHooks): Promise<BulkResult> {
   const res: BulkResult = { done: 0, quran: 0, failed: 0, stopped: 0 };
   const work = items.map((li) => ({ li, fields: blockFields(li).filter((f) => f.input.value.trim()) })).filter((w) => w.fields.length);
   let halt: string | null = null;
   for (const [i, w] of work.entries()) {
      if (halt || hooks.stopped()) {
         blockNote(w.li, "stopped", halt ?? T.blockStopped);
         res.stopped += 1;
         continue;
      }
      hooks.progress(i, work.length);
      const r = await translateTexts(
         w.fields.map((f) => ({ value: f.input.value, markdown: f.markdown })),
         from,
         to,
         { onWait: hooks.onWait },
      );
      if (r.ok) {
         w.fields.forEach((f, n) => setValue(f.input, r.values[n]!));
         blockNote(w.li, "mt", T.machineNote);
         res.done += 1;
      } else if (r.code === "quran") {
         blockNote(w.li, "quran", T.blockQuran, quranLink(T, r.quranUrl));
         res.quran += 1;
      } else if (FATAL.has(r.code)) {
         halt = failureText(T, r);
         blockNote(w.li, "stopped", halt);
         res.stopped += 1;
      } else {
         blockNote(w.li, "failed", T.blockFailed);
         res.failed += 1;
      }
   }
   hooks.progress(work.length, work.length);
   return res;
}

/* ── Translate one field ─────────────────────────────────────────────────────────────────────── */

export interface FieldContext {
   locale: L;
   otherLocale: L;
   /** The other language's saved blocks (null: there is no such page or it couldn't be read). */
   otherBlocks: () => Promise<PageBlock[] | null>;
   T: BtStrings;
}

/** Fills one field from the other page's matching block, else from its own other-language text. */
export async function translateOneField(li: HTMLElement, field: BlockField, c: FieldContext, btn?: HTMLButtonElement): Promise<boolean> {
   const { T, locale: to, otherLocale: from } = c;
   const otherName = T.langNames[from] ?? from;
   const label = fieldLabel(field.input);
   const sibling = (await c.otherBlocks())?.find((b) => b.id === blockIdOf(li) && b.type === li.dataset.blockType);
   let source = blockFieldValue(sibling, field.path).trim();
   if (!source && looksLike(field.input.value, from)) source = field.input.value.trim();
   if (!source) {
      blockNote(li, "failed", fmt(T.nothingToTranslate, otherName));
      return false;
   }
   if (btn) btn.disabled = true;
   li.setAttribute("aria-busy", "true");
   blockNote(li, "mt", T.l10n.translating);
   try {
      const r = await translateTexts([{ value: source, markdown: field.markdown }], from, to, { singles: true });
      if (!r.ok) {
         if (r.code === "quran") blockNote(li, "quran", T.blockQuran, quranLink(T, r.quranUrl));
         else blockNote(li, "failed", r.code === "invalid_output" ? T.l10n.failed : failureText(T, r));
         return false;
      }
      const before = field.input.value;
      const next = r.values[0]!;
      setValue(field.input, next);
      if (before.trim() && before !== next) {
         const undo = el("button", { type: "button", class: "btn ghost sm", "data-bt-undo": "" }, T.l10n.undo);
         undo.addEventListener("click", () => {
            setValue(field.input, before);
            blockNote(li, "mt", T.l10n.undone);
            field.input.focus();
         });
         blockNote(li, "mt", `${fmt(T.fieldReplaced, label, otherName)} ${T.machineNote}`, undo);
      } else blockNote(li, "mt", `${fmt(T.fieldFilled, label, otherName)} ${T.machineNote}`);
      return true;
   } finally {
      if (btn) btn.disabled = false;
      li.removeAttribute("aria-busy");
   }
}

/* ── Buttons on every text field ─────────────────────────────────────────────────────────────── */

/** Adds a Translate button after each text input of the blocks in `list` (idempotent). */
export function decorateFields(list: HTMLElement, c: FieldContext): void {
   const otherName = c.T.langNames[c.otherLocale] ?? c.otherLocale;
   for (const li of $$<HTMLElement>(":scope > li[data-seq-item]", list)) {
      for (const f of blockFields(li)) {
         const next = f.input.nextElementSibling;
         if (next?.matches("[data-bt-row]")) continue;
         // The accessible name starts with the visible text (WCAG 2.5.3) and names the field after it.
         const btn = el("button", { type: "button", class: "btn ghost sm bt-go", "data-bt-field": pathString(f.path) }, fmt(c.T.translateField, otherName), el("span", { class: "vh" }, fmt(c.T.translateFieldLabel, fieldLabel(f.input))));
         f.input.after(el("div", { class: "bt-row", "data-bt-row": "" }, btn));
      }
   }
}

export function initFieldTranslate(list: HTMLElement, c: FieldContext): void {
   decorateFields(list, c);
   // New, duplicated and copied blocks (and items added inside a block) get their buttons too.
   let pending = false;
   new MutationObserver(() => {
      if (pending) return;
      pending = true;
      queueMicrotask(() => {
         pending = false;
         decorateFields(list, c);
      });
   }).observe(list, { childList: true, subtree: true });
   list.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-bt-field]");
      if (!btn) return;
      const input = btn.closest("[data-bt-row]")?.previousElementSibling as Input | null;
      const li = btn.closest<HTMLElement>("ol[data-k=blocks] > li[data-seq-item]");
      const field = li ? blockFields(li).find((f) => f.input === input) : undefined;
      if (li && field) void translateOneField(li, field, c, btn);
   });
}
