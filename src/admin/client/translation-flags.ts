/**
 * Translation flags in the editor (docs/TRANSLATION_FLAGS.md). On a translation (a saved row with a
 * version in the other language), selecting text in the title, summary, body or a card slide shows a
 * "Flag translation" popover. Flagged spans are tinted and underlined in the fields (a layer drawn over
 * each field, aria-hidden); the "Translation flags" card is the keyboard-reachable list with
 * show-in-text, apply suggestion, re-translate selection, add to glossary, resolve and dismiss.
 *
 * Text changes made here (apply, re-translate, an edit of flagged words after the in-app prompt) resolve
 * their flag only when the post is saved (src/admin/client/save-hooks.ts): until then the flag shows
 * "Resolves when you save", and leaving without saving leaves it open.
 */
import { $, $$, api, ApiError, el, strings, toast } from "./dom.ts";
import { addSaveHook } from "./save-hooks.ts";
import { resolveAnchor, type Range } from "../../lib/translation-flags/anchor.ts";

type Locale = "en" | "ar";
type Field = HTMLInputElement | HTMLTextAreaElement;

interface FlagEvent {
   action: string;
   at: number;
   email: string | null;
}

interface Flag {
   id: string;
   field: string;
   quote: string;
   prefix: string;
   suffix: string;
   start: number;
   end: number;
   sourceText: string | null;
   sourceScope: string;
   reason: string;
   suggestion: string | null;
   note: string | null;
   quran: boolean;
   quranUrl: string | null;
   status: "open" | "resolved" | "dismissed";
   resolution: string | null;
   createdBy: string | null;
   createdAt: number;
   resolvedBy: string | null;
   resolvedAt: number | null;
   events: FlagEvent[];
}

interface Strings {
   flag: string;
   none: string;
   openCount: string;
   fieldNote: string;
   noHistory: string;
   sourceScope: Record<string, string>;
   reasons: Record<string, string>;
   flagged: string;
   fields: Record<string, string>;
   jump: string;
   jumpTo: string;
   apply: string;
   retranslate: string;
   resolve: string;
   dismiss: string;
   reopen: string;
   addGlossary: string;
   officialText: string;
   officialHelp: string;
   notFound: string;
   pending: string;
   editKeep: string;
   pendingApplied: string;
   by: string;
   resolvedBy: string;
   statuses: Record<string, string>;
   resolutions: Record<string, string>;
   altWorking: string;
   altNone: string;
   glossAdded: string;
   glossExists: string;
   failed: string;
   dismissed: string;
   resolved: string;
   reopened: string;
   errors: Record<string, string>;
}

const GLOSSARY_REASONS = ["term", "islamic_term"];

/** Opens a dialog with no stale answer and resolves with the button's value. */
function ask(dlg: HTMLDialogElement): Promise<string> {
   dlg.returnValue = "";
   dlg.showModal();
   return new Promise((resolve) => dlg.addEventListener("close", () => resolve(dlg.returnValue), { once: true }));
}

const fmt = (s: string, ...a: (string | number)[]) => a.reduce<string>((acc, v, i) => acc.split(`{${i}}`).join(String(v)), s);

