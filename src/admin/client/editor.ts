/** Page/post editor: save, publish, slug rules, conflict check, markdown, tags, cover, translations, delete. */
import { $, $$, api, ApiError, takeReason, toast, strings } from "./dom.ts";
import { runSaveHooks } from "./save-hooks.ts";
import { addLeaveGuard, askConfirm, askLink } from "./dialogs.ts";
import { renderMarkdownInto } from "./markdown.ts";
import { openPicker } from "./picker.ts";
import { readBlocks, readSlides, showReadError } from "./blocks.ts";
import { readPageType } from "./page-type.ts";
import { toLocalInput } from "./time.ts";
import { fallbackBase, firstFree, hasArabic, isJunkSlug, SLUG_RE, slugCandidates, slugify } from "../../lib/slug.ts";

interface S {
   slugBad: string;
   slugHome: string;
   slugTaken: string;
   slugNumeric: string;
   slugChangeTitle: string;
   slugChangeBody: string;
   slugChangeOk: string;
   slugSuggesting: string;
   slugTranslated: string;
   slugTransliterated: string;
   required: string;
   saving: string;
   failed: string;
   conflict: string;
   invalid: string;
   previewEmpty: string;
   videoLine: string;
   removeTag: string;
   coverTooBig: string;
   coverBadType: string;
   coverUploading: string;
   schedulePast: string;
   scheduleRequired: string;
   previewSaveFirst: string;
   unpublish: string;
   unpublishTitle: string;
   unpublishBody: string;
   unschedule: string;
   unscheduleTitle: string;
   unscheduleBody: string;
   coverRemove: string;
   coverRemoveTitle: string;
   coverRemoveBody: string;
}

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_BYTES = 10 * 1024 * 1024;

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
   // Pages are built from blocks (no markdown body field); posts have the body (articles) and slides (cards).
   const body = $<HTMLTextAreaElement>("#f-body", form);
   const state = form.dataset.state as "draft" | "scheduled" | "published";
   // Scheduling: the input shows the schedule (or the next full hour + 1) in the editor's own time zone.
   const publishAt = $<HTMLInputElement>("#f-publish-at", form);
   const later = $<HTMLDetailsElement>("[data-later]", form);
   if (publishAt) {
      const current = form.dataset.publishAt ? new Date(form.dataset.publishAt) : null;
      const soon = new Date(Date.now() + 3600_000);
      soon.setMinutes(0, 0, 0);
      publishAt.value = toLocalInput(current && !Number.isNaN(current.getTime()) ? current : soon);
      publishAt.min = toLocalInput(new Date());
   }
   let dirty = false;
   let slugTouched = !slug.dataset.autoSlug;
   const dirtyNote = $("[data-dirty]", form);
   const markDirty = () => {
      dirty = true;
      if (dirtyNote) dirtyNote.hidden = false;
   };
   form.addEventListener("input", markDirty);
   form.addEventListener("seq:change", markDirty);
   // Unsaved changes: in-app links ask first (src/admin/client/dialogs.ts); closing the tab doesn't prompt.
   addLeaveGuard(() => (dirty ? "unsaved" : null));

   // "Preview on site" shows the last SAVED draft: with unsaved edits, ask for a save first.
   $<HTMLAnchorElement>("[data-preview]")?.addEventListener("click", (e) => {
      if (!dirty) return;
      e.preventDefault();
      toast(T.previewSaveFirst, "bad");
      $<HTMLButtonElement>('button[type=submit][data-action="draft"]', form)?.focus();
   });

   // Slug (src/lib/slug.ts): made from the title as it is typed until the editor types in it; from then
   // on it is theirs, with "Regenerate from title" to go back. A generated slug that is taken gets
   // -2, -3, … on save; a typed one that is taken is an error.
   // A live row's address is locked: changing it breaks shared links (www keeps no redirects), so it
   // takes "Change address" and a confirmation first.
   const regen = $<HTMLButtonElement>("[data-slug-regen]", form);
   const unlock = $<HTMLButtonElement>("[data-slug-unlock]", form);
   let slugAuto = !slugTouched;
   let liveLocked = slug.dataset.slugLive === "1";
   const showRegen = () => {
      if (regen) regen.hidden = !slugTouched;
   };
   async function unlockLive(): Promise<boolean> {
      if (!liveLocked) return true;
      const yes = await askConfirm({ title: T.slugChangeTitle, body: T.slugChangeBody, ok: T.slugChangeOk, noIcon: true });
      if (!yes) return false;
      liveLocked = false;
      slug.readOnly = false;
      if (unlock) unlock.hidden = true;
      $("[data-slug-locked]")?.setAttribute("hidden", "");
      return true;
   }
   unlock?.addEventListener("click", async () => {
      if (await unlockLive()) slug.focus();
   });
   // An Arabic title: the Latin transliteration at once, then the server's English suggestion
   // (src/lib/slug-suggest.ts) once typing pauses. A reply for an older title, or after the editor
   // typed an address, is dropped. Save waits for a suggestion in flight.
   const sourceNote = $<HTMLElement>("[data-slug-source]", form);
   const note = (text: string) => {
      if (!sourceNote) return;
      sourceNote.textContent = text;
      sourceNote.hidden = !text;
   };
   let suggestTimer: ReturnType<typeof setTimeout> | undefined;
   let suggestSeq = 0;
   let pending: Promise<void> | null = null;
   function suggest(fresh: boolean): Promise<void> {
      const text = title.value.trim();
      const seq = ++suggestSeq;
      note(T.slugSuggesting);
      const run = api<{ slug: string; source: "english" | "translated" | "transliterated" }>("POST", "/admin/api/ai/slug", { kind, locale, title: text, id: id || null, fresh })
         .then((r) => {
            if (seq !== suggestSeq || !slugAuto || title.value.trim() !== text) return;
            slug.value = r.slug;
            fieldError(slug, "f-slug-err", null);
            note(r.source === "translated" ? T.slugTranslated : r.source === "transliterated" ? T.slugTransliterated : "");
            updateSerp();
         })
         .catch(() => {
            if (seq === suggestSeq) note(T.slugTransliterated);
         })
         .finally(() => {
            if (seq === suggestSeq) pending = null;
         });
      pending = run;
      return run;
   }
   function fromTitle(fresh: boolean, wait: number) {
      clearTimeout(suggestTimer);
      suggestSeq++;
      pending = null;
      slug.value = slugify(title.value);
      fieldError(slug, "f-slug-err", null);
      if (!hasArabic(title.value)) {
         note("");
         return;
      }
      note(T.slugSuggesting);
      if (wait <= 0) void suggest(fresh);
      else {
         // Save must not race the debounce: it waits on this until the request is sent.
         pending = new Promise<void>((resolve) => {
            suggestTimer = setTimeout(() => void suggest(fresh).then(resolve), wait);
         });
      }
   }
   /** Lets a save wait (at most ~10 s) for the English suggestion of the current title. */
   const settled = () => (pending ? Promise.race([pending, new Promise<void>((r) => setTimeout(r, 10_000))]) : Promise.resolve());
   regen?.addEventListener("click", async () => {
      if (!(await unlockLive())) return;
      slugTouched = false;
      slugAuto = true;
      fromTitle(true, 0);
      showRegen();
      markDirty();
      updateSerp();
   });
   slug.addEventListener("input", () => {
      slugTouched = true;
      slugAuto = false;
      clearTimeout(suggestTimer);
      suggestSeq++;
      pending = null;
      note("");
      showRegen();
      updateSerp();
   });
   title.addEventListener("input", () => {
      if (!slugTouched) fromTitle(false, 800);
      updateSerp();
   });
   showRegen();

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
   if (body) initBodyMarkdown(body, form);
   function initBodyMarkdown(body: HTMLTextAreaElement, form: HTMLFormElement) {
   const preview = $("[data-md-preview]", form)!;
   for (const tab of $$<HTMLButtonElement>("[data-md-tab]", form)) {
      tab.addEventListener("click", () => {
         const show = tab.dataset.mdTab === "preview";
         for (const t of $$("[data-md-tab]", form)) {
            const on = t === tab;
            t.setAttribute("aria-selected", String(on));
         }
         body.hidden = show;
         preview.hidden = !show;
         if (show) {
            if (body.value.trim()) renderMarkdownInto(preview, body.value, T.videoLine);
            else {
               const p = document.createElement("p");
               p.className = "muted";
               p.textContent = T.previewEmpty;
               preview.replaceChildren(p);
            }
         }
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
            case "link":
               askLink(body).then((href) => {
                  if (href) wrap("[", `](${href})`, "link");
               });
               return;
            case "video":
               return openPicker((item) => insertLine(`::video[${item.id}]`), b);
         }
      });
   }
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
   // Typed or pasted commas split into tags.
   tagInput?.addEventListener("input", () => {
      if (!tagInput.value.includes(",")) return;
      const parts = tagInput.value.split(",");
      const rest = parts.pop() ?? "";
      for (const p of parts) addTag(p);
      tagInput.value = rest;
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
      const pressed = ((ev as SubmitEvent).submitter as HTMLElement | null)?.dataset.action;
      const action = pressed === "published" || pressed === "schedule" ? pressed : "draft";
      fieldError(title, "f-title-err", title.value.trim() ? null : T.required);
      if (slugAuto && pending) {
         submitting = true;
         try {
            await settled();
         } finally {
            submitting = false;
         }
      }
      // A generated slug can be empty (a title of emoji): "post" / "page", numbered on save.
      if (slugAuto && !slug.value.trim() && title.value.trim()) slug.value = fallbackBase(kind);
      let s = slug.value.trim();
      // Only digits says nothing about the content (the old form's "1"): a typed one is refused.
      let slugErr: string | null = !s
         ? T.required
         : !SLUG_RE.test(s)
           ? T.slugBad
           : kind === "pages" && s === "home"
             ? T.slugHome
             : !slugAuto && isJunkSlug(s) && s !== form.dataset.slug
               ? T.slugNumeric
               : null;
      fieldError(slug, "f-slug-err", slugErr);
      if (!title.value.trim() || slugErr) {
         (title.value.trim() ? slug : title).focus();
         return;
      }
      // A schedule is a local date and time in the future; it is sent as an absolute ISO time.
      let goLive: string | null = null;
      if (action === "schedule" && publishAt) {
         const at = publishAt.value ? new Date(publishAt.value) : null;
         const err = !at || Number.isNaN(at.getTime()) ? T.scheduleRequired : at.getTime() <= Date.now() + 30_000 ? T.schedulePast : null;
         fieldError(publishAt, "f-publish-at-err", err);
         if (err) {
            if (later) later.open = true;
            publishAt.focus();
            return;
         }
         goLive = at!.toISOString();
      }
      // Blocks and slides: the server's own rules, checked here first so the editor can point at the block.
      const blocksRead = readBlocks(form);
      const slidesRead = readSlides(form);
      for (const r of [blocksRead, slidesRead]) {
         if (r && !r.ok) {
            showReadError(r);
            return;
         }
      }
      const blocks = blocksRead?.ok ? blocksRead.value : undefined;
      // Pages: the page type and a filter page's filter (src/admin/client/page-type.ts).
      const pageType = readPageType(form);
      if (pageType && !pageType.ok) return;
      const slides = slidesRead?.ok ? slidesRead.value : undefined;
      submitting = true;
      // Unpublish / Unschedule take it off the site (or off the schedule): ask first.
      if (action === "draft" && (state === "published" || state === "scheduled")) {
         const off = state === "published";
         const yes = await askConfirm({
            title: off ? T.unpublishTitle : T.unscheduleTitle,
            body: off ? T.unpublishBody : T.unscheduleBody,
            ok: off ? T.unpublish : T.unschedule,
            noIcon: true,
         });
         if (!yes) {
            submitting = false;
            return;
         }
      }
      const buttons = $$<HTMLButtonElement>("button[type=submit]", form);
      buttons.forEach((b) => b.setAttribute("disabled", ""));
      try {
         // A generated slug moves to the first free -2, -3, …; a typed one that is taken is the editor's call.
         const candidates = slugAuto ? slugCandidates(s) : [s];
         const where = encodeURIComponent(JSON.stringify({ slug: { $in: candidates }, locale }));
         const taken = await api<{ data: { id: number; slug: string }[] }>("GET", `/api/data/entity/${kind}?where=${where}&select=id,slug&limit=${candidates.length}`);
         const free = firstFree(
            candidates,
            taken.data.filter((r) => String(r.id) !== id).map((r) => r.slug),
         );
         if (slugAuto && free && free !== s) {
            s = free;
            slug.value = free;
            updateSerp();
         }
         if (!free) {
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
            seo_title: val("seo_title"),
            seo_description: val("seo_description"),
            status: action === "draft" ? "draft" : "published",
            // Publish = live now; Schedule = live at goLive; a draft carries no schedule.
            publish_at: goLive,
         };
         if (body) data.body = body.value;
         if (blocks) data.blocks = blocks;
         if (slides) data.slides = slides;
         const kindInput = $<HTMLInputElement>("input[data-post-kind]:checked", form);
         if (kindInput) data.kind = kindInput.value;
         if (kind === "pages") {
            if (pageType?.ok) Object.assign(data, pageType.value);
            data.summary = val("summary");
            data.show_in_sitemap = (form.elements.namedItem("show_in_sitemap") as HTMLInputElement).checked;
         } else {
            data.excerpt = val("excerpt");
            data.author_name = val("author_name");
            const onTimeline = form.elements.namedItem("show_on_timeline") as HTMLInputElement | null;
            if (onTimeline) data.show_on_timeline = onTimeline.checked;
            if (tagInput?.value.trim()) addTag(tagInput.value);
            data.tags = tags();
         }
         let rowId = id;
         // updated_at makes the save a compare-and-set on the server (409 if someone saved first).
         if (id) await api("PATCH", `/api/data/entity/${kind}/${id}`, form.dataset.updated ? { ...data, updated_at: form.dataset.updated } : data);
         else {
            data.locale = locale;
            const created = await api<{ data: { id: number } }>("POST", `/api/data/entity/${kind}`, data);
            rowId = String(created.data.id);
         }
         dirty = false;
         await runSaveHooks(String(rowId));
         const done =
            action === "schedule" ? "scheduled" : !id ? "created" : action === "published" ? "published" : state === "published" ? "unpublished" : state === "scheduled" ? "unscheduled" : "draft";
         location.assign(`/${kind}/${rowId}?done=${done}`);
      } catch (e) {
         // No raw server text: a 400 is a rule the form couldn't check (e.g. a block), anything else a failure.
         if (e instanceof ApiError && e.status === 409 && (e.body as { type?: string } | null)?.type === "SlugTakenError") {
            // Another row took this address after the check above (#50).
            slugErr = T.slugTaken;
            fieldError(slug, "f-slug-err", slugErr);
            slug.focus();
         } else if (e instanceof ApiError && e.status === 409) toast(T.conflict, "bad");
         else toast(e instanceof ApiError && e.status === 400 ? T.invalid : T.failed, "bad");
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
            // Same blocks / slides (images, posts, videos, layout): only the text needs translating.
            ...(readBlocks(form)?.ok ? { blocks: (readBlocks(form) as { value: unknown }).value } : {}),
            ...(readSlides(form)?.ok ? { slides: (readSlides(form) as { value: unknown }).value } : {}),
            ...($<HTMLInputElement>("input[data-post-kind]:checked", form) ? { kind: $<HTMLInputElement>("input[data-post-kind]:checked", form)!.value } : {}),
            // Same page type and filter (a curated page's translation starts with an empty list).
            ...(() => {
               const pt = readPageType(form);
               return pt?.ok ? pt.value : {};
            })(),
         });
         dirty = false;
         location.assign(`/${kind}/${created.data.id}?done=created`);
      } catch (err) {
         toast(err instanceof ApiError ? `${T.failed} ${err.message}` : T.failed, "bad");
         btn.removeAttribute("disabled");
      }
   });

   // Delete (admins; bknd refuses editors anyway).
   // Soft delete (docs/SOFT_DELETE.md): restorable from Recently deleted for 30 days.
   const delBtn = $<HTMLButtonElement>("[data-delete]");
   delBtn?.addEventListener("click", async () => {
      if (!(await askConfirm({ reason: true }))) return;
      try {
         await api("DELETE", `/api/data/entity/${kind}/${id}`, { reason: takeReason($("#confirm")) });
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
      if (!(await askConfirm({ title: T.coverRemoveTitle, body: T.coverRemoveBody, ok: T.coverRemove }))) return;
      try {
         await api("DELETE", `/api/media/file/${encodeURIComponent(path)}`);
         location.assign(`/${kind}/${id}?done=saved`);
      } catch (err) {
         toast(err instanceof ApiError ? `${T.failed} ${err.message}` : T.failed, "bad");
      }
   });
}
