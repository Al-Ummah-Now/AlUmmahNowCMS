/**
 * Block editor (pages) and slide editor (card posts): ordered lists the editor can add to,
 * reorder (drag, Move up/down buttons, Alt+↑/↓), duplicate and remove (with Undo); the media and
 * post choosers; video picking (snapshot taken server-side); a live overlay preview on slides;
 * and a preview of the whole page. The DOM is the state (src/admin/screens/blocks.tsx documents the
 * contract); `readBlocks` / `readSlides` read it back and validate with the server's own rules.
 */
import { latestOnly, liveSearch } from "./live-search.ts";
import { BlockError, blockSummary, isComplete, newBlockId, normalizeBlocks, normalizeSlides, validBlockUrl, validEmail, type Block, type Slide } from "../../lib/blocks.ts";
import { $, $$, api, ApiError, el, strings, toast, pageLang, pageNum } from "./dom.ts";
import { pickPlural, type PluralForms } from "../../lib/format.ts";
import { askLink } from "./dialogs.ts";
import { openPicker, type PickedItem } from "./picker.ts";
import { initPageBuilder } from "./page-builder.ts";

type Dict = Record<string, string>;
interface S {
   blocks: Dict & { types: Dict; errors: Dict; langNames: Dict };
   slides: Dict;
   /** Count sentences per plural form (src/lib/format.ts pluralTemplates). */
   counts?: { blocks?: PluralForms; slides?: PluralForms; mediaUse?: PluralForms };
   videoLine: string;
   failed: string;
   status?: Dict;
}

let T: S;
export const fmt = (tpl: string, ...args: (string | number)[]) => args.reduce<string>((s, a, i) => s.split(`{${i}}`).join(pageNum(a)), tpl);

const changed = (from: Element) => from.closest("form")?.dispatchEvent(new CustomEvent("seq:change", { bubbles: true }));

/* ── Reading the DOM back ─────────────────────────────────────────────────────────────────────── */

const itemOf = (node: Element) => node.parentElement?.closest("[data-seq-item]") ?? null;

/** Values of one item: every `data-k` whose nearest item is this one. */
export function readItem(li: Element): Record<string, unknown> {
   const out: Record<string, unknown> = {};
   // "appearance.align" → out.appearance.align (one level: the block's appearance object)
   const put = (k: string, v: unknown) => {
      const dot = k.indexOf(".");
      if (dot < 0) return void (out[k] = v);
      const head = k.slice(0, dot);
      const box = (out[head] && typeof out[head] === "object" ? out[head] : (out[head] = {})) as Record<string, unknown>;
      box[k.slice(dot + 1)] = v;
   };
   for (const node of $$<HTMLElement>("[data-k]", li)) {
      if (itemOf(node) !== li && !(node.tagName === "OL" && itemOf(node) === li)) continue;
      if (node.closest("template")) continue;
      const k = node.dataset.k!;
      if (node.tagName === "OL") {
         const items = $$(":scope > li[data-seq-item]", node).map(readItem);
         put(k, node.hasAttribute("data-scalar") ? items.map((x) => x.v).filter((x) => x !== null && x !== undefined) : items);
         continue;
      }
      const input = node as HTMLInputElement;
      if (input.type === "radio") {
         if (input.checked) put(k, input.dataset.type === "int" ? Number(input.value) : input.value);
         continue;
      }
      if (input.type === "checkbox") {
         put(k, input.checked);
         continue;
      }
      const raw = input.value;
      put(k, input.dataset.type === "int" ? (raw.trim() === "" ? null : Number(raw)) : raw);
   }
   return out;
}

export const listItems = (list: Element) => $$(":scope > li[data-seq-item]", list);

export type ReadResult<V> = { ok: true; value: V } | { ok: false; item: HTMLElement | null; message: string; field?: HTMLElement };

function blockMessage(e: unknown): string {
   const errs = T.blocks.errors;
   if (e instanceof BlockError) return errs[e.code] ?? errs.other;
   return errs.other;
}

function fail<V>(list: Element, e: unknown): ReadResult<V> {
   const index = e instanceof BlockError ? e.index : null;
   const item = index === null ? null : ((listItems(list)[index] as HTMLElement | undefined) ?? null);
   return { ok: false, item, message: blockMessage(e) };
}

export function readBlocks(root: ParentNode = document): ReadResult<Block[]> | null {
   const list = $("[data-blocks-editor] ol[data-k=blocks]", root);
   if (!list) return null;
   const items = listItems(list) as HTMLElement[];
   const raw = items.map(readItem);
   // Links and emails first, to point at the field itself (any depth: hero buttons, cards, columns).
   for (const li of items) {
      for (const input of $$<HTMLInputElement>("input[data-validate]", li)) {
         const v = input.value.trim();
         if (!v || input.closest("[hidden]")) continue;
         const bad = input.dataset.validate === "email" ? !validEmail(v) : !validBlockUrl(v);
         if (!bad) continue;
         input.setAttribute("aria-invalid", "true");
         return { ok: false, item: li, message: input.dataset.validate === "email" ? T.blocks.emailBad : T.blocks.urlBad, field: input };
      }
   }
   try {
      return { ok: true, value: normalizeBlocks(raw) };
   } catch (e) {
      return fail(list, e);
   }
}

export function readSlides(root: ParentNode = document): ReadResult<Slide[]> | null {
   const list = $("[data-slides-editor] ol[data-k=slides]", root);
   if (!list) return null;
   try {
      return { ok: true, value: normalizeSlides(listItems(list).map(readItem)) };
   } catch (e) {
      return fail(list, e);
   }
}

/** Shows `message` on the item (or a toast) and focuses it. */
export function showReadError(r: { item: HTMLElement | null; message: string; field?: HTMLElement }): void {
   if (!r.item) return toast(r.message, "bad");
   unfold(r.item);
   const err = $<HTMLElement>(":scope > [data-block-err]", r.item);
   if (err) {
      err.textContent = r.message;
      err.hidden = false;
   } else toast(r.message, "bad");
   r.item.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
   (r.field ?? $<HTMLElement>("input:not([type=hidden]),textarea,button", r.item) ?? r.item).focus();
}