export function initTranslationFlags(): void {
   const form = $<HTMLFormElement>("form[data-editor]");
   if (!form || form.dataset.trf !== "1") return;
   const T = strings<{ trFlags: Strings }>().trFlags;
   const kind = form.dataset.editor as "pages" | "posts";
   const id = form.dataset.id || "";
   const locale: Locale = form.dataset.locale === "ar" ? "ar" : "en";
   const other: Locale = locale === "en" ? "ar" : "en";
   const canResolve = form.dataset.trfResolve === "1";
   const ai = form.dataset.ai === "1";
   const card = $("[data-trf-card]");
   const list = $<HTMLUListElement>("[data-trf-list]");
   const historyList = $<HTMLUListElement>("[data-trf-history]");
   const live = $("[data-trf-live]");
   const pop = $("[data-trf-pop]");
   if (!card || !list || !historyList || !pop) return;
   document.body.append(pop); // positioned in page coordinates

   let flags: Flag[] = [];
   /** Fixes made in the text, sent when the post is saved. */
   const pending = new Map<string, { resolution: "applied" | "retranslated" | "edited"; text: string | null }>();
   /** Flags whose words were edited but the editor chose "Keep open" (not asked again). */
   const declined = new Set<string>();
   let current: string | null = null;

   const announce = (msg: string) => {
      if (live) live.textContent = msg;
   };

   // ---- fields ----

   const SLIDE_KEYS = ["heading", "body"];
   const fieldKey = (f: Element | null): string | null => {
      if (!f || !(f instanceof HTMLInputElement || f instanceof HTMLTextAreaElement) || !form.contains(f)) return null;
      if (f.id === "f-title") return "title";
      if (f.id === "f-summary") return "summary";
      if (f.id === "f-body") return "body";
      const k = f.dataset.k ?? "";
      const slide = f.closest("[data-slides-editor] li.slide");
      if (slide && SLIDE_KEYS.includes(k)) {
         const sid = $<HTMLInputElement>('input[type=hidden][data-k="id"]', slide)?.value;
         if (sid && sid !== "__BID__") return `slide:${sid}:${k}`;
      }
      return null;
   };
   const allFields = (): Field[] => [...$$<Field>("#f-title, #f-summary, #f-body", form), ...$$<Field>("[data-slides-editor] li.slide [data-k=heading], [data-slides-editor] li.slide [data-k=body]", form)];
   const fieldEl = (key: string): Field | null => allFields().find((f) => fieldKey(f) === key) ?? null;
   const fieldLabel = (key: string): string => {
      const m = key.match(/^slide:([^:]+):(heading|body)$/);
      if (!m) return T.fields[key] ?? key;
      const slides = $$("[data-slides-editor] li.slide", form);
      const n = slides.findIndex((li) => $<HTMLInputElement>('input[type=hidden][data-k="id"]', li)?.value === m[1]) + 1;
      return fmt(m[2] === "heading" ? T.fields.heading : T.fields.slideBody, n || "?");
   };
   const fieldOrder = (key: string) => {
      const i = allFields().findIndex((f) => fieldKey(f) === key);
      return i === -1 ? 999 : i;
   };
   const where = (f: Flag): Range | null => {
      const e = fieldEl(f.field);
      return e ? resolveAnchor(e.value, { quote: f.quote, prefix: f.prefix, suffix: f.suffix, start: f.start }) : null;
   };

   // ---- the highlight layer over a field ----

   interface Layer {
      wrap: HTMLElement;
      mirror: HTMLElement;
      note: HTMLElement;
   }
   const layers = new WeakMap<Field, Layer>();
   let noteSeq = 0;
   const COPY = ["fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing", "wordSpacing", "textTransform", "textIndent", "tabSize", "textAlign", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight", "borderTopWidth", "borderBottomWidth", "borderLeftWidth", "borderRightWidth", "borderRadius", "whiteSpace", "overflowWrap", "wordBreak", "direction"] as const;

   const layerOf = (f: Field): Layer => {
      let l = layers.get(f);
      if (l) return l;
      const wrap = el("span", { class: "trf-wrap" });
      // Moving a focused field blurs it: put the focus and selection back.
      const focused = document.activeElement === f;
      const [s0, s1, sd] = [f.selectionStart, f.selectionEnd, f.selectionDirection];
      f.before(wrap);
      wrap.append(f);
      if (focused) {
         f.focus({ preventScroll: true });
         if (s0 !== null && s1 !== null) f.setSelectionRange(s0, s1, sd ?? "none");
      }
      const mirror = el("div", { class: "trf-mirror", "aria-hidden": "true" });
      const note = el("span", { class: "vh", id: `trf-note-${++noteSeq}` }, T.fieldNote);
      note.hidden = true;
      wrap.append(mirror, note);
      f.addEventListener("scroll", () => sync(f));
      new ResizeObserver(() => paint(f)).observe(f);
      l = { wrap, mirror, note };
      layers.set(f, l);
      return l;
   };

   const sync = (f: Field) => {
      const l = layers.get(f);
      if (!l) return;
      l.mirror.scrollTop = f.scrollTop;
      l.mirror.scrollLeft = f.scrollLeft;
   };

   const styleMirror = (f: Field, m: HTMLElement) => {
      const cs = getComputedStyle(f);
      for (const k of COPY) (m.style as unknown as Record<string, string>)[k] = cs[k];
      m.style.borderStyle = "solid";
      if (f instanceof HTMLInputElement) {
         m.style.whiteSpace = "pre";
         m.style.display = "flex";
         m.style.alignItems = "center";
      } else {
         // The textarea's scrollbar takes width from its text: the layer leaves the same room.
         const bar = f.offsetWidth - f.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
         if (bar > 0) m.style.paddingInlineEnd = `${parseFloat(cs.paddingInlineEnd || cs.paddingRight) + bar}px`;
      }
      m.dir = f.getAttribute("dir") || "";
      m.lang = f.lang;
   };

   /** Draws the field's text into the layer with the flagged spans (and an optional caret marker). */
   const paint = (f: Field, marker?: number): HTMLElement | null => {
      const key = fieldKey(f);
      const mine = key ? flags.filter((x) => x.status === "open" && x.field === key) : [];
      const l = mine.length || marker !== undefined ? layerOf(f) : layers.get(f);
      if (!l) return null;
      styleMirror(f, l.mirror);
      const text = f.value;
      const spans = mine
         .map((x) => ({ x, r: resolveAnchor(text, { quote: x.quote, prefix: x.prefix, suffix: x.suffix, start: x.start }) }))
         .filter((s): s is { x: Flag; r: Range } => !!s.r)
         .sort((a, b) => a.r.start - b.r.start);
      const parts: (Node | string)[] = [];
      let at = 0;
      let caret: HTMLElement | null = null;
      const plain = (to: number) => {
         if (marker !== undefined && marker >= at && marker <= to && !caret) {
            parts.push(text.slice(at, marker));
            caret = el("span", {}, "​");
            parts.push(caret);
            at = marker;
         }
         if (to > at) parts.push(text.slice(at, to));
         at = Math.max(at, to);
      };
      for (const { x, r } of spans) {
         if (r.start < at) continue; // overlapping flags: the first one is drawn
         plain(r.start);
         const cls = [x.id === current ? "cur" : "", pending.has(x.id) ? "pend" : ""].filter(Boolean).join(" ");
         parts.push(el("mark", cls ? { class: cls } : {}, text.slice(r.start, r.end)));
         at = r.end;
      }
      plain(text.length);
      if (marker !== undefined && !caret) {
         caret = el("span", {}, "​");
         parts.push(caret);
      }
      // Field text only ever goes in as text nodes (append), never as markup.
      if (f instanceof HTMLInputElement) {
         const line = document.createElement("span");
         line.append(...parts);
         l.mirror.replaceChildren(line);
      } else {
         l.mirror.replaceChildren(...parts, "\n");
      }
      sync(f);
      // The field says it has flagged text (screen readers): the card lists them.
      const ids = (f.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((s) => s && s !== l.note.id);
      if (spans.length) ids.push(l.note.id);
      if (ids.length) f.setAttribute("aria-describedby", ids.join(" "));
      else f.removeAttribute("aria-describedby");
      return caret;
   };
   const paintAll = () => {
      for (const f of allFields()) {
         layerOf(f); // every flaggable field gets its layer before anyone types in it
         paint(f);
      }
   };

   // ---- the popover ----

   let selection: { key: string; field: Field; start: number; end: number; text: string } | null = null;
   const hidePop = () => {
      pop.hidden = true;
      selection = null;
   };
   const showPop = (f: Field) => {
      const key = fieldKey(f);
      const start = f.selectionStart ?? 0;
      const end = f.selectionEnd ?? 0;
      if (!key || end <= start || !f.value.slice(start, end).trim()) return hidePop();
      selection = { key, field: f, start, end, text: f.value };
      const caret = paint(f, end);
      const box = (caret ?? f).getBoundingClientRect();
      paint(f); // back to the highlights only
      pop.hidden = false;
      const fieldBox = f.getBoundingClientRect();
      const top = Math.min(Math.max(box.bottom, fieldBox.top), fieldBox.bottom) + 6;
      const w = pop.offsetWidth;
      const left = Math.min(Math.max(8, box.left - w / 2), document.documentElement.clientWidth - w - 8);
      pop.style.top = `${top + scrollY}px`;
      pop.style.left = `${left + scrollX}px`;
   };
   /** Restoring the selection after a dialog fires `select`: no popover for that. */
   let quiet: { field: Field; start: number; end: number } | null = null;
   const check = () => {
      const f = document.activeElement as Field | null;
      if (quiet && f === quiet.field && f.selectionStart === quiet.start && f.selectionEnd === quiet.end) return;
      quiet = null;
      if (fieldKey(f)) showPop(f!);
   };
   document.addEventListener("mouseup", () => setTimeout(check, 0), true);
   document.addEventListener("keyup", (e) => {
      if (e.key === "Tab" || e.key === "Escape") return;
      check();
   }, true);
   form.addEventListener("select", check, true);
   form.addEventListener("focusout", (e) => {
      if (pop.contains(e.relatedTarget as Node | null)) return;
      if (fieldKey(e.target as Element)) setTimeout(() => {
         if (!pop.contains(document.activeElement)) pop.hidden = true;
      }, 0);
   });
   // Keyboard: Tab from a field with a selection goes to the popover; Esc closes it.
   form.addEventListener("keydown", (e) => {
      if (e.key === "Tab" && !e.shiftKey && !pop.hidden && selection && e.target === selection.field) {
         e.preventDefault();
         $<HTMLButtonElement>("[data-trf-pop-btn]", pop)?.focus();
      } else if (e.key === "Escape" && !pop.hidden) pop.hidden = true;
   });
   pop.addEventListener("keydown", (e) => {
      if (e.key === "Escape" || (e.key === "Tab" && e.shiftKey)) {
         e.preventDefault();
         const f = selection?.field;
         pop.hidden = true;
         f?.focus();
      }
   });
   $("[data-trf-pop-btn]", pop)?.addEventListener("click", () => {
      const s = selection;
      pop.hidden = true;
      if (s) void openFlagDialog(s);
   });

   // ---- flag dialog ----

   const dlg = $<HTMLDialogElement>("#trf-dlg");
   async function openFlagDialog(s: NonNullable<typeof selection>) {
      if (!dlg) return;
      const quote = $("[data-trf-quote]", dlg)!;
      const src = $("[data-trf-src]", dlg)!;
      const srcNone = $("[data-trf-src-none]", dlg)!;
      const scope = $("[data-trf-src-scope]", dlg)!;
      const quran = $<HTMLInputElement>("[data-trf-quran]", dlg)!;
      const suggestion = $<HTMLTextAreaElement>("#trf-suggestion", dlg)!;
      const note = $<HTMLTextAreaElement>("#trf-note", dlg)!;
      quote.textContent = s.text.slice(s.start, s.end).trim();
      src.textContent = "";
      src.hidden = true;
      srcNone.hidden = true;
      scope.textContent = "";
      quran.checked = false;
      suggestion.value = "";
      note.value = "";
      $<HTMLInputElement>('input[name="trf-reason"]', dlg)!.checked = true;
      const body = { kind, id, field: s.key, text: s.text, start: s.start, end: s.end };
      const preview = api<{ sourceText: string; sourceScope: string; quran: boolean }>("POST", "/admin/api/translation-flags/preview", body)
         .then((p) => {
            src.textContent = p.sourceText;
            src.hidden = !p.sourceText;
            srcNone.hidden = !!p.sourceText;
            scope.textContent = p.sourceText && T.sourceScope[p.sourceScope] ? `(${T.sourceScope[p.sourceScope]})` : "";
            if (p.quran) quran.checked = true;
         })
         .catch(() => {
            srcNone.hidden = false;
         });
      const answer = ask(dlg);
      $<HTMLInputElement>('input[name="trf-reason"]:checked', dlg)?.focus();
      await preview;
      const ok = (await answer) === "ok";
      quiet = { field: s.field, start: s.start, end: s.end };
      s.field.focus();
      s.field.setSelectionRange(s.start, s.end);
      if (!ok) return;
      try {
         const reason = $<HTMLInputElement>('input[name="trf-reason"]:checked', dlg)?.value ?? "other";
         const res = await api<{ flag: Flag }>("POST", "/admin/api/translation-flags", { ...body, reason, suggestion: suggestion.value, note: note.value, quran: quran.checked });
         flags.unshift(res.flag);
         render();
         toast(T.flagged);
         announce(T.flagged);
      } catch {
         toast(T.failed, "bad");
      }
   }

   // ---- the card ----

   const time = (ms: number) => {
      const d = new Date(ms);
      return el("time", { datetime: d.toISOString() }, new Intl.DateTimeFormat(document.documentElement.lang === "ar" ? "ar-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(d));
   };
   const btn = (label: string, attrs: Record<string, string>, onClick: () => void, cls = "btn sm") => {
      const b = el("button", { class: cls, type: "button", ...attrs }, label);
      b.addEventListener("click", onClick);
      return b;
   };
   const quoteEl = (text: string, lang: Locale) => el("blockquote", { class: "ai-quote", lang, dir: lang === "ar" ? "rtl" : "ltr" }, text);

   function openItem(f: Flag): HTMLLIElement {
      const r = where(f);
      const isPending = pending.get(f.id);
      const head = el(
         "p",
         { class: "trf-h", style: "margin:0" },
         el("strong", {}, fieldLabel(f.field)),
         el("span", { class: "badge loc" }, T.reasons[f.reason] ?? f.reason),
         ...(f.quran ? [el("span", { class: "badge scheduled" }, T.reasons.quran_hadith)] : []),
         ...(isPending ? [el("span", { class: "badge published" }, T.pending)] : []),
      );
      const li = el("li", { "data-trf-flag": f.id }, head, quoteEl(f.quote, locale));
      if (f.sourceText) li.append(quoteEl(f.sourceText, other));
      if (f.suggestion) li.append(el("p", { class: "trf-sugg" }, `→ `, el("span", { lang: locale, dir: "auto" }, f.suggestion)));
      if (f.note) li.append(el("p", { class: "help", dir: "auto", style: "margin:0" }, f.note));
      if (!r && !isPending) li.append(el("p", { class: "trf-lost" }, T.notFound));
      li.append(el("p", { class: "help", style: "margin:0" }, fmt(T.by, f.createdBy ?? "—"), " · ", time(f.createdAt)));
      const acts = el("div", { class: "trf-acts" });
      if (r) acts.append(btn(T.jump, { "aria-label": fmt(T.jumpTo, f.quote.slice(0, 60)), "data-trf-jump": "" }, () => jump(f)));
      if (canResolve && isPending) {
         acts.append(btn(T.editKeep, { "data-trf-keep": "" }, () => {
            pending.delete(f.id);
            render();
         }));
      } else if (canResolve) {
         if (f.quran) {
            const a = el("a", { class: "btn sm primary", href: f.quranUrl ?? "https://quran.com", target: "_blank", rel: "noopener", "data-trf-official": "" }, T.officialText);
            acts.append(a);
         }
         if (f.suggestion && r) acts.append(btn(T.apply, { "data-trf-apply": "" }, () => apply(f, f.suggestion!, "applied"), "btn sm primary"));
         if (ai && !f.quran && r) acts.append(btn(T.retranslate, { "data-trf-retranslate": "" }, () => void alternatives(f)));
         if (GLOSSARY_REASONS.includes(f.reason) && f.suggestion) acts.append(btn(T.addGlossary, { "data-trf-glossary": "" }, () => void glossary(f)));
         acts.append(btn(T.resolve, { "data-trf-resolve": "" }, () => void act(f, "resolve", { resolution: "fixed" }, T.resolved), "btn ghost sm"));
         acts.append(btn(T.dismiss, { "data-trf-dismiss": "" }, () => void act(f, "dismiss", {}, T.dismissed), "btn ghost sm"));
      }
      li.append(acts);
      if (f.quran && canResolve && !isPending) li.append(el("p", { class: "help", style: "margin:0" }, T.officialHelp));
      if (f.id === current) li.setAttribute("data-current", "");
      return li;
   }

   function historyItem(f: Flag): HTMLLIElement {
      const what = f.status === "dismissed" ? T.statuses.dismissed : (T.resolutions[f.resolution ?? ""] ?? T.statuses.resolved);
      const li = el(
         "li",
         { "data-trf-flag": f.id },
         el("p", { class: "trf-h", style: "margin:0" }, el("strong", {}, fieldLabel(f.field)), el("span", { class: `badge ${f.status === "resolved" ? "published" : "draft"}` }, T.statuses[f.status]), el("span", { class: "badge loc" }, T.reasons[f.reason] ?? f.reason)),
         quoteEl(f.quote, locale),
         el("p", { class: "help", style: "margin:0" }, fmt(T.resolvedBy, what, f.resolvedBy ?? "—"), " · ", f.resolvedAt ? time(f.resolvedAt) : ""),
      );
      if (canResolve) li.append(el("div", { class: "trf-acts" }, btn(T.reopen, { "data-trf-reopen": "" }, () => void act(f, "reopen", {}, T.reopened), "btn ghost sm")));
      return li;
   }

   function render() {
      const open = flags.filter((f) => f.status === "open").sort((a, b) => fieldOrder(a.field) - fieldOrder(b.field) || a.start - b.start);
      const done = flags.filter((f) => f.status !== "open");
      list!.replaceChildren(...open.map(openItem));
      historyList!.replaceChildren(...done.map(historyItem));
      $("[data-trf-none]", card!)!.hidden = open.length > 0;
      $("[data-trf-history-none]", card!)!.hidden = done.length > 0;
      const count = $("[data-trf-count]", card!);
      if (count) {
         count.hidden = open.length === 0;
         count.textContent = fmt(T.openCount, open.length);
      }
      paintAll();
   }

   function jump(f: Flag) {
      const field = fieldEl(f.field);
      const r = where(f);
      if (!field || !r) return;
      current = f.id;
      render();
      // A card slide may be in a collapsed panel; the field must be visible to be focused.
      field.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
      field.focus();
      field.setSelectionRange(r.start, r.end);
      if (field instanceof HTMLTextAreaElement) {
         const caret = paint(field, r.start);
         if (caret) {
            const top = caret.offsetTop - field.clientHeight / 3;
            field.scrollTop = Math.max(0, top);
         }
         paint(field);
      }
   }

   /** Replaces the flagged span in the field; the flag resolves when the post is saved. */
   function apply(f: Flag, text: string, resolution: "applied" | "retranslated") {
      const field = fieldEl(f.field);
      const r = where(f);
      if (!field || !r) return;
      field.focus();
      field.setRangeText(text, r.start, r.end, "select");
      pending.set(f.id, { resolution, text });
      field.dispatchEvent(new Event("input", { bubbles: true }));
      render();
      toast(T.pendingApplied);
      announce(T.pendingApplied);
   }

   async function act(f: Flag, action: "resolve" | "dismiss" | "reopen", body: Record<string, unknown>, done: string) {
      try {
         const res = await api<{ flag: Flag }>("POST", `/admin/api/translation-flags/${encodeURIComponent(f.id)}/${action}`, body);
         flags = flags.map((x) => (x.id === f.id ? res.flag : x));
         pending.delete(f.id);
         if (current === f.id) current = null;
         render();
         toast(done);
         announce(done);
         (list!.querySelector<HTMLButtonElement>("button") ?? $<HTMLElement>("#trf-h"))?.focus();
      } catch {
         toast(T.failed, "bad");
      }
   }

   // ---- re-translate selection ----

   const altDlg = $<HTMLDialogElement>("#trf-alt-dlg");
   async function alternatives(f: Flag) {
      const field = fieldEl(f.field);
      if (!altDlg || !field) return;
      const status = $("[data-trf-alt-status]", altDlg)!;
      const box = $<HTMLFieldSetElement>("[data-trf-alts]", altDlg)!;
      const use = $<HTMLButtonElement>("[data-trf-alt-use]", altDlg)!;
      $("[data-trf-alt-quote]", altDlg)!.textContent = f.quote;
      for (const old of $$("label", box)) old.remove();
      box.hidden = true;
      use.disabled = true;
      status.classList.remove("err");
      status.replaceChildren(el("span", { class: "ai-spin", "aria-hidden": "true" }), T.altWorking);
      const answer = ask(altDlg);
      try {
         const res = await api<{ alternatives: string[] }>("POST", `/admin/api/translation-flags/${encodeURIComponent(f.id)}/alternatives`, { text: field.value });
         if (!res.alternatives.length) throw new Error("none");
         res.alternatives.forEach((text, i) => {
            const input = el("input", { type: "radio", name: "trf-alt", value: String(i) });
            if (i === 0) input.checked = true;
            box.append(el("label", { class: "check" }, input, el("span", { lang: locale, dir: "auto" }, text)));
         });
         box.hidden = false;
         use.disabled = false;
         status.textContent = "";
         $<HTMLInputElement>('input[name="trf-alt"]', box)?.focus();
         if ((await answer) !== "ok") return;
         const i = Number($<HTMLInputElement>('input[name="trf-alt"]:checked', box)?.value ?? 0);
         apply(f, res.alternatives[i], "retranslated");
      } catch (e) {
         const code = e instanceof ApiError ? String((e.body as { error?: string } | null)?.error ?? "") : "";
         status.textContent = T.errors[code] ?? (e instanceof ApiError ? T.failed : T.altNone);
         status.classList.add("err");
      }
   }

   // ---- add to glossary ----

   const glDlg = $<HTMLDialogElement>("#trf-gloss-dlg");
   async function glossary(f: Flag) {
      if (!glDlg) return;
      const src = $<HTMLInputElement>("#trf-gloss-src", glDlg)!;
      const tgt = $<HTMLInputElement>("#trf-gloss-tgt", glDlg)!;
      const err = $("[data-trf-gloss-err]", glDlg)!;
      // A short source (a title, a term) is the term itself; a sentence is for the editor to cut down.
      src.value = f.sourceText && f.sourceText.length <= 60 ? f.sourceText : "";
      tgt.value = f.suggestion ?? "";
      err.hidden = true;
      const form = glDlg.querySelector("form")!;
      const onSubmit = (e: SubmitEvent) => {
         if ((e.submitter as HTMLButtonElement | null)?.value !== "ok") return;
         for (const i of [src, tgt]) i.toggleAttribute("aria-invalid", !i.value.trim());
         if (src.value.trim() && tgt.value.trim()) return;
         e.preventDefault();
         (src.value.trim() ? tgt : src).focus();
      };
      form.addEventListener("submit", onSubmit);
      const answer = ask(glDlg);
      (src.value ? tgt : src).focus();
      const ok = (await answer) === "ok";
      form.removeEventListener("submit", onSubmit);
      if (!ok) return;
      try {
         await api("POST", `/admin/api/translation-flags/${encodeURIComponent(f.id)}/glossary`, { sourceTerm: src.value, targetTerm: tgt.value });
         toast(T.glossAdded);
         announce(T.glossAdded);
         await load();
      } catch (e) {
         toast(e instanceof ApiError && e.status === 409 ? T.glossExists : T.failed, "bad");
      }
   }

   // ---- an edit of flagged words: ask (in-app) whether it resolves the flag ----

   const editDlg = $<HTMLDialogElement>("#trf-edit-dlg");
   const seen = new Map<string, boolean>();
   form.addEventListener("focusin", (e) => {
      const key = fieldKey(e.target as Element);
      if (!key) return;
      for (const f of flags) if (f.status === "open" && f.field === key) seen.set(f.id, !!where(f));
   });
   form.addEventListener("input", (e) => {
      if (fieldKey(e.target as Element)) requestAnimationFrame(() => paint(e.target as Field));
   });
   form.addEventListener("change", async (e) => {
      const key = fieldKey(e.target as Element);
      if (!key || !canResolve || !editDlg) return;
      const gone = flags.filter((f) => f.status === "open" && f.field === key && !pending.has(f.id) && !declined.has(f.id) && seen.get(f.id) && !where(f));
      if (!gone.length) return;
      $("[data-trf-edit-list]", editDlg)!.replaceChildren(...gone.map((f) => el("li", {}, f.quote)));
      const answer = await ask(editDlg);
      for (const f of gone) {
         if (answer === "resolve") pending.set(f.id, { resolution: "edited", text: null });
         else declined.add(f.id);
         seen.set(f.id, false);
      }
      render();
   });
   form.addEventListener("seq:change", () => requestAnimationFrame(render));
   addEventListener("resize", () => {
      if (!pop.hidden && selection) showPop(selection.field);
   });

   addSaveHook(async () => {
      for (const [fid, p] of pending) {
         try {
            await api("POST", `/admin/api/translation-flags/${encodeURIComponent(fid)}/resolve`, { resolution: p.resolution, text: p.text });
         } catch {
            toast(T.failed, "bad");
         }
      }
      pending.clear();
   });

   paintAll();

   async function load() {
      try {
         const res = await api<{ flags: Flag[] }>("GET", `/admin/api/translation-flags?${new URLSearchParams({ kind, id })}`);
         flags = res.flags;
         render();
      } catch {
         toast(T.failed, "bad");
      }
   }
   void load();
}
