/**
 * The page builder (wiki AUN-CMS-PAGE-BUILDER): the blocks editor opened as a full-screen workspace
 * with a live preview beside it. The preview is the sites' own renderer (`renderPageBlocks`, vendored
 * from the monorepo) and stylesheet (page-blocks.css) inside a sandboxed same-origin frame, fed from
 * the editor's DOM on every change: what the editor sees is what www and the videos site render.
 *
 * Toggles change only the preview: device (desktop scaled to fit / phone at 390px), language (this
 * page live, or the other language's saved version), light/dark and the theme. The site's theme is
 * never changed from here.
 */
import { leadsWithHero, normalizePageBlocks as normalizeBlocks, renderPageBlocks, servePageBlocks, type MediaRef, type PageBlock, type PostSummaryLite, type ServeRefs, type VideoSnapshot } from "../../lib/page-blocks.generated.ts";
import { qafQuoteSpans, QAF_QUOTE_OPEN, readerUrl } from "../../lib/qaf/model.ts";
import { announce, applyWhen, fmt, listItems, readItem, refresh, reuid, unfold } from "./blocks.ts";
import { askConfirm } from "./dialogs.ts";
import { $, $$, api, el, toast } from "./dom.ts";

type Locale = "en" | "ar";
type Dict = Record<string, string>;
interface Strings {
   blocks: Dict & { langNames: Dict };
}

interface Snapshot {
   locale: Locale;
   title: string;
   summary: string;
   blocks: PageBlock[];
   media: Record<string, { url: string; alt: string; width: number | null; height: number | null }>;
   videos: Record<string, { title: string; thumbnail_url: string | null; channel_name: string | null }>;
   posts: Record<string, { title: string; locale: string; status: string }>;
   html: string;
}

/** Keep literal Qaf text out of the regular Markdown renderer. The preview restores text nodes afterwards. */
function markQafQuotes(text: string, quotes: Map<string, HTMLElement>): string {
   let start = 0;
   let masked = "";
   for (const { start: quoteStart, end } of qafQuoteSpans(text)) {
      const raw = text.slice(quoteStart, end);
      const newline = raw.indexOf("\n");
      const fence = QAF_QUOTE_OPEN.exec(newline === -1 ? raw : raw.slice(0, newline))?.[1] ?? "";
      const close = "\n" + fence;
      const quote = el("blockquote", { class: "pb-qaf-quote", lang: "ar", dir: "rtl" });
      quote.textContent = newline === -1 ? "" : raw.slice(newline + 1, raw.endsWith(close) ? -close.length : undefined);
      const marker = `QAFQUOTE-${crypto.randomUUID()}`;
      quotes.set(marker, quote);
      masked += text.slice(start, quoteStart) + `\n\n${marker}\n\n`;
      start = end;
   }
   return masked + text.slice(start);
}

const DESKTOP = 1280;
const PHONE = 390;
/** The width at which the workspace stacks the preview under the list (builder-styles.ts): phone-sized. */
const NARROW = "(max-width: 1000px)";