/* ── Ordered lists ────────────────────────────────────────────────────────────────────────────── */

let uidN = 0;
const freshUid = () => `c${Date.now().toString(36)}${(uidN++).toString(36)}`;

/** Gives every item in `root` (root included) a fresh uid, rewriting the ids that use it. */
export function reuid(root: HTMLElement): void {
   const items = [root, ...$$<HTMLElement>("[data-seq-item]", root)].filter((x) => x.hasAttribute("data-uid"));
   for (const item of items) {
      const old = item.dataset.uid!;
      const next = freshUid();
      item.dataset.uid = next;
      for (const node of [item, ...$$<HTMLElement>("*", item)]) {
         for (const attr of ["id", "for", "name", "aria-labelledby", "aria-describedby", "aria-controls"]) {
            const v = node.getAttribute(attr);
            if (v && v.includes(old)) node.setAttribute(attr, v.split(old).join(next));
         }
      }
   }
}

function fromTemplate(name: string, scope: ParentNode = document): HTMLElement | null {
   const tpl = $<HTMLTemplateElement>(`template[data-seq-template="${name}"]`, scope) ?? $<HTMLTemplateElement>(`template[data-seq-template="${name}"]`);
   if (!tpl) return null;
   const html = tpl.innerHTML.split("__UID__").join(freshUid()).split("__BID__").join(newBlockId());
   const box = document.createElement("div");
   box.innerHTML = html; // our own server-rendered markup, no user data
   return box.firstElementChild as HTMLElement;
}

function itemName(li: HTMLElement): string {
   return ($(":scope > .blk-h .blk-t", li)?.firstChild?.textContent ?? $(".sub-title", li)?.textContent ?? "").trim();
}

export function announce(list: Element, msg: string): void {
   const live = list.closest("[data-blocks-editor],[data-slides-editor]")?.querySelector<HTMLElement>("[data-seq-live]") ?? $("[data-seq-live]");
   if (!live) return;
   live.textContent = "";
   requestAnimationFrame(() => (live.textContent = msg));
}

/** A count in the right plural form: "1 block", "2 blocks" / «كتلة واحدة»، «كتلتان»، «٣ كتل»، «١١ كتلة». */
const countText = (forms: PluralForms | undefined, n: number, fallback: string) => (forms ? pickPlural(forms, n, pageLang()) : fmt(fallback, n));

/** A block card's open/closed state (the body stays in the DOM: it is the state). */
export function unfold(li: HTMLElement, open = true): void {
   const btn = $<HTMLButtonElement>(":scope > .blk-h [data-blk-fold]", li);
   if (!btn) return;
   li.classList.toggle("folded", !open);
   btn.setAttribute("aria-expanded", String(open));
   const label = open ? T.blocks.collapse : T.blocks.expand;
   btn.setAttribute("aria-label", label);
   btn.title = label;
}

/** Positions, empty state, limits, the incomplete markers, block summaries and the counts. */
export function refresh(list: Element): void {
   const items = listItems(list) as HTMLElement[];
   const blocks = list.matches("[data-seq-list=blocks]");
   items.forEach((li, i) => {
      const pos = $(":scope > .blk-h [data-seq-pos]", li);
      if (pos) pos.textContent = list.matches("[data-seq-list=slides]") ? pageNum(i + 1) : `, ${fmt(T.blocks.position, i + 1, items.length)}`;
      const subPos = $(":scope > .sub-hd [data-seq-pos]", li);
      if (subPos) subPos.textContent = pageNum(i + 1);
      const tools = ":scope > .blk-h [data-seq=X], :scope > .sub-hd [data-seq=X], :scope > .row-tools [data-seq=X]";
      $<HTMLButtonElement>(tools.split("X").join("up"), li)?.toggleAttribute("disabled", i === 0);
      $<HTMLButtonElement>(tools.split("X").join("down"), li)?.toggleAttribute("disabled", i === items.length - 1);
   });
   let empty = list.nextElementSibling?.matches("[data-seq-empty]") ? (list.nextElementSibling as HTMLElement) : null;
   if (!empty && list.hasAttribute("data-empty")) {
      empty = el("p", { class: "help seq-empty", "data-seq-empty": "" }, list.getAttribute("data-empty")!);
      list.after(empty);
   }
   if (empty) empty.hidden = items.length > 0;
   // A nested list at its limit: its add button and the items' Duplicate are off.
   const max = Number(list.getAttribute("data-max") ?? "0");
   if (max) {
      const full = items.length >= max;
      const add = list.parentElement?.querySelector<HTMLButtonElement>(`:scope > div > [data-add-sub="${list.getAttribute("data-seq-list")}"]`);
      add?.toggleAttribute("disabled", full);
      for (const li of items) $<HTMLButtonElement>(":scope > .sub-hd [data-seq=duplicate]", li)?.toggleAttribute("disabled", full);
   }
   if (blocks) {
      for (const li of items) {
         try {
            const [b] = normalizeBlocks([readItem(li)]);
            li.toggleAttribute("data-incomplete", !isComplete(b));
            const sum = $(":scope > .blk-h [data-blk-sum]", li);
            if (sum) sum.textContent = blockSummary(b);
         } catch {
            /* shown on save */
         }
      }
      const badge = list.closest("[data-blocks-editor]")?.querySelector("[data-blk-count]");
      if (badge) badge.textContent = countText(T.counts?.blocks, items.length, T.blocks.blocksCount);
   }
   // A change inside a nested list changes its block's summary and completeness too.
   const outer = list.parentElement?.closest<HTMLElement>("[data-seq-item]");
   if (outer?.parentElement?.matches("[data-seq-list=blocks]")) refresh(outer.parentElement);
   if (list.matches("[data-seq-list=slides]")) {
      for (const li of items) li.toggleAttribute("data-incomplete", !$<HTMLInputElement>("[data-k=media_id]", li)?.value);
      const badge = $("[data-slide-count]");
      if (badge) {
         badge.textContent = countText(T.counts?.slides, items.length, T.slides.count);
      }
   }
}

