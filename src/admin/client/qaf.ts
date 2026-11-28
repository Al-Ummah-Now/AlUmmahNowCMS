import type { ADMIN_STRINGS } from "../i18n.ts";
import { MAX_BLOCKS } from "../../lib/blocks.ts";
import { fill, formatDateTime, pickPlural } from "../../lib/format.ts";
import { citation, citedQuotation, pageDigits, readerUrl, withoutQafQuotes, type Candidate, type CatalogType, type ContextPassage, type Passage, type QafLocale } from "../../lib/qaf/model.ts";
import { runJob } from "./ai.ts";
import { aiErrorText, type AiErrorStrings } from "./ai-errors.ts";
import { appendFromTemplate } from "./blocks.ts";
import { askConfirm } from "./dialogs.ts";
import { $, $$, api, ApiError, el, strings, toast } from "./dom.ts";

type QafStrings = typeof ADMIN_STRINGS.en.qaf;
const endpoint = "/admin/api/ai/qaf";
const locale = (): QafLocale => document.documentElement.lang === "ar" ? "ar" : "en";

function errorText(t: QafStrings, e: unknown): string {
   const body = e instanceof ApiError ? e.body as { error?: string; retryAfter?: number } : null;
   const code = body?.error;
   const wait = body?.retryAfter;
   const text = code && Object.hasOwn(t.errors, code) ? t.errors[code as keyof QafStrings["errors"]] : t.errors.unavailable;
   if (code === "minute") {
      const lang = locale();
      const duration = pickPlural(t.retrySeconds, wait ?? 60, lang);
      return `${text} ${fill(t.retryIn, { duration }, lang)}`;
   }
   if (code === "week" && wait) return `${text} ${t.retryAt.replace("{time}", formatDateTime(Date.now() + wait * 1000, locale()))}`;
   return text;
}

export function initQafSettings(): void {
   const settings = $<HTMLFormElement>("[data-qaf-settings]");
   const failure = $("[data-qaf-failure]");
   if (!settings && !failure) return;
   const t = strings<{ qaf: QafStrings }>(settings ? "i18n" : "i18n-qaf-error").qaf;
   async function update(key: string | null, target: HTMLFormElement) {
      const buttons = $$<HTMLButtonElement>("button", target);
      const status = $("[data-qaf-settings-error]", target)!;
      status.textContent = "";
      buttons.forEach((button) => button.disabled = true);
      try {
         await api("PUT", `${endpoint}/settings`, { key });
         location.reload();
      } catch (e) {
         status.textContent = errorText(t, e);
         buttons.forEach((button) => button.disabled = false);
      }
   }
   if (settings) {
      const input = $<HTMLInputElement>("#qaf-key", settings)!;
      settings.addEventListener("submit", (e) => {
         e.preventDefault();
         const key = input.value;
         input.value = "";
         void update(key, settings);
      });
      $("[data-qaf-remove]", settings)?.addEventListener("click", async () => {
         if (await askConfirm({ title: t.removeTitle, body: t.removeBody, ok: t.removeKey })) await update(null, settings);
      });
   }
   const retry = failure && $<HTMLButtonElement>("[data-qaf-retry]", failure);
   retry?.addEventListener("click", async () => {
      retry.disabled = true;
      try {
         await api("POST", `${endpoint}/settings/retry`);
         location.reload();
      } catch (e) {
         $("[data-qaf-settings-error]", failure!)!.textContent = errorText(t, e);
         retry.disabled = false;
      }
   });
}

function excerpt(text: string): HTMLElement {
   return el("p", { class: "qaf-excerpt", lang: "ar", dir: "rtl" }, text);
}

function sourceLink(p: Passage, lang: QafLocale): HTMLElement {
   const text = el("bdi", { lang, dir: lang === "ar" ? "rtl" : "ltr" }, citation(p, lang));
   const href = readerUrl(p.url, "qaf");
   return href ? el("a", { href, target: "_blank", rel: "noopener noreferrer nofollow" }, text) : text;
}

