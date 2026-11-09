/** Page/post editor: save, publish, slug rules, conflict check, markdown, tags, cover, translations, delete. */
import { $, $$, api, ApiError, toast, strings } from "./dom.ts";
import { renderMarkdown } from "./markdown.ts";
import { openPicker } from "./picker.ts";

interface S {
   slugBad: string;
   slugHome: string;
   slugTaken: string;
   required: string;
   saving: string;
   failed: string;
   conflict: string;
   linkPrompt: string;
   previewEmpty: string;
   videoLine: string;
   removeTag: string;
   coverTooBig: string;
   coverBadType: string;
   coverUploading: string;
}

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_BYTES = 10 * 1024 * 1024;

export function slugify(s: string): string {
   return s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "");
}

function fieldError(input: HTMLElement, errId: string, msg: string | null) {
   const err = document.getElementById(errId);
   if (err) {
      err.textContent = msg ?? "";
      err.hidden = !msg;
   }
   if (msg) input.setAttribute("aria-invalid", "true");
   else input.removeAttribute("aria-invalid");
}

export function initEditor(): void {
   const form = $<HTMLFormElement>("form[data-editor]");
   if (!form) return;
   const T = strings<S>();
   const kind = form.dataset.editor as "pages" | "posts";
   const id = form.dataset.id || "";
   const locale = form.dataset.locale as "en" | "ar";
   const title = $<HTMLInputElement>("#f-title", form)!;
   const slug = $<HTMLInputElement>("#f-slug", form)!;
   const body = $<HTMLTextAreaElement>("#f-body", form)!;
   let dirty = false;
   let slugTouched = !slug.dataset.autoSlug;
   const dirtyNote = $("[data-dirty]", form);
   const markDirty = () => {
      dirty = true;
      if (dirtyNote) dirtyNote.hidden = false;
   };
   form.addEventListener("input", markDirty);
   addEventListener("beforeunload", (e) => {
      if (dirty) e.preventDefault();
   });

   // Slug: derived from the title until edited by hand.
   slug.addEventListener("input", () => {
      slugTouched = true;
      updateSerp();
   });
   title.addEventListener("input", () => {
      if (!slugTouched) {
         const auto = slugify(title.value);
         if (auto) slug.value = auto;
      }
      updateSerp();
   });

   // Counters and the search preview.
   const counters = $$("[data-counter]", form);
   const serpTitle = $("[data-serp-title]");
   const serpDesc = $("[data-serp-desc]");
   const serpSlug = $("[data-serp-slug]");
   const summary = $<HTMLTextAreaElement>("#f-summary", form);
   const seoTitle = $<HTMLInputElement>("#f-seo-title", form);
   const seoDesc = $<HTMLTextAreaElement>("#f-seo-desc", form);
   function updateSerp() {
      for (const c of counters) {
         const input = document.getElementById(c.dataset.counter!) as HTMLInputElement | null;
         const n = input?.value.length ?? 0;
         const max = Number(c.dataset.max);
         c.textContent = `${n} / ${max}`;
         c.style.color = n > max ? "var(--fanous-c-form-error)" : "";
      }
      if (serpTitle) serpTitle.textContent = seoTitle?.value || title.value;
      if (serpDesc) serpDesc.textContent = seoDesc?.value || summary?.value || "";
      if (serpSlug) serpSlug.textContent = slug.value;
   }
   form.addEventListener("input", updateSerp);
   updateSerp();

   // Markdown toolbar, preview tabs, insert video.
   const preview = $("[data-md-preview]", form)!;
   for (const tab of $$<HTMLButtonElement>("[data-md-tab]", form)) {
      tab.addEventListener("click", () => {
         const show = tab.dataset.mdTab === "preview";
         for (const t of $$("[data-md-tab]", form)) {
            const on = t === tab;
            t.setAttribute("aria-selected", String(on));
            t.setAttribute("aria-pressed", String(on));
         }
         body.hidden = show;
         preview.hidden = !show;
         if (show) preview.innerHTML = body.value.trim() ? renderMarkdown(body.value, T.videoLine) : `<p class="muted">${T.previewEmpty}</p>`;
      });
   }
   const wrap = (before: string, after = before, placeholder = "") => {
      const { selectionStart: a, selectionEnd: b, value } = body;
      const sel = value.slice(a, b) || placeholder;
      body.setRangeText(before + sel + after, a, b, "end");
      body.focus();
      markDirty();
   };
   const linePrefix = (prefix: string) => {
      const { selectionStart: a, value } = body;
      const start = value.lastIndexOf("\n", a - 1) + 1;
      body.setRangeText(prefix, start, start, "end");
      body.focus();
      markDirty();
   };
   const insertLine = (line: string) => {
      const { selectionStart: a, value } = body;
      const before = value.slice(0, a);
      const pre = before === "" || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
      body.setRangeText(`${pre}${line}\n\n`, a, a, "end");
      body.focus();
      markDirty();
   };
   for (const b of $$<HTMLButtonElement>("[data-md]", form)) {
      b.addEventListener("click", () => {
         switch (b.dataset.md) {
            case "h2":
               return linePrefix("## ");
            case "bold":
               return wrap("**");
            case "italic":
               return wrap("*");
            case "quote":
               return linePrefix("> ");
            case "list":
               return linePrefix("- ");
            case "link": {
               const href = prompt(T.linkPrompt, "https://");
               if (href && (/^https:\/\//.test(href) || href.startsWith("/"))) wrap("[", `](${href})`, "link");
               return;
            }
            case "video":
               return openPicker((item) => insertLine(`::video[${item.id}]`), b);
         }
      });
   }

   // Tags (posts).
   const tagBox = $("[data-tags]", form);
   const tagInput = tagBox ? $<HTMLInputElement>("input", tagBox) : null;
   const tags = () => (tagBox ? $$("[data-tag]", tagBox).map((t) => t.dataset.tag!) : []);
   const addTag = (raw: string) => {
      const v = raw.trim().replace(/,+$/, "").slice(0, 40);
      if (!v || !tagBox || !tagInput || tags().includes(v) || tags().length >= 20) return;
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.dataset.tag = v;
      const label = document.createElement("span");
      label.dir = "auto";
      label.textContent = v;
      const x = document.createElement("button");
      x.type = "button";
      x.setAttribute("aria-label", `${T.removeTag}: ${v}`);
      x.dataset.removeTag = "";
      x.innerHTML = '<svg class="icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
      chip.append(label, x);
      tagBox.insertBefore(chip, tagInput);
      markDirty();
   };
   tagBox?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("[data-remove-tag]");
      if (btn) {
         btn.parentElement?.remove();
         markDirty();
         tagInput?.focus();
      } else tagInput?.focus();
   });
   tagInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === ",") {
         e.preventDefault();
         addTag(tagInput.value);
         tagInput.value = "";
      } else if (e.key === "Backspace" && !tagInput.value) {
         const all = $$("[data-tag]", tagBox!);
         all.at(-1)?.remove();
         markDirty();
      }
   });
   tagInput?.addEventListener("blur", () => {
      if (tagInput.value.trim()) {
         addTag(tagInput.value);
         tagInput.value = "";
      }
   });

   const val = (name: string) => {
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!el) return undefined;
      const v = el.value.trim();
      return v === "" ? null : v;
   };

   let submitting = false;
   form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (submitting) return;
      const action = ((ev as SubmitEvent).submitter as HTMLElement | null)?.dataset.action === "published" ? "published" : "draft";
      fieldError(title, "f-title-err", title.value.trim() ? null : T.required);
      const s = slug.value.trim();
      let slugErr: string | null = !s ? T.required : !SLUG.test(s) ? T.slugBad : kind === "pages" && s === "home" ? T.slugHome : null;
      fieldError(slug, "f-slug-err", slugErr);
      if (!title.value.trim() || slugErr) {
         (title.value.trim() ? slug : title).focus();
         return;
      }
      submitting = true;
      const buttons = $$<HTMLButtonElement>("button[type=submit]", form);
      buttons.forEach((b) => b.setAttribute("disabled", ""));
      try {
         const where = encodeURIComponent(JSON.stringify({ slug: s, locale }));
         const taken = await api<{ data: { id: number }[] }>("GET", `/api/data/entity/${kind}?where=${where}&select=id&limit=1`);
         if (taken.data.some((r) => String(r.id) !== id)) {
            slugErr = T.slugTaken;
            fieldError(slug, "f-slug-err", slugErr);
            slug.focus();
            return;
         }
         if (id) {
            const cur = await api<{ data: { updated_at: string | null; status: string } }>("GET", `/api/data/entity/${kind}/${id}`);
            if ((cur.data.updated_at ?? "") !== (form.dataset.updated ?? "")) {
               toast(T.conflict, "bad");
               return;
            }
         }
         const data: Record<string, unknown> = {
            title: title.value.trim(),
            slug: s,
            body: body.value,
            seo_title: val("seo_title"),
            seo_description: val("seo_description"),
            status: action,
         };
         if (kind === "pages") {
            data.summary = val("summary");
            data.show_in_sitemap = (form.elements.namedItem("show_in_sitemap") as HTMLInputElement).checked;
         } else {
            data.excerpt = val("excerpt");
            data.author_name = val("author_name");
            if (tagInput?.value.trim()) addTag(tagInput.value);
            data.tags = tags();
         }
         const wasPublished = $("[data-status-badge]")?.classList.contains("published");
         let rowId = id;
         if (id) await api("PATCH", `/api/data/entity/${kind}/${id}`, data);
         else {
            data.locale = locale;
            const created = await api<{ data: { id: number } }>("POST", `/api/data/entity/${kind}`, data);
            rowId = String(created.data.id);
         }
         dirty = false;
         const done = !id ? "created" : action === "published" ? "published" : wasPublished ? "unpublished" : "draft";
         location.assign(`/${kind}/${rowId}?done=${done}`);
      } catch (e) {
         toast(e instanceof ApiError ? `${T.failed} ${e.message}` : T.failed, "bad");
      } finally {
         submitting = false;
         buttons.forEach((b) => b.removeAttribute("disabled"));
      }
   });

   // Translations: link both rows with one translation_key, create the other language as a draft.
   $<HTMLButtonElement>("[data-add-translation]")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      const other = btn.dataset.addTranslation!;
      btn.setAttribute("disabled", "");
      try {
         let key = form.dataset.translationKey || "";
         if (!key) {
            key = crypto.randomUUID();
            await api("PATCH", `/api/data/entity/${kind}/${id}`, { translation_key: key });
         }
         const created = await api<{ data: { id: number } }>("POST", `/api/data/entity/${kind}`, {
            locale: other,
            slug: slug.value.trim(),
            title: title.value.trim(),
            translation_key: key,
            status: "draft",
            body: "",
         });
         dirty = false;
         location.assign(`/${kind}/${created.data.id}?done=created`);
      } catch (err) {
         toast(err instanceof ApiError ? `${T.failed} ${err.message}` : T.failed, "bad");
         btn.removeAttribute("disabled");
      }
   });

   // Delete (admins; bknd refuses editors anyway).
   const confirmDlg = $<HTMLDialogElement>("#confirm");
   $("[data-delete]")?.addEventListener("click", () => confirmDlg?.showModal());
   confirmDlg?.addEventListener("close", async () => {
      if (confirmDlg.returnValue !== "ok") return;
      try {
         await api("DELETE", `/api/data/entity/${kind}/${id}`);
         dirty = false;
         location.assign(`/${kind}?done=deleted`);
      } catch (err) {
         toast(err instanceof ApiError ? `${T.failed} ${err.message}` : T.failed, "bad");
      }
   });

   // Cover image: upload / replace (overwrite), alt text, remove (admins).
   const coverBox = $("[data-cover]");
   const coverInput = $<HTMLInputElement>("[data-cover-input]");
   const drop = $("[data-drop]");
   const coverErr = $("[data-cover-err]");
   const upload = async (file: File) => {
      if (!coverErr || !drop) return;
      coverErr.hidden = true;
      if (!IMAGE_TYPES.includes(file.type)) {
         coverErr.textContent = T.coverBadType;
         coverErr.hidden = false;
         return;
      }
      if (file.size > MAX_BYTES) {
         coverErr.textContent = T.coverTooBig;
         coverErr.hidden = false;
         return;
      }
      drop.setAttribute("aria-busy", "true");
      const label = $("span", drop);
      if (label) label.textContent = T.coverUploading;
      try {
         const fd = new FormData();
         fd.append("file", file, file.name);
         await api("POST", `/api/media/entity/${kind}/${id}/cover?overwrite=true`, fd);
         location.assign(`/${kind}/${id}?done=saved`);
      } catch (err) {
         drop.removeAttribute("aria-busy");
         coverErr.textContent = err instanceof ApiError ? `${T.failed} ${err.message}` : T.failed;
         coverErr.hidden = false;
      }
   };
   coverInput?.addEventListener("change", () => {
      const f = coverInput.files?.[0];
      if (f) upload(f);
   });
   drop?.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("over");
   });
   drop?.addEventListener("dragleave", () => drop.classList.remove("over"));
   drop?.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      const f = e.dataTransfer?.files?.[0];
      if (f) upload(f);
   });
   $("[data-alt-save]")?.addEventListener("click", async () => {
      const input = $<HTMLInputElement>("[data-alt-input]");
      try {
         await api("PATCH", `/admin/api/media/${coverBox!.dataset.cover}/alt`, { alt: input?.value ?? "" });
         location.assign(`/${kind}/${id}?done=saved`);
      } catch (err) {
         toast(err instanceof ApiError ? `${T.failed} ${err.message}` : T.failed, "bad");
      }
   });
   $("[data-cover-remove]")?.addEventListener("click", async () => {
      const path = coverBox?.dataset.coverPath;
      if (!path) return;
      try {
         await api("DELETE", `/api/media/file/${encodeURIComponent(path)}`);
         location.assign(`/${kind}/${id}?done=saved`);
      } catch (err) {
         toast(err instanceof ApiError ? `${T.failed} ${err.message}` : T.failed, "bad");
      }
   });
}