function focusItem(li: HTMLElement, control?: string): void {
   const sel = (c: string) => `:scope > .blk-h [data-seq=${c}], :scope > .sub-hd [data-seq=${c}], :scope > .row-tools [data-seq=${c}]`;
   const target = (control && $<HTMLElement>(sel(control), li)) || null;
   if (target && !target.hasAttribute("disabled")) return target.focus();
   ($<HTMLElement>(":scope > .blk-h .blk-t, :scope > .sub-hd", li) ? $<HTMLElement>("[data-seq=up]:not([disabled]),[data-seq=down]:not([disabled]),[data-seq=remove]", li) : $<HTMLElement>("input:not([type=hidden]),button", li))?.focus();
}

function move(li: HTMLElement, by: -1 | 1): void {
   const list = li.parentElement!;
   const sib = (by < 0 ? li.previousElementSibling : li.nextElementSibling) as HTMLElement | null;
   if (!sib) return;
   if (by < 0) sib.before(li);
   else sib.after(li);
   refresh(list);
   const items = listItems(list);
   announce(list, fmt(T.blocks.moved, items.indexOf(li) + 1, items.length));
   focusItem(li, by < 0 ? "up" : "down");
   changed(list);
}

let undoTimer: ReturnType<typeof setTimeout> | undefined;
function remove(li: HTMLElement): void {
   const list = li.parentElement!;
   const next = (li.nextElementSibling ?? li.previousElementSibling) as HTMLElement | null;
   const anchor = li.nextElementSibling;
   const name = itemName(li);
   li.remove();
   refresh(list);
   announce(list, fmt(T.blocks.removed, name));
   changed(list);
   if (next) focusItem(next);
   else (list.parentElement?.querySelector<HTMLElement>(":scope > div > [data-add-sub]") ?? list.closest("section")?.querySelector<HTMLElement>("[data-open-picker=end],[data-add-slide],[data-add-images],[data-add-videos],[data-pick-posts]"))?.focus();
   // Undo, in a toast with a real button (7 s).
   const host = document.getElementById("toasts");
   if (!host) return;
   clearTimeout(undoTimer);
   $$(".toast[data-undo]", host).forEach((x) => x.remove());
   const btn = el("button", { type: "button", class: "btn sm" }, T.blocks.undo);
   const box = el("div", { class: "toast ok", "data-undo": "" }, `${fmt(T.blocks.removed, name)} `, btn);
   btn.addEventListener("click", () => {
      if (anchor && anchor.parentElement === list) anchor.before(li);
      else list.append(li);
      box.remove();
      refresh(list);
      announce(list, fmt(T.blocks.added, name));
      changed(list);
      focusItem(li);
   });
   host.append(box);
   undoTimer = setTimeout(() => box.remove(), 7000);
}

function duplicate(li: HTMLElement): void {
   const max = Number(li.parentElement?.getAttribute("data-max") ?? "0");
   if (max && listItems(li.parentElement!).length >= max) return;
   const copy = li.cloneNode(true) as HTMLElement;
   // cloneNode keeps typed values of inputs and textareas, but not a <select>'s or radios' live state in every engine.
   const src = $$<HTMLInputElement>("input[type=radio]", li);
   reuid(copy);
   $$<HTMLInputElement>("input[type=radio]", copy).forEach((r, i) => (r.checked = src[i]?.checked ?? r.checked));
   const id = $<HTMLInputElement>(":scope > input[data-k=id]", copy);
   if (id) id.value = newBlockId();
   for (const sub of $$<HTMLElement>("[data-seq-item]", copy)) {
      const sid = $<HTMLInputElement>(":scope > input[data-k=id]", sub);
      if (sid) sid.value = newBlockId();
   }
   $<HTMLElement>(":scope > [data-block-err]", copy)?.setAttribute("hidden", "");
   li.after(copy);
   const list = li.parentElement!;
   refresh(list);
   announce(list, fmt(T.blocks.duplicated, itemName(li)));
   changed(list);
   focusItem(copy);
}

export function appendFromTemplate(list: Element, name: string, fill?: (li: HTMLElement) => void, after?: Element | null): HTMLElement | null {
   const li = fromTemplate(name, list.closest("section") ?? document);
   if (!li) return null;
   if (after && after.parentElement === list) after.after(li);
   else list.append(li);
   fill?.(li);
   refresh(list);
   changed(list);
   return li;
}

/**
 * Drag to reorder by the grip, with pointer events: one path for mouse, pen and touch (HTML5
 * drag-and-drop never starts from touch on iOS, and its drop is unreliable across engines). The item
 * moves live under the pointer, within its own list only; Esc or a cancelled pointer puts it back.
 * The buttons and Alt+↑/↓ remain the keyboard and assistive-technology path (the grip is aria-hidden).
 */