function catalog(host: HTMLElement, t: QafStrings, lang: QafLocale) {
   const type = host.dataset.qafCatalog as CatalogType;
   const input = $<HTMLInputElement>("input", host)!;
   const choices = $<HTMLSelectElement>("select", host)!;
   const button = $<HTMLButtonElement>("button", host)!;
   const status = $("p", host)!;
   const lookup = async () => {
      const query = input.value.trim();
      if (!query || button.disabled) return input.focus();
      button.disabled = true;
      status.textContent = t.searching;
      try {
         const { candidates } = await api<{ candidates: Candidate[] }>("GET", `${endpoint}/catalog?${new URLSearchParams({ type, query, locale: lang })}`);
         if (input.value.trim() !== query) return;
         const options = candidates.map((candidate) => {
            const year = candidate.deathInexactLabel || (candidate.deathYearAH == null ? "" : pageDigits(candidate.deathYearAH, lang));
            const label = [candidate.label, candidate.authorLabel, year].filter(Boolean).join(" · ");
            return el("option", { value: String(candidate.id) }, label);
         });
         choices.replaceChildren(el("option", { value: "" }, type === "author" ? t.anyAuthor : t.anyBook), ...options);
         choices.hidden = options.length === 0;
         status.textContent = options.length ? "" : t.noCandidates;
         if (!choices.hidden) choices.focus();
      } catch (e) {
         status.textContent = errorText(t, e);
      } finally {
         button.disabled = false;
      }
   };
   button.addEventListener("click", () => void lookup());
   input.addEventListener("input", () => {
      choices.replaceChildren();
      choices.hidden = true;
      status.textContent = "";
   });
   input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      void lookup();
   });
}