export function initPageBuilder(root: HTMLElement, T: Strings): void {
   const tb = T.blocks;
   const list = $<HTMLElement>("ol[data-k=blocks]", root)!;
   const frame = $<HTMLIFrameElement>("[data-pv-frame]", root)!;
   const box = $<HTMLElement>("[data-pv-frame-box]", root)!;
   const stage = $<HTMLElement>("[data-pv-stage]", root)!;
   const note = $<HTMLElement>("[data-pv-note]", root)!;
   const openBtn = $<HTMLButtonElement>("[data-builder-open]", root)!;
   const themes = JSON.parse(root.dataset.pvThemes ?? "{}") as Record<string, string>;
   const locale = (root.dataset.locale === "ar" ? "ar" : "en") as Locale;
   const otherLocale = (root.dataset.otherLocale === "ar" ? "ar" : "en") as Locale;
   const otherId = root.dataset.otherId ? Number(root.dataset.otherId) : null;
   const form = root.closest("form");

   const state = {
      open: false,
      device: "desktop" as "desktop" | "phone",
      lang: locale,
      dark: $<HTMLButtonElement>("[data-pv-mode=dark]", root)?.getAttribute("aria-pressed") === "true",
      theme: $<HTMLSelectElement>("[data-pv-theme]", root)?.value ?? Object.keys(themes)[0],
      selected: "",
   };
   let other: Snapshot | null | "loading" | "failed" = null;
   const postCache = new Map<string, PostSummaryLite[] | "loading">();

   /* ── The frame ─────────────────────────────────────────────────────────────────────────── */

   let ready: Promise<Document> | null = null;
   const doc = (): Promise<Document> => {
      ready ??= new Promise((resolve) => {
         frame.addEventListener(
            "load",
            () => {
               const d = frame.contentDocument!;
               wireFrame(d);
               resolve(d);
            },
            { once: true },
         );
         // Only our own asset URLs go in; every block's text is escaped by the renderer.
         const q = (s: string) => s.replace(/"/g, "&quot;");
         const text = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
         // Titled like the frame (its accessible name), so the preview document has a title of its own too
         frame.srcdoc = `<!doctype html><html lang="${locale}" dir="${locale === "ar" ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${text(frame.title)}</title><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" data-pv-theme-css href="${q(themes[state.theme] ?? "")}"><link rel="stylesheet" href="${q(root.dataset.pvCss ?? "")}"></head><body><main data-pv-main></main></body></html>`;
      });
      return ready;
   };

   function wireFrame(d: Document): void {
      // Click a section: its block opens in the editor. Links and buttons in the preview go nowhere.
      d.addEventListener("click", (e) => {
         const target = e.target as Element;
         if (!target.closest("summary")) e.preventDefault();
         const sec = target.closest<HTMLElement>("[data-block]");
         if (!sec || state.lang !== locale) return;
         const li = itemById(sec.dataset.block!);
         if (!li) return;
         select(li.querySelector<HTMLInputElement>(":scope > input[data-k=id]")!.value, false);
         unfold(li);
         li.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
         li.classList.add("blk-flash");
         setTimeout(() => li.classList.remove("blk-flash"), 1200);
         $<HTMLElement>(".blk-b input:not([type=hidden]):not([type=radio]), .blk-b textarea", li)?.focus({ preventScroll: true });
      });
      d.addEventListener("submit", (e) => e.preventDefault());
   }

   const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
   const itemById = (id: string) => listItems(list).find((li) => li.querySelector<HTMLInputElement>(":scope > input[data-k=id]")?.value === id) as HTMLElement | undefined;

   function select(id: string, scroll: boolean): void {
      state.selected = id;
      for (const li of listItems(list)) li.classList.toggle("blk-sel", li.querySelector<HTMLInputElement>(":scope > input[data-k=id]")?.value === id);
      const d = frame.contentDocument;
      if (!d) return;
      let hit: HTMLElement | null = null;
      for (const sec of d.querySelectorAll<HTMLElement>("[data-block]")) {
         const on = sec.dataset.block === id;
         sec.toggleAttribute("data-pv-selected", on);
         if (on) hit = sec;
      }
      if (scroll && hit) {
         const r = hit.getBoundingClientRect();
         const h = d.defaultView?.innerHeight ?? 0;
         if (r.top < 0 || r.top > h * 0.7) hit.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
      }
   }

   /* ── Editor DOM → served blocks ───────────────────────────────────────────────────────────── */

   /** What the editor knows about its images and videos (the thumbnails it shows). */
   function domRefs(): Pick<ServeRefs, "media" | "snapshot"> & { postTitles: Map<number, string> } {
      const media = new Map<number, MediaRef>();
      for (const slot of $$<HTMLElement>("[data-image-slot]", list)) {
         const id = Number($<HTMLInputElement>("input[data-k=media_id]", slot)?.value || 0);
         const img = $<HTMLImageElement>("[data-image-img]", slot);
         if (!id || !img) continue;
         const n = (v: string | null) => (v && Number(v) > 0 ? Number(v) : null);
         media.set(id, { url: img.src, alt: null, width: n(img.getAttribute("width")) ?? (img.naturalWidth || null), height: n(img.getAttribute("height")) ?? (img.naturalHeight || null) });
      }
      const videos = new Map<string, VideoSnapshot>();
      for (const ref of $$<HTMLInputElement>("input[data-k=ref_id]", list)) {
         const scope = ref.closest<HTMLElement>("[data-video-slot], li.sub");
         const kind = scope?.querySelector<HTMLInputElement>("input[data-k=kind]")?.value ?? "video";
         if (!ref.value || !scope) continue;
         const thumb = scope.querySelector<HTMLImageElement>("img[data-video-thumb]");
         const title = scope.querySelector("[data-video-title]")?.firstChild?.textContent?.replace(/ · $/, "").trim() ?? ref.value;
         videos.set(`${kind}:${ref.value}`, { title, thumbnail_url: thumb?.src ?? null, channel_name: null });
      }
      const postTitles = new Map<number, string>();
      for (const li of $$<HTMLElement>("ol[data-k=post_ids] > li", list)) {
         const id = Number($<HTMLInputElement>("input[data-k=v]", li)?.value || 0);
         if (id) postTitles.set(id, $("[data-post-title]", li)?.textContent ?? "");
      }
      return { media: (id) => media.get(id) ?? null, snapshot: (k, r) => videos.get(`${k}:${r}`) ?? null, postTitles };
   }

   /** The editor's blocks; a block that doesn't validate yet is left out of the preview only. */
   function editorBlocks(): PageBlock[] {
      const out: PageBlock[] = [];
      for (const li of listItems(list)) {
         try {
            out.push(...normalizeBlocks([readItem(li)]));
         } catch {
            /* shown on save */
         }
      }
      return out;
   }

   /** A posts block's current list (the public API's own query, through the admin), cached per settings. */
   function postsOf(b: Extract<PageBlock, { type: "posts" }>, lang: Locale, titles: Map<number, string>): PostSummaryLite[] {
      const key = `${lang}|${b.mode}|${b.limit}|${b.tag}|${b.post_ids.join(",")}`;
      const hit = postCache.get(key);
      if (Array.isArray(hit)) return hit;
      if (!hit) {
         postCache.set(key, "loading");
         api<{ data: PostSummaryLite[] }>("POST", "/admin/api/page-preview/posts", { block: b, locale: lang })
            .then((r) => {
               postCache.set(key, r.data);
               schedule();
            })
            .catch(() => postCache.delete(key));
      }
      // Until it answers: picked posts by their titles, so the section doesn't jump in from nothing.
      return b.mode === "picked" ? b.post_ids.map((id) => ({ slug: String(id), locale: lang, title: titles.get(id) ?? "", excerpt: null, cover: null, published_at: "" })).filter((p) => p.title) : [];
   }

   function snapshotRefs(s: Snapshot): Pick<ServeRefs, "media" | "snapshot"> {
      return {
         media: (id) => {
            const m = s.media[String(id)];
            return m ? { url: m.url, alt: m.alt || null, width: m.width, height: m.height } : null;
         },
         snapshot: (k, r) => s.videos[`${k}:${r}`] ?? null,
      };
   }

   /* ── Render ───────────────────────────────────────────────────────────────────────────────── */

   async function render(): Promise<void> {
      if (!state.open) return;
      const d = await doc();
      const html = d.documentElement;
      html.classList.toggle("dark", state.dark);
      html.lang = state.lang;
      html.dir = state.lang === "ar" ? "rtl" : "ltr";
      const link = d.querySelector<HTMLLinkElement>("[data-pv-theme-css]")!;
      const themeHref = themes[state.theme] ?? "";
      if (link.getAttribute("href") !== themeHref) link.setAttribute("href", themeHref);

      let blocks: PageBlock[];
      let refs: ServeRefs;
      let title: string;
      let summary: string;
      note.textContent = "";
      if (state.lang === locale) {
         blocks = editorBlocks();
         const dom = domRefs();
         refs = { ...dom, posts: (b) => postsOf(b, locale, dom.postTitles) };
         title = ($<HTMLInputElement>("#f-title")?.value ?? root.dataset.pageTitle ?? "").trim();
         summary = (($<HTMLTextAreaElement | HTMLInputElement>("[name=summary]")?.value ?? root.dataset.pageSummary) || "").trim();
      } else {
         const name = tb.langNames[state.lang] ?? state.lang;
         if (!otherId) note.textContent = fmt(tb.noTranslation, name);
         else if (other === null || other === "loading") void loadOther();
         else if (other === "failed") note.textContent = tb.translationFailed;
         else note.textContent = `${name} · ${tb.savedVersion}`;
         const snap = other && typeof other === "object" ? other : null;
         blocks = snap ? snap.blocks : [];
         const titles = new Map(Object.entries(snap?.posts ?? {}).map(([k, v]) => [Number(k), v.title]));
         refs = { ...(snap ? snapshotRefs(snap) : { media: () => null, snapshot: () => null }), posts: (b) => postsOf(b, state.lang, titles) };
         title = snap?.title ?? "";
         summary = snap?.summary ?? "";
      }
      // The preview is a document of its own: it names the page for assistive technology (axe document-title).
      d.title = title || tb.preview;
      const quotes = new Map<string, HTMLElement>();
      const served = servePageBlocks(blocks, refs).map((block) => block.type === "markdown"
         ? { ...block, text: markQafQuotes(block.text, quotes) } : block);
      const lang = state.lang;
      const body = renderPageBlocks(served, {
         locale: lang,
         pageTitle: title,
         // Links show where they go on hover only; the preview never navigates.
         watchHref: (kind, id) => `#${kind}-${id}`,
         postHref: (p) => `#post-${p.slug}`,
      });
      const main = d.querySelector<HTMLElement>("[data-pv-main]")!;
      const scroll = d.scrollingElement?.scrollTop ?? 0;
      const head = leadsWithHero(served) || !title ? "" : `<header class="pv-head"><h1>${escapeHtml(title)}</h1>${summary ? `<p>${escapeHtml(summary)}</p>` : ""}</header>`;
      main.innerHTML = served.length || head ? `${head}${body}<div class="pv-foot"></div>` : `<p class="pv-empty">${escapeHtml(tb.previewEmpty)}</p>`;
      if (quotes.size) {
         for (const paragraph of $$("p", main)) {
            const quote = quotes.get(paragraph.textContent ?? "");
            if (quote) paragraph.replaceWith(quote);
         }
         for (const link of $$<HTMLAnchorElement>("a[href]", main)) {
            if (readerUrl(link.href, "qaf") || readerUrl(link.href, "turath")) link.rel = "noopener noreferrer nofollow";
         }
      }
      if (d.scrollingElement) d.scrollingElement.scrollTop = scroll;
      if (state.selected) select(state.selected, false);
   }

   const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

   let timer: ReturnType<typeof setTimeout> | undefined;
   function schedule(): void {
      clearTimeout(timer);
      timer = setTimeout(() => void render(), 120);
   }

   async function loadOther(): Promise<void> {
      if (!otherId || other === "loading") return;
      other = "loading";
      try {
         const r = await api<{ data: Snapshot }>("GET", `/pages/${otherId}/blocks-fragment?locale=${otherLocale}`);
         other = r.data;
      } catch {
         other = "failed";
      }
      schedule();
   }

   /* ── Fit: desktop scaled into the stage, phone at its real width ─────────────────────────── */

   function fit(): void {
      const cs = getComputedStyle(stage);
      const px = (v: string) => Number.parseFloat(v) || 0;
      const w = stage.clientWidth - px(cs.paddingInlineStart) - px(cs.paddingInlineEnd);
      const h = stage.clientHeight - px(cs.paddingBlockStart) - px(cs.paddingBlockEnd) - (state.device === "phone" ? 20 : 0);
      if (w <= 0 || h <= 0) return;
      const target = state.device === "phone" ? PHONE : DESKTOP;
      const scale = Math.min(1, w / target);
      box.dataset.device = state.device;
      frame.style.width = `${target}px`;
      frame.style.height = `${Math.max(320, Math.floor(h / scale))}px`;
      frame.style.transform = scale < 1 ? `scale(${scale})` : "";
      box.style.width = `${Math.floor(target * scale)}px`;
      box.style.height = `${Math.floor(h)}px`;
   }
   new ResizeObserver(() => state.open && fit()).observe(stage);

   /* ── Open / close ─────────────────────────────────────────────────────────────────────────── */

   // On a phone-sized screen the preview opens on Phone: a desktop page scaled into a phone's width is
   // too small to read. Once the editor picks a device, that choice stays.
   let deviceChosen = false;
   function setOpen(open: boolean): void {
      state.open = open;
      if (open && !deviceChosen && window.matchMedia(NARROW).matches && state.device !== "phone") {
         state.device = "phone";
         for (const b of $$<HTMLButtonElement>("[data-pv-device]", root)) b.setAttribute("aria-pressed", String(b.dataset.pvDevice === "phone"));
      }
      root.classList.toggle("bld-open", open);
      document.documentElement.classList.toggle("bld-lock", open);
      openBtn.setAttribute("aria-expanded", String(open));
      if (open) {
         // The Save button says what the form's main button does (Save draft / Publish / Update).
         const main = form?.querySelector<HTMLButtonElement>("button.primary[type=submit][data-action]");
         const label = $("[data-builder-save-label]", root);
         if (main && label) label.textContent = main.textContent?.trim() ?? label.textContent;
         fit();
         void render();
         $<HTMLElement>(".bld-bar button", root)?.focus();
      } else {
         openBtn.focus();
      }
   }

   openBtn.addEventListener("click", () => setOpen(true));
   $("[data-builder-close]", root)?.addEventListener("click", () => setOpen(false));
   document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !state.open || document.querySelector("dialog[open]")) return;
      if ((e.target as HTMLElement).closest(".seq-dragging")) return;
      e.preventDefault();
      setOpen(false);
   });
   $("[data-builder-save]", root)?.addEventListener("click", () => {
      form?.querySelector<HTMLButtonElement>("button.primary[type=submit][data-action]")?.click();
   });

   /* ── Toolbar ──────────────────────────────────────────────────────────────────────────────── */

   const pressGroup = (attr: string, value: string) => $$<HTMLButtonElement>(`[${attr}]`, root).forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute(attr) === value)));
   for (const b of $$<HTMLButtonElement>("[data-pv-device]", root))
      b.addEventListener("click", () => {
         state.device = b.dataset.pvDevice === "phone" ? "phone" : "desktop";
         deviceChosen = true;
         pressGroup("data-pv-device", state.device);
         fit();
      });
   for (const b of $$<HTMLButtonElement>("[data-pv-lang]", root))
      b.addEventListener("click", () => {
         state.lang = b.dataset.pvLang === "ar" ? "ar" : "en";
         pressGroup("data-pv-lang", state.lang);
         void render();
      });
   for (const b of $$<HTMLButtonElement>("[data-pv-mode]", root))
      b.addEventListener("click", () => {
         state.dark = b.dataset.pvMode === "dark";
         pressGroup("data-pv-mode", b.dataset.pvMode!);
         void render();
      });
   $<HTMLSelectElement>("[data-pv-theme]", root)?.addEventListener("change", (e) => {
      state.theme = (e.target as HTMLSelectElement).value;
      void render();
   });

   /* ── Live updates and selection ───────────────────────────────────────────────────────────── */

   root.addEventListener("input", schedule);
   root.addEventListener("change", schedule);
   form?.addEventListener("seq:change", schedule);
   root.addEventListener("blk:added", schedule);
   $("#f-title")?.addEventListener("input", schedule);
   root.addEventListener("focusin", (e) => {
      const li = (e.target as HTMLElement).closest<HTMLElement>("ol[data-k=blocks] > li[data-seq-item]");
      const id = li?.querySelector<HTMLInputElement>(":scope > input[data-k=id]")?.value;
      if (id && id !== state.selected && state.lang === locale) select(id, true);
   });
   // Media and video choices replace nodes without an input event.
   new MutationObserver(() => schedule()).observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ["src", "value"] });

   /* ── Copy from the other language ─────────────────────────────────────────────────────────── */

   $<HTMLButtonElement>("[data-copy-from]", root)?.addEventListener("click", async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      if (!otherId) return;
      const name = tb.langNames[otherLocale] ?? otherLocale;
      if (listItems(list).length && !(await askConfirm({ title: fmt(tb.copyFrom, name), body: fmt(tb.copyConfirm, name), ok: fmt(tb.copyFrom, name), noIcon: true }))) return btn.focus();
      let html: string;
      try {
         // Rendered for THIS page's language (spell check, direction), with the other page's content.
         const r = await api<{ data: Snapshot }>("GET", `/pages/${otherId}/blocks-fragment?locale=${locale}`);
         html = r.data.html;
      } catch {
         toast(tb.copyFailed, "bad");
         return;
      }
      const before = [...list.children];
      const tpl = document.createElement("template");
      tpl.innerHTML = html; // our own server-rendered editor markup; text inside is escaped by JSX
      const items = [...tpl.content.children] as HTMLElement[];
      for (const li of items) reuid(li);
      list.replaceChildren(...items);
      for (const li of items) applyWhen(li);
      refresh(list);
      list.closest("form")?.dispatchEvent(new CustomEvent("seq:change", { bubbles: true }));
      announce(list, fmt(tb.copied, name));
      schedule();
      // Undo, in a toast with a real button (10 s).
      const host = document.getElementById("toasts");
      if (!host) return;
      const undo = el("button", { type: "button", class: "btn sm" }, tb.undo);
      const toastBox = el("div", { class: "toast ok", "data-undo": "" }, `${fmt(tb.copied, name)} `, undo);
      undo.addEventListener("click", () => {
         list.replaceChildren(...before);
         refresh(list);
         list.closest("form")?.dispatchEvent(new CustomEvent("seq:change", { bubbles: true }));
         toastBox.remove();
         schedule();
         btn.focus();
      });
      host.append(toastBox);
      setTimeout(() => toastBox.remove(), 10_000);
   });

}