function initDrag(root: HTMLElement): void {
   let st: { li: HTMLElement; list: HTMLElement; next: Node | null; from: number; grip: HTMLElement; id: number } | null = null;
   const itemIn = (list: HTMLElement, node: Element | null): HTMLElement | null => {
      let o = node?.closest<HTMLElement>("[data-seq-item]") ?? null;
      while (o && o.parentElement !== list) o = o.parentElement?.closest<HTMLElement>("[data-seq-item]") ?? null;
      return o;
   };
   const finish = (commit: boolean) => {
      if (!st) return;
      const { li, list, next, from, grip, id } = st;
      st = null;
      if (grip.hasPointerCapture(id)) grip.releasePointerCapture(id);
      li.classList.remove("dragging");
      document.documentElement.classList.remove("seq-dragging");
      if (!commit) list.insertBefore(li, next);
      const items = listItems(list);
      const to = items.indexOf(li);
      refresh(list);
      if (commit && to !== from) {
         announce(list, fmt(T.blocks.moved, to + 1, items.length));
         changed(list);
      }
   };
   root.addEventListener("pointerdown", (e) => {
      const grip = (e.target as HTMLElement).closest<HTMLElement>("[data-seq-grip]");
      const li = grip?.closest<HTMLElement>("[data-seq-item]");
      if (!grip || !li || !root.contains(grip) || (e.pointerType === "mouse" && e.button !== 0)) return;
      e.preventDefault();
      grip.setPointerCapture(e.pointerId);
      const list = li.parentElement as HTMLElement;
      st = { li, list, next: li.nextSibling, from: listItems(list).indexOf(li), grip, id: e.pointerId };
      li.classList.add("dragging");
      document.documentElement.classList.add("seq-dragging");
   });
   root.addEventListener("pointermove", (e) => {
      if (!st || e.pointerId !== st.id) return;
      // Near the viewport edge, scroll so a long list can be crossed in one drag.
      const edge = 56;
      if (e.clientY < edge) window.scrollBy(0, -14);
      else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 14);
      const over = itemIn(st.list, document.elementFromPoint(e.clientX, e.clientY));
      if (!over || over === st.li) return;
      const items = listItems(st.list);
      const forward = items.indexOf(over) > items.indexOf(st.li);
      // Move only once the pointer is past the middle of the item it is over, so a tall item
      // doesn't flip back and forth. Same row (gallery grid): by x, in the reading direction.
      const r = over.getBoundingClientRect();
      const mine = st.li.getBoundingClientRect();
      const sameRow = Math.abs(r.top - mine.top) < r.height / 2;
      const rtl = getComputedStyle(st.list).direction === "rtl";
      const past = sameRow
         ? (e.clientX > r.left + r.width / 2) !== rtl === forward
         : forward
           ? e.clientY > r.top + r.height / 2
           : e.clientY < r.top + r.height / 2;
      if (!past) return;
      if (forward) over.after(st.li);
      else over.before(st.li);
   });
   root.addEventListener("pointerup", (e) => {
      if (st && e.pointerId === st.id) finish(true);
   });
   root.addEventListener("pointercancel", (e) => {
      if (st && e.pointerId === st.id) finish(false);
   });
   document.addEventListener("keydown", (e) => {
      if (st && e.key === "Escape") {
         e.preventDefault();
         finish(false);
      }
   });
}

function initSeq(root: HTMLElement): void {
   root.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-seq]");
      const li = btn?.closest<HTMLElement>("[data-seq-item]");
      if (!btn || !li) return;
      const op = btn.dataset.seq;
      if (op === "up") move(li, -1);
      else if (op === "down") move(li, 1);
      else if (op === "duplicate") duplicate(li);
      else if (op === "remove") remove(li);
   });
   // Alt+↑ / Alt+↓ inside an item moves it (from any control in it).
   root.addEventListener("keydown", (e) => {
      if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
      const li = (e.target as HTMLElement).closest<HTMLElement>("[data-seq-item]");
      if (!li) return;
      e.preventDefault();
      move(li, e.key === "ArrowUp" ? -1 : 1);
   });
   initDrag(root);
   for (const list of $$("ol[data-seq-list]", root)) refresh(list);
}

/* ── Field behaviour: conditional fields, markdown tools, slide overlay ───────────────────────── */

/** The checked value of radio `k` that belongs to `li` itself (not to an item nested in it). */
function ownChoice(li: Element, k: string): string {
   return $$<HTMLInputElement>(`input[data-k="${k}"]:checked`, li).find((x) => itemOf(x) === li)?.value ?? "";
}

/** `data-when="k=a,b"`: shown when the item's choice k is a or b; `data-when-parent`: the enclosing block's choice. */
export function applyWhen(scope: HTMLElement): void {
   for (const box of $$<HTMLElement>("[data-when],[data-when-parent]", scope)) {
      let li = box.closest("[data-seq-item]");
      const rule = box.dataset.when ?? box.dataset.whenParent!;
      if (box.dataset.whenParent !== undefined) li = li?.parentElement?.closest("[data-seq-item]") ?? null;
      if (!li) continue;
      const [k, values] = rule.split("=");
      box.hidden = !values.split(",").includes(ownChoice(li, k));
   }
}

function mdTools(root: HTMLElement): void {
   root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-mdx]");
      const area = b?.closest("[data-md-root]")?.querySelector<HTMLTextAreaElement>("textarea");
      if (!b || !area) return;
      const wrap = (before: string, after = before, ph = "") => {
         const { selectionStart: a, selectionEnd: z, value } = area;
         area.setRangeText(before + (value.slice(a, z) || ph) + after, a, z, "end");
      };
      const prefix = (p: string) => {
         const start = area.value.lastIndexOf("\n", area.selectionStart - 1) + 1;
         area.setRangeText(p, start, start, "end");
      };
      switch (b.dataset.mdx) {
         case "h2":
            prefix("## ");
            break;
         case "bold":
            wrap("**");
            break;
         case "italic":
            wrap("*");
            break;
         case "quote":
            prefix("> ");
            break;
         case "list":
            prefix("- ");
            break;
         case "link":
            askLink(area).then((href) => {
               if (!href) return;
               wrap("[", `](${href})`, "link");
               area.dispatchEvent(new Event("input", { bubbles: true }));
            });
            break;
         case "video":
            openPicker((item) => {
               if (item.kind !== "video") return toast(T.blocks.channelNoEmbed, "bad");
               const a = area.selectionStart;
               const before = area.value.slice(0, a);
               const pre = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
               area.setRangeText(`${pre}::video[${item.id}]\n\n`, a, a, "end");
               area.dispatchEvent(new Event("input", { bubbles: true }));
            }, b);
            return;
      }
      area.focus();
      area.dispatchEvent(new Event("input", { bubbles: true }));
   });
}