export function initQafEditor(): void {
   const editor = $<HTMLFormElement>("form[data-editor]");
   const dialog = $<HTMLDialogElement>("#qaf-dialog");
   if (!editor || !dialog) return;
   const lang = locale();
   const { qaf: t, qafAi } = strings<{ qaf: QafStrings; qafAi: AiErrorStrings }>();
   const query = $<HTMLInputElement>("#qaf-query", dialog)!;
   const clear = $<HTMLButtonElement>("[data-qaf-clear]", dialog)!;
   const syncClear = () => { clear.hidden = !query.value; };
   query.addEventListener("input", syncClear);
   clear.addEventListener("click", () => {
      query.value = "";
      syncClear();
      query.focus();
   });
   const message = $("[data-qaf-message]", dialog)!;
   const results = $("[data-qaf-results]", dialog)!;
   const search = $<HTMLFormElement>("[data-qaf-search]", dialog)!;
   const list = $("[data-seq-list=blocks]", editor);
   const body = $<HTMLTextAreaElement>("#f-body", editor);
   const isPage = editor.dataset.editor === "pages";
   const card = $("[data-qaf-card]", editor)!;
   const unavailablePanel = $(isPage ? "[data-page-panel='']" : "[data-kind-panel=article]", editor);
   if (unavailablePanel) {
      const sync = () => card.hidden = unavailablePanel.hidden;
      new MutationObserver(sync).observe(unavailablePanel, { attributes: true, attributeFilter: ["hidden"] });
      sync();
   }
   for (const host of $$("[data-qaf-catalog]", dialog)) catalog(host, t, lang);

   let lastField: HTMLInputElement | HTMLTextAreaElement | null = null;
   let insertionTarget: HTMLTextAreaElement | null = null;
   let offset: number | null = null;
   editor.addEventListener("focusin", (e) => {
      const field = e.target;
      if (field instanceof HTMLTextAreaElement || field instanceof HTMLInputElement && field.type === "text") lastField = field;
   });
   for (const button of $$("[data-qaf-open]", editor)) {
      button.addEventListener("click", () => {
         const selected = lastField?.isConnected && lastField.selectionStart != null && lastField.selectionEnd != null
            ? withoutQafQuotes(lastField.value, lastField.selectionStart, lastField.selectionEnd).trim() : "";
         const target = lastField instanceof HTMLTextAreaElement && lastField.isConnected &&
            (lastField === body || lastField.matches("[data-block-type=markdown] textarea[data-k=text]"))
            ? lastField : null;
         insertionTarget = target ?? body;
         offset = target?.selectionEnd ?? null;
         if (selected) query.value = selected.slice(0, 2000);
         syncClear();
         dialog.showModal();
      });
   }

   function insert(passage: Passage, button: HTMLButtonElement) {
      const value = citedQuotation(passage, editor!.dataset.locale === "ar" ? "ar" : "en");
      if (!value) return;
      let target = insertionTarget?.isConnected ? insertionTarget : null;
      if (target) {
         const at = Math.min(offset ?? target.value.length, target.value.length);
         const text = `${at ? "\n\n" : ""}${value}${at < target.value.length ? "\n\n" : ""}`;
         if (target.maxLength >= 0 && target.value.length + text.length > target.maxLength) {
            toast(t.insertUnavailable, "bad");
            return;
         }
         target.setRangeText(text, at, at, "end");
      } else if (list && list.children.length < MAX_BLOCKS && value.length <= 20_000) {
         const added = appendFromTemplate(list, "block:markdown", (block) => {
            $<HTMLTextAreaElement>("textarea[data-k=text]", block)!.value = value;
         });
         target = added && $<HTMLTextAreaElement>("textarea[data-k=text]", added);
      }
      if (!target) return toast(t.insertUnavailable, "bad");
      button.disabled = true;
      dialog!.close();
      target.dispatchEvent(new Event("input", { bubbles: true }));
      if (target.closest("[data-blocks-editor]") && !target.getClientRects().length) $<HTMLButtonElement>("[data-builder-open]", editor!)?.click();
      target.focus();
      toast(t.inserted);
   }

   function resultCard(p: Passage) {
      const context = el("details", { class: "qaf-context" }, el("summary", {}, t.context));
      const contextContent = el("div", { class: "stack" });
      context.append(contextContent);
      let read = false;
      context.addEventListener("toggle", async () => {
         if (!context.open || read) return;
         read = true;
         contextContent.replaceChildren(el("p", { class: "help", role: "status" }, t.reading));
         try {
            const params = new URLSearchParams({ locale: lang, radius: "2" });
            const data = await api<ContextPassage>("GET", `${endpoint}/passages/${encodeURIComponent(p.id)}?${params}`);
            contextContent.replaceChildren(...[...data.before, data, ...data.after].map((passage) => {
               const article = el("section", { class: "qaf-neighbor" }, sourceLink(passage, lang), excerpt(passage.text));
               if (passage.footnotes) article.append(el("p", { class: "label" }, t.footnotes), excerpt(passage.footnotes));
               return article;
            }));
         } catch (e) {
            read = false;
            contextContent.replaceChildren(el("p", { class: "err", role: "status" }, errorText(t, e)));
         }
      });
      const btn = el("button", { class: "btn primary", type: "button" }, t.insert);
      btn.disabled = !readerUrl(p.url, "qaf");
      btn.addEventListener("click", () => insert(p, btn));
      const turath = readerUrl(p.turathUrl, "turath");
      const actions = el("div", { class: "ph-actions" }, btn);
      if (turath) actions.append(el("a", { class: "btn", href: turath, target: "_blank", rel: "noopener noreferrer nofollow" }, t.turath));
      return el("article", { class: "card stack qaf-result" }, sourceLink(p, lang), excerpt(p.text), actions, context);
   }

   const searchBtn = $<HTMLButtonElement>("button[type=submit]", search)!;
   const suggest = $<HTMLButtonElement>("[data-qaf-suggest]", search);
   const busy = (running: boolean) => {
      searchBtn.disabled = running;
      if (suggest) suggest.disabled = running;
   };
   search.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (searchBtn.disabled || !query.value.trim()) return;
      const value = (name: string) => $<HTMLInputElement | HTMLSelectElement>(`#qaf-${name}`, dialog)!.value;
      const filters: Record<string, unknown> = {};
      const [genre, author, book, min, max] = ["genre", "author-id", "book-id", "min", "max"].map(value);
      if (min && max && Number(min) > Number(max)) {
         message.textContent = t.errors.validation;
         return;
      }
      if (genre) filters.genres = [genre];
      if (author) filters.authorIds = [Number(author)];
      if (book) filters.bookIds = [book];
      if (min || max) filters.deathYearAH = { ...(min && { gte: Number(min) }), ...(max && { lte: Number(max) }) };
      busy(true);
      message.textContent = t.searching;
      results.replaceChildren();
      try {
         const data = await api<{ results: Passage[] }>("POST", `${endpoint}/search`, {
            query: query.value, locale: lang, limit: 10, ...(Object.keys(filters).length && { filters }),
         });
         results.replaceChildren(...data.results.map(resultCard));
         message.textContent = data.results.length ? t.review : t.noResults;
      } catch (err) {
         message.textContent = errorText(t, err);
      } finally {
         busy(false);
      }
   });

   suggest?.addEventListener("click", async () => {
      const selected = query.value.trim();
      if (!selected) return query.focus();
      busy(true);
      message.textContent = t.suggesting;
      try {
         const job = await runJob({
            feature: "source-query", kind: editor.dataset.editor, id: editor.dataset.id || null, locale: editor.dataset.locale,
            ui: lang, fields: { body: selected },
         });
         if (query.value.trim() === selected) query.value = (job.result as { query: string }).query;
         syncClear();
         message.textContent = "";
      } catch (e) {
         message.textContent = aiErrorText(qafAi, e);
      } finally {
         busy(false);
      }
   });
}