function updateOverlay(li: HTMLElement): void {
   const ov = $<HTMLElement>("[data-overlay]", li);
   if (!ov) return;
   const v = readItem(li);
   $("[data-ov-heading]", ov)!.textContent = String(v.heading ?? "");
   $("[data-ov-body]", ov)!.textContent = String(v.body ?? "");
   ov.className = `ov ov-${String(v.position ?? "bottom")}`;
   ov.hidden = !v.heading && !v.body;
}

/* ── Images: the media chooser ────────────────────────────────────────────────────────────────── */

interface MediaPick {
   id: number;
   url: string;
   alt: string;
   width: number | null;
   height: number | null;
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const mediaUrl = (path: string) => `/api/public/v1/media/${path.split("/").map(encodeURIComponent).join("/")}`;

function metaOf(m: { metadata?: unknown }): Record<string, unknown> {
   if (m.metadata && typeof m.metadata === "object") return m.metadata as Record<string, unknown>;
   try {
      return typeof m.metadata === "string" ? (JSON.parse(m.metadata) as Record<string, unknown>) : {};
   } catch {
      return {};
   }
}
const pickOf = (m: { id: number; path: string; metadata?: unknown }): MediaPick => {
   const meta = metaOf(m);
   const n = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
   return { id: Number(m.id), url: mediaUrl(m.path), alt: typeof meta.alt === "string" ? meta.alt : "", width: n(meta.width), height: n(meta.height) };
};

let mediaResolve: ((picks: MediaPick[]) => void) | null = null;
let mediaMultiple = false;
let mediaOpener: HTMLElement | null = null;
const selected = new Map<number, MediaPick>();
let mediaOffset = 0;
const MEDIA_PAGE = 48;

function mediaTile(p: MediaPick): HTMLLIElement {
   const btn = el("button", { type: "button", class: "mp", "aria-pressed": "false", "data-media-id": String(p.id) });
   const img = el("img", { src: p.url, alt: "", loading: "lazy", decoding: "async" });
   if (p.width && p.height) {
      img.setAttribute("width", String(p.width));
      img.setAttribute("height", String(p.height));
   }
   btn.append(img, el("span", { class: "vh" }, p.alt || `#${p.id}`), el("span", { class: "mp-check", "aria-hidden": "true" }, "✓"));
   btn.setAttribute("aria-label", p.alt ? `${p.alt}` : `${T.blocks.types.image} #${p.id}`);
   btn.addEventListener("click", () => toggleMedia(p, btn));
   return el("li", {}, btn);
}

function toggleMedia(p: MediaPick, btn: HTMLElement): void {
   const dlg = $<HTMLDialogElement>("#media-dlg")!;
   if (!mediaMultiple) {
      selected.clear();
      $$("[data-media-id][aria-pressed=true]", dlg).forEach((x) => x.setAttribute("aria-pressed", "false"));
   }
   if (selected.has(p.id)) {
      selected.delete(p.id);
      btn.setAttribute("aria-pressed", "false");
   } else {
      selected.set(p.id, p);
      btn.setAttribute("aria-pressed", "true");
   }
   const use = $<HTMLButtonElement>("[data-media-use]", dlg)!;
   use.disabled = selected.size === 0;
   $("[data-media-use-label]", dlg)!.textContent = mediaMultiple ? countText(T.counts?.mediaUse, selected.size, T.blocks.mediaUseMany) : T.blocks.mediaUse;
}

async function loadMedia(append: boolean): Promise<void> {
   const dlg = $<HTMLDialogElement>("#media-dlg")!;
   const grid = $("[data-media-grid]", dlg)!;
   const status = $("[data-media-status]", dlg)!;
   const more = $<HTMLButtonElement>("[data-media-more]", dlg)!;
   if (!append) {
      grid.replaceChildren();
      mediaOffset = 0;
   }
   status.textContent = T.blocks.mediaLoading;
   try {
      const where = encodeURIComponent(JSON.stringify({ mime_type: { $in: IMAGE_TYPES } }));
      const res = await api<{ data: { id: number; path: string; metadata?: unknown }[]; meta?: { count?: number; total?: number } }>(
         "GET",
         `/api/data/entity/media?where=${where}&sort=-id&limit=${MEDIA_PAGE}&offset=${mediaOffset}&select=id,path,metadata`,
      );
      for (const m of res.data) if (m.path) grid.append(mediaTile(pickOf(m)));
      mediaOffset += res.data.length;
      const total = Number(res.meta?.count ?? res.meta?.total ?? mediaOffset);
      more.hidden = mediaOffset >= total || res.data.length < MEDIA_PAGE;
      status.textContent = grid.children.length ? "" : T.blocks.mediaEmpty;
   } catch {
      status.textContent = T.blocks.mediaFailed;
   }
}

async function uploadFiles(files: FileList | File[]): Promise<void> {
   const dlg = $<HTMLDialogElement>("#media-dlg")!;
   const status = $("[data-media-status]", dlg)!;
   const grid = $("[data-media-grid]", dlg)!;
   const drop = $("[data-media-drop]", dlg)!;
   for (const f of [...files]) {
      if (!IMAGE_TYPES.includes(f.type) || f.size > 10 * 1024 * 1024) {
         status.textContent = T.blocks.mediaUploadFailed;
         continue;
      }
      drop.setAttribute("aria-busy", "true");
      status.textContent = fmt(T.blocks.mediaUploading, f.name);
      try {
         const fd = new FormData();
         fd.append("file", f, f.name);
         // No name in the path: bknd generates a unique one, so an upload never replaces a file (PR #27).
         const up = await api<{ name: string }>("POST", "/api/media/upload", fd);
         const where = encodeURIComponent(JSON.stringify({ path: up.name }));
         const row = await api<{ data: { id: number; path: string; metadata?: unknown }[] }>("GET", `/api/data/entity/media?where=${where}&limit=1&select=id,path,metadata`);
         const m = row.data[0];
         if (!m) throw new Error("no row");
         const p = pickOf(m);
         const li = mediaTile(p);
         grid.prepend(li);
         toggleMedia(p, $("button", li)!);
         status.textContent = "";
      } catch {
         status.textContent = T.blocks.mediaUploadFailed;
      } finally {
         drop.removeAttribute("aria-busy");
      }
   }
}

export function chooseMedia(multiple: boolean, from: HTMLElement): Promise<MediaPick[]> {
   const dlg = $<HTMLDialogElement>("#media-dlg");
   if (!dlg) return Promise.resolve([]);
   mediaMultiple = multiple;
   mediaOpener = from;
   selected.clear();
   const use = $<HTMLButtonElement>("[data-media-use]", dlg)!;
   use.disabled = true;
   $("[data-media-use-label]", dlg)!.textContent = multiple ? countText(T.counts?.mediaUse, 0, T.blocks.mediaUseMany) : T.blocks.mediaUse;
   void loadMedia(false);
   dlg.showModal();
   return new Promise((resolve) => (mediaResolve = resolve));
}

function initMediaDialog(): void {
   const dlg = $<HTMLDialogElement>("#media-dlg");
   if (!dlg) return;
   const finish = (picks: MediaPick[]) => {
      mediaResolve?.(picks);
      mediaResolve = null;
      if (dlg.open) dlg.close();
   };
   $$("[data-media-close]", dlg).forEach((b) => b.addEventListener("click", () => finish([])));
   dlg.addEventListener("cancel", () => finish([]));
   dlg.addEventListener("close", () => {
      if (mediaResolve) finish([]);
      mediaOpener?.focus();
   });
   $("[data-media-use]", dlg)!.addEventListener("click", () => finish([...selected.values()]));
   $("[data-media-more]", dlg)!.addEventListener("click", () => void loadMedia(true));
   const input = $<HTMLInputElement>("[data-media-upload]", dlg)!;
   input.addEventListener("change", () => {
      if (input.files?.length) void uploadFiles(input.files);
      input.value = "";
   });
   const drop = $("[data-media-drop]", dlg)!;
   drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("over");
   });
   drop.addEventListener("dragleave", () => drop.classList.remove("over"));
   drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      if (e.dataTransfer?.files.length) void uploadFiles(e.dataTransfer.files);
   });
}

/** Puts a chosen image into a slot (or clears it). */
function setImage(slot: HTMLElement, p: MediaPick | null): void {
   const input = $<HTMLInputElement>("input[data-k=media_id]", slot)!;
   const view = $("[data-image-view]", slot)!;
   input.value = p ? String(p.id) : "";
   $$("[data-image-img],[data-image-empty]", view).forEach((x) => x.remove());
   const node = p
      ? el("img", { src: p.url, alt: "", loading: "lazy", decoding: "async", "data-image-img": "", ...(p.width && p.height ? { width: String(p.width), height: String(p.height) } : {}) })
      : el("span", { class: "img-empty", "data-image-empty": "" }, T.blocks.noImage);
   view.prepend(node);
   $("[data-choose-label]", slot)!.textContent = p ? T.blocks.replaceImage : T.blocks.chooseImage;
   const clear = $<HTMLElement>("[data-clear-image]", slot);
   if (clear) clear.hidden = !p;
   // An empty alt picks up the library's description.
   const li = slot.closest<HTMLElement>("[data-seq-item]");
   const alt = li ? $$<HTMLInputElement>("input[data-k=alt]", li).find((x) => itemOf(x) === li) : undefined;
   if (p && alt && !alt.value.trim() && p.alt) alt.value = p.alt;
   if (li) {
      refresh(li.parentElement!);
      if (li.matches(".slide")) updateOverlay(li);
   }
   changed(slot);
}

/* ── Posts chooser ────────────────────────────────────────────────────────────────────────────── */

let postsTarget: HTMLElement | null = null;

function initPostsDialog(): void {
   const dlg = $<HTMLDialogElement>("#posts-dlg");
   if (!dlg) return;
   const locale = dlg.dataset.locale;
   const status = $("[data-posts-status]", dlg)!;
   const results = $("[data-posts-results]", dlg)!;
   $("[data-posts-close]", dlg)!.addEventListener("click", () => dlg.close());
   dlg.addEventListener("close", () => postsTarget?.querySelector<HTMLElement>("[data-pick-posts]")?.focus());
   const begin = latestOnly();
   const search = async (q: string) => {
      const isCurrent = begin();
      status.textContent = T.blocks.mediaLoading;
      results.replaceChildren();
      try {
         const where: Record<string, unknown> = { locale };
         if (q) where.title = { $like: `*${q.replace(/\*/g, "")}*` };
         const res = await api<{ data: { id: number; title: string; status: string; locale: string }[] }>(
            "GET",
            `/api/data/entity/posts?where=${encodeURIComponent(JSON.stringify(where))}&sort=-updated_at&limit=30&select=id,title,status,locale`,
         );
         // A newer search started while this one was in flight: its answer is the one to show.
         if (!isCurrent()) return;
         results.replaceChildren();
         status.textContent = res.data.length ? "" : T.blocks.postsNone;
         const list = postsTarget ? $("ol[data-k=post_ids]", postsTarget) : null;
         const have = new Set(list ? listItems(list).map((li) => String(readItem(li).v)) : []);
         for (const p of res.data) {
            const btn = el("button", { type: "button", class: "btn primary sm", "aria-label": `${T.blocks.pick}: ${p.title}` }, T.blocks.pick);
            if (have.has(String(p.id))) {
               btn.textContent = T.blocks.picked;
               btn.setAttribute("disabled", "");
            }
            btn.addEventListener("click", () => {
               if (!list) return;
               appendFromTemplate(list, "posts", (li) => {
                  $<HTMLInputElement>("input[data-k=v]", li)!.value = String(p.id);
                  const title = $("[data-post-title]", li)!;
                  title.textContent = p.title;
                  title.setAttribute("lang", p.locale);
                  const badge = $("[data-post-status]", li)!;
                  const pub = p.status === "published";
                  badge.className = `badge ${pub ? "published" : "draft"}`;
                  badge.textContent = T.status?.[pub ? "published" : "draft"] ?? p.status;
               });
               btn.textContent = T.blocks.picked;
               btn.setAttribute("disabled", "");
               announce(list, fmt(T.blocks.added, p.title));
            });
            results.append(el("li", {}, el("span", { class: "ph" }), el("div", {}, el("div", { class: "t", dir: "auto", lang: p.locale }, p.title)), btn));
         }
      } catch {
         if (isCurrent()) status.textContent = T.blocks.postsFailed;
      }
   };
   const form = $<HTMLFormElement>("[data-posts-form]", dlg)!;
   form.addEventListener("submit", (e) => {
      e.preventDefault();
      live.cancel();
      void search(String(new FormData(form).get("q") ?? "").trim());
   });
   // Results follow the typing (same pause as the search boxes' suggestions); Enter still searches at once.
   const live = liveSearch($<HTMLInputElement>("input[name=q]", form), (q) => void search(q));
   (dlg as HTMLDialogElement & { search?: typeof search }).search = search;
}

/* ── Videos (snapshot server-side, like the curated picker) ───────────────────────────────────── */

async function snapshot(item: PickedItem): Promise<{ title: string; thumbnail_url: string | null } | null> {
   try {
      const res = await api<{ data: { snapshot: { title: string; thumbnail_url: string | null } } }>("POST", "/picker/api/snapshots", { kind: item.kind, ref_id: item.id });
      return res.data.snapshot;
   } catch (e) {
      toast(e instanceof ApiError && e.status === 404 ? T.blocks.videoGone : T.blocks.videoFailed, "bad");
      return null;
   }
}

function setVideoView(scope: HTMLElement, item: PickedItem, snap: { title: string; thumbnail_url: string | null }): void {
   $<HTMLInputElement>("input[data-k=kind]", scope)!.value = item.kind;
   $<HTMLInputElement>("input[data-k=ref_id]", scope)!.value = item.id;
   const thumb = $("[data-video-thumb]", scope);
   const img = snap.thumbnail_url ? el("img", { src: snap.thumbnail_url, alt: "", loading: "lazy", "data-video-thumb": "", class: thumb?.classList.contains("vthumb") ? "vthumb" : "" }) : null;
   if (thumb && img) thumb.replaceWith(img);
   const title = $("[data-video-title]", scope);
   if (title) title.textContent = snap.title;
}

/* ── Block picker ─────────────────────────────────────────────────────────────────────────────── */

let pickerAfter: HTMLElement | null = null;
let pickerOpener: HTMLElement | null = null;

/** Opens the picker to add a block after `after` (null: at the end). */
function openBlockPicker(root: HTMLElement, from: HTMLElement, after: HTMLElement | null): void {
   const dlg = $<HTMLDialogElement>("#blk-picker", root);
   if (!dlg) return;
   pickerAfter = after;
   pickerOpener = from;
   const q = $<HTMLInputElement>("[data-picker-q]", dlg)!;
   q.value = "";
   filterPicker(dlg, "");
   dlg.showModal();
   q.focus();
}

function filterPicker(dlg: HTMLElement, raw: string): void {
   const words = raw.toLowerCase().split(/\s+/).filter(Boolean);
   let any = false;
   for (const group of $$<HTMLElement>("[data-pk-group]", dlg)) {
      let shown = 0;
      for (const li of $$<HTMLElement>("[data-pk-item]", group)) {
         const hit = words.every((w) => (li.dataset.search ?? "").includes(w));
         li.hidden = !hit;
         if (hit) shown++;
      }
      group.hidden = shown === 0;
      any ||= shown > 0;
   }
   $<HTMLElement>("[data-picker-none]", dlg)!.hidden = any;
}

function initBlockPicker(root: HTMLElement): void {
   const dlg = $<HTMLDialogElement>("#blk-picker", root);
   if (!dlg) return;
   const list = $("ol[data-k=blocks]", root)!;
   $("[data-picker-close]", dlg)!.addEventListener("click", () => dlg.close());
   dlg.addEventListener("close", () => {
      if (pickerOpener?.isConnected) pickerOpener.focus();
      pickerOpener = null;
   });
   // A click on the backdrop closes it, like Esc.
   dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
   });
   const q = $<HTMLInputElement>("[data-picker-q]", dlg)!;
   q.addEventListener("input", () => filterPicker(dlg, q.value));
   q.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      $<HTMLButtonElement>("[data-pk-item]:not([hidden]) [data-preset]", dlg)?.click();
   });
   dlg.addEventListener("click", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-preset]");
      if (!card) return;
      const added = appendFromTemplate(list, `block:${card.dataset.preset}`, undefined, pickerAfter);
      pickerOpener = null;
      dlg.close();
      if (!added) return;
      applyWhen(added);
      announce(list, fmt(T.blocks.added, card.dataset.presetName ?? ""));
      added.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      // The first field to type in (the markdown toolbar comes before the text), else the first control.
      ($<HTMLElement>(".blk-b textarea, .blk-b input:not([type=hidden]):not([type=radio]):not([type=checkbox])", added) ?? $<HTMLElement>(".blk-b button, .blk-b input:not([type=hidden])", added) ?? added).focus();
      added.dispatchEvent(new CustomEvent("blk:added", { bubbles: true }));
   });
}

/* ── Wiring ───────────────────────────────────────────────────────────────────────────────────── */

/** The media dialog alone (a scholar's profile photo), on a page without a blocks editor. */
export function initMediaPicker(): void {
   if (!$("#media-dlg") || $$("[data-blocks-editor],[data-slides-editor]").length) return;
   T = strings<S>();
   initMediaDialog();
}

export function initBlocks(): void {
   const roots = $$<HTMLElement>("[data-blocks-editor],[data-slides-editor]");
   if (!roots.length) return;
   T = strings<S>();
   initMediaDialog();
   initPostsDialog();
   for (const root of roots) {
      initSeq(root);
      mdTools(root);
      applyWhen(root);
      $$<HTMLElement>(".slide", root).forEach(updateOverlay);
      root.addEventListener("change", (e) => {
         const target = e.target as HTMLInputElement;
         const li = target.closest<HTMLElement>("[data-seq-item]");
         if (li?.dataset.blockType === "layout" && target.dataset.k === "columns" && itemOf(target) === li) {
            const list = $<HTMLElement>("ol[data-seq-list=layout-cols]", li);
            while (list && listItems(list).length < Number(target.value)) appendFromTemplate(list, "layout-cols");
         }
         if (li) {
            applyWhen(li);
            refresh(li.parentElement!);
         }
      });
      root.addEventListener("input", (e) => {
         const target = e.target as HTMLElement;
         const li = target.closest<HTMLElement>("[data-seq-item]");
         if (!li) return;
         $<HTMLElement>(":scope > [data-block-err]", li)?.setAttribute("hidden", "");
         target.removeAttribute("aria-invalid");
         const slide = target.closest<HTMLElement>(".slide");
         if (slide) updateOverlay(slide);
      });
      root.addEventListener("click", async (e) => {
         const t = e.target as HTMLElement;
         const btn = t.closest<HTMLButtonElement>("button");
         if (!btn) return;
         const li = btn.closest<HTMLElement>("[data-seq-item]");
         if (btn.matches("[data-open-picker]")) {
            openBlockPicker(root, btn, btn.dataset.openPicker === "after" ? li : null);
         } else if (btn.matches("[data-blk-fold]") && li) {
            unfold(li, li.classList.contains("folded"));
         } else if (btn.matches("[data-add-sub]")) {
            const list = btn.closest(".stack-sm")?.querySelector<HTMLElement>(`:scope > ol[data-seq-list="${btn.dataset.addSub}"]`);
            if (!list) return;
            const added = appendFromTemplate(list, btn.dataset.addSub!);
            if (added) {
               applyWhen(added.parentElement!.closest<HTMLElement>("[data-seq-item]") ?? added);
               announce(list, fmt(T.blocks.added, itemName(added)));
               $<HTMLElement>("input:not([type=hidden]):not([type=radio]), textarea, [data-choose-image]", added)?.focus();
            }
         } else if (btn.matches("[data-add-slide]")) {
            const list = $("ol[data-k=slides]", root)!;
            const added = appendFromTemplate(list, "slide");
            if (added) {
               announce(list, fmt(T.blocks.added, T.slides.one));
               $<HTMLElement>("[data-choose-image]", added)?.focus();
            }
         } else if (btn.matches("[data-add-slides-from-images]")) {
            const list = $("ol[data-k=slides]", root)!;
            const picks = await chooseMedia(true, btn);
            let last: HTMLElement | null = null;
            for (const p of picks) {
               last = appendFromTemplate(list, "slide", (s) => setImage($("[data-image-slot]", s)!, p));
            }
            if (last) {
               announce(list, fmt(T.blocks.added, `${pageNum(picks.length)} × ${T.slides.one}`));
               $<HTMLElement>("input[data-k=heading]", last)?.focus();
            }
         } else if (btn.matches("[data-choose-image]")) {
            const slot = btn.closest<HTMLElement>("[data-image-slot]")!;
            const [p] = await chooseMedia(false, btn);
            if (p) setImage(slot, p);
         } else if (btn.matches("[data-clear-image]")) {
            const slot = btn.closest<HTMLElement>("[data-image-slot]")!;
            setImage(slot, null);
            $<HTMLElement>("[data-choose-image]", slot)?.focus();
         } else if (btn.matches("[data-add-images]") && li) {
            const list = $("ol[data-k=items]", li)!;
            const picks = await chooseMedia(true, btn);
            for (const p of picks) appendFromTemplate(list, "gallery", (s) => setImage($("[data-image-slot]", s)!, p));
            if (picks.length) announce(list, fmt(T.blocks.added, `${pageNum(picks.length)} × ${T.blocks.types.image}`));
         } else if (btn.matches("[data-pick-posts]") && li) {
            postsTarget = li;
            const dlg = $<HTMLDialogElement>("#posts-dlg");
            if (!dlg) return;
            dlg.showModal();
            $<HTMLInputElement>("#posts-q", dlg)?.focus();
            void (dlg as HTMLDialogElement & { search?: (q: string) => Promise<void> }).search?.("");
         } else if (btn.matches("[data-add-videos]") && li) {
            const list = $("ol[data-k=items]", li)!;
            // Videos already in this block are marked in the picker
            const have = $$<HTMLElement>(":scope > li", list).map((x) => `${$<HTMLInputElement>("[data-k=kind]", x)?.value ?? "video"}:${$<HTMLInputElement>("[data-k=ref_id]", x)?.value ?? ""}`);
            openPicker(async (item) => {
               const snap = await snapshot(item);
               if (!snap) return;
               appendFromTemplate(list, "videos", (s) => setVideoView(s, item, snap));
               announce(list, fmt(T.blocks.added, snap.title));
            }, btn, { added: have });
         } else if (btn.matches("[data-choose-video]") && li) {
            const slot = btn.closest<HTMLElement>("[data-video-slot]")!;
            openPicker(async (item) => {
               if (item.kind === "channel") return toast(T.blocks.channelNoEmbed, "bad");
               const snap = await snapshot(item);
               if (!snap) return;
               setVideoView(slot, item, snap);
               $("[data-choose-label]", slot)!.textContent = T.blocks.replaceVideo;
               refresh(li.parentElement!);
               changed(slot);
            }, btn);
         }
      });
      if (root.matches("[data-blocks-editor]")) {
         initBlockPicker(root);
         initPageBuilder(root, T);
      }
   }
   // Post kind: Article ↔ Cards shows the body or the slides (both are kept on save).
   for (const r of $$<HTMLInputElement>("input[data-post-kind]")) {
      r.addEventListener("change", () => {
         for (const panel of $$<HTMLElement>("[data-kind-panel]")) panel.hidden = panel.dataset.kindPanel !== r.value || !r.checked;
      });
   }
}
