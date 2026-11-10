/**
 * Row screens: inline edits (PATCH one field on change), visibility switches, reorder by drag or
 * by Move up / Move down (renumber in steps of 10, PATCH only rows whose sort changed), add, delete.
 * Videos: add / change through the picker endpoints. Site settings and Library.
 */
import { $, $$, api, ApiError, strings, takeReason, toast } from "./dom.ts";
import { openPicker } from "./picker.ts";

interface S {
   failed: string;
   saved: string;
   reordered: string;
   published: string;
   draft: string;
   urlBad: string;
   required: string;
   added: string;
   already: string;
   siteSaved: string;
   socialBad: string;
   deleteUsed: string;
   coverTooBig: string;
   coverBadType: string;
   uploading: string;
   retried: string;
}

export function validNavUrl(url: string): boolean {
   if (!url || url.length > 2048) return false;
   if (url.startsWith("/")) return !url.startsWith("//") && !/[\\\s]/.test(url);
   try {
      return new URL(url).protocol === "https:";
   } catch {
      return false;
   }
}

const fail = (T: S, e: unknown) => toast(e instanceof ApiError ? `${T.failed} ${e.message}` : T.failed, "bad");

/** Asks the shared confirm dialog; resolves true on "ok". */
function confirmDialog(extra?: string): Promise<boolean> {
   const dlg = $<HTMLDialogElement>("#confirm");
   if (!dlg) return Promise.resolve(window.confirm(extra ?? "?"));
   const body = $(".dlg-b p", dlg);
   const original = body?.dataset.original ?? body?.textContent ?? "";
   if (body) {
      body.dataset.original = original;
      body.textContent = extra ? `${extra} ${original}` : original;
   }
   dlg.showModal();
   return new Promise((resolve) => dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true }));
}

function initRowList(T: S): void {
   const list = $("[data-rows]");
   if (!list) return;
   const entity = list.dataset.rows!;
   const rows = () => $$<HTMLLIElement>(":scope > li[data-id]", list);

   // Inline field edits.
   list.addEventListener("change", async (e) => {
      const input = e.target as HTMLInputElement | HTMLSelectElement;
      const field = input.dataset.field;
      const li = input.closest<HTMLLIElement>("li[data-id]");
      if (!field || !li) return;
      let value: unknown = input.value.trim();
      if (input instanceof HTMLInputElement && input.type === "checkbox") value = input.checked ? input.dataset.on : input.dataset.off;
      if (input.hasAttribute("data-nullable") && value === "") value = null;
      if (input.required && value === "") {
         input.setAttribute("aria-invalid", "true");
         toast(T.required, "bad");
         return;
      }
      if (input.dataset.validate === "navurl" && !validNavUrl(String(value))) {
         input.setAttribute("aria-invalid", "true");
         toast(T.urlBad, "bad");
         return;
      }
      input.removeAttribute("aria-invalid");
      try {
         await api("PATCH", `/api/data/entity/${entity}/${li.dataset.id}`, { [field]: value });
         if (field === "status") {
            const label = $(".vis-label", li);
            if (label) label.textContent = value === "published" ? T.published : T.draft;
         }
         li.classList.add("saved");
         setTimeout(() => li.classList.remove("saved"), 1200);
         toast(T.saved);
      } catch (err) {
         fail(T, err);
         if (input instanceof HTMLInputElement && input.type === "checkbox") input.checked = !input.checked;
      }
   });

   // Reorder.
   const persist = async (focus?: HTMLElement) => {
      const changes: [string, number][] = [];
      rows().forEach((li, i) => {
         const sort = (i + 1) * 10;
         if (Number(li.dataset.sort) !== sort) changes.push([li.dataset.id!, sort]);
      });
      try {
         for (const [id, sort] of changes) {
            await api("PATCH", `/api/data/entity/${entity}/${id}`, { sort });
            const li = list.querySelector<HTMLLIElement>(`li[data-id="${id}"]`);
            if (li) li.dataset.sort = String(sort);
         }
         if (changes.length) toast(T.reordered);
      } catch (err) {
         fail(T, err);
      }
      focus?.focus();
   };
   list.addEventListener("click", async (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("[data-move],[data-row-delete]");
      const li = btn?.closest<HTMLLIElement>("li[data-id]");
      if (!btn || !li) return;
      if (btn.hasAttribute("data-row-delete")) {
         if (!(await confirmDialog())) return;
         try {
            await api("DELETE", `/api/data/entity/${entity}/${li.dataset.id}`, { reason: takeReason($("#confirm")) });
            li.remove();
            toast(T.saved);
         } catch (err) {
            fail(T, err);
         }
         return;
      }
      if (btn.dataset.move === "up" && li.previousElementSibling) li.parentElement!.insertBefore(li, li.previousElementSibling);
      else if (btn.dataset.move === "down" && li.nextElementSibling) li.parentElement!.insertBefore(li.nextElementSibling, li);
      else return;
      await persist(btn);
   });
   let dragged: HTMLLIElement | null = null;
   list.addEventListener("dragstart", (e) => {
      const li = (e.target as HTMLElement).closest<HTMLLIElement>("li[data-id]");
      if (!li || (e.target as HTMLElement).matches("input,select,textarea")) return;
      dragged = li;
      li.classList.add("dragging");
      e.dataTransfer?.setData("text/plain", li.dataset.id!);
   });
   list.addEventListener("dragover", (e) => {
      const over = (e.target as HTMLElement).closest<HTMLLIElement>("li[data-id]");
      if (!dragged || !over || over === dragged) return;
      e.preventDefault();
      const r = over.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      rows().forEach((x) => x.classList.remove("drop-before", "drop-after"));
      over.classList.add(before ? "drop-before" : "drop-after");
   });
   list.addEventListener("drop", (e) => {
      const over = (e.target as HTMLElement).closest<HTMLLIElement>("li[data-id]");
      if (!dragged || !over) return;
      e.preventDefault();
      const before = over.classList.contains("drop-before");
      over.classList.remove("drop-before", "drop-after");
      over.parentElement!.insertBefore(dragged, before ? over : over.nextElementSibling);
      void persist();
   });
   list.addEventListener("dragend", () => {
      dragged?.classList.remove("dragging");
      dragged = null;
      rows().forEach((x) => x.classList.remove("drop-before", "drop-after"));
   });
}

function initAddRow(T: S): void {
   const form = $<HTMLFormElement>("form[data-row-add]");
   if (!form) return;
   const entity = form.dataset.rowAdd!;
   const err = $("[data-add-err]", form);
   form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const body: Record<string, unknown> = {};
      for (const [k, v] of fd) body[k] = typeof v === "string" ? v.trim() : v;
      if (body.sort !== undefined) body.sort = Number(body.sort);
      const bad = (msg: string, el: HTMLElement | null) => {
         if (err) {
            err.textContent = msg;
            err.hidden = false;
         }
         el?.setAttribute("aria-invalid", "true");
         el?.focus();
      };
      for (const el of $$<HTMLInputElement>("input[required]", form)) {
         if (!el.value.trim()) return bad(T.required, el);
         el.removeAttribute("aria-invalid");
      }
      const url = $<HTMLInputElement>("[data-validate=navurl]", form);
      if (url && !validNavUrl(url.value.trim())) return bad(T.urlBad, url);
      try {
         await api("POST", `/api/data/entity/${entity}`, body);
         location.assign(location.pathname + location.search + (location.search ? "&" : "?") + "done=saved");
      } catch (e2) {
         fail(T, e2);
      }
   });
}

function initVideos(T: S): void {
   for (const btn of $$<HTMLButtonElement>("[data-videos-add]")) {
      btn.addEventListener("click", () =>
         openPicker(async (item) => {
            try {
               const res = await api<{ existing?: boolean }>("POST", "/picker/api/items", {
                  kind: item.kind,
                  ref_id: item.id,
                  placement: btn.dataset.videosAdd,
                  locale: "all",
                  status: "draft",
                  sort: Number(btn.dataset.sort ?? 0),
               });
               toast(res.existing ? T.already : T.added, res.existing ? "bad" : "ok");
               if (!res.existing) setTimeout(() => location.reload(), 600);
            } catch (e) {
               fail(T, e);
            }
         }, btn),
      );
      if (btn.dataset.autoOpen) {
         btn.click();
         const url = new URL(location.href);
         url.searchParams.delete("add");
         history.replaceState(null, "", url.pathname + url.search);
      }
   }
   for (const btn of $$<HTMLButtonElement>("[data-change-video]")) {
      btn.addEventListener("click", () =>
         openPicker(async (item) => {
            try {
               await api("PUT", `/picker/api/items/${btn.dataset.changeVideo}`, { kind: item.kind, ref_id: item.id });
               location.reload();
            } catch (e) {
               if (e instanceof ApiError && e.status === 409) toast(T.already, "bad");
               else fail(T, e);
            }
         }, btn),
      );
   }
}

function initSite(T: S): void {
   const form = $<HTMLFormElement>("form[data-site]");
   if (!form) return;
   const list = $("[data-social-list]", form)!;
   const tpl = $<HTMLTemplateElement>("template[data-social-template]", form)!;
   let n = 1000;
   $("[data-social-add]", form)?.addEventListener("click", () => {
      const frag = tpl.content.cloneNode(true) as DocumentFragment;
      for (const el of $$("[id]", frag)) {
         const id = `${el.id}-${n}`;
         $(`label[for="${el.id}"]`, frag)?.setAttribute("for", id);
         el.id = id;
      }
      n++;
      list.append(frag);
      $<HTMLInputElement>("li:last-child input", list)?.focus();
   });
   list.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest("[data-social-remove]");
      if (btn) btn.closest("li")?.remove();
   });
   const heroTitle = $("[data-hero-title]");
   const heroBody = $("[data-hero-body]");
   form.addEventListener("input", () => {
      const v = (n2: string) => (form.elements.namedItem(n2) as HTMLInputElement).value;
      if (heroTitle) heroTitle.textContent = v("hero_title") || v("site_title");
      if (heroBody) heroBody.textContent = v("hero_body");
   });
   form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const v = (n2: string) => (form.elements.namedItem(n2) as HTMLInputElement).value.trim();
      const titleInput = form.elements.namedItem("site_title") as HTMLInputElement;
      const titleErr = $("#s-title-err");
      if (!v("site_title")) {
         titleInput.setAttribute("aria-invalid", "true");
         if (titleErr) {
            titleErr.textContent = T.required;
            titleErr.hidden = false;
         }
         titleInput.focus();
         return;
      }
      const social: { kind: string; url: string }[] = [];
      const socialErr = $("[data-social-err]", form)!;
      socialErr.hidden = true;
      for (const li of $$("[data-social]", list)) {
         const url = $<HTMLInputElement>("input", li)!;
         const kind = $<HTMLSelectElement>("select", li)!.value;
         if (!url.value.trim()) continue;
         let ok: boolean;
         try {
            ok = new URL(url.value.trim()).protocol === "https:";
         } catch {
            ok = false;
         }
         if (!ok) {
            url.setAttribute("aria-invalid", "true");
            socialErr.textContent = T.socialBad;
            socialErr.hidden = false;
            url.focus();
            return;
         }
         url.removeAttribute("aria-invalid");
         social.push({ kind, url: url.value.trim() });
      }
      const nul = (s: string) => (s === "" ? null : s);
      const body = { site_title: v("site_title"), tagline: nul(v("tagline")), hero_title: nul(v("hero_title")), hero_body: nul(v("hero_body")), social };
      try {
         if (form.dataset.site) await api("PATCH", `/api/data/entity/site_settings/${form.dataset.site}`, body);
         else await api("POST", "/api/data/entity/site_settings", { ...body, locale: form.dataset.locale });
         location.assign(`/site?locale=${form.dataset.locale}&done=saved`);
      } catch (err) {
         fail(T, err);
      }
   });
}

function initLibrary(T: S): void {
   const input = $<HTMLInputElement>("[data-library-upload]");
   const err = $("[data-library-err]");
   input?.addEventListener("change", async () => {
      const files = [...(input.files ?? [])];
      if (err) err.hidden = true;
      for (const f of files) {
         const msg = !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(f.type) ? T.coverBadType : f.size > 10 * 1024 * 1024 ? T.coverTooBig : null;
         if (msg && err) {
            err.textContent = `${f.name}: ${msg}`;
            err.hidden = false;
            return;
         }
      }
      try {
         for (const f of files) {
            const fd = new FormData();
            fd.append("file", f, f.name);
            toast(`${T.uploading} ${f.name}`);
            await api("POST", "/api/media/upload", fd);
         }
         location.assign("/library?done=saved");
      } catch (e) {
         fail(T, e);
      }
   });
   document.addEventListener("click", async (e) => {
      const t = e.target as HTMLElement;
      const card = t.closest<HTMLElement>("[data-media]");
      if (!card) return;
      if (t.closest("[data-variants-retry]")) {
         const btn = t.closest<HTMLButtonElement>("[data-variants-retry]")!;
         btn.disabled = true;
         try {
            await api("POST", "/admin/api/media/variants/retry", { path: card.dataset.path });
            btn.closest("[data-variants-failed]")?.remove();
            card.dataset.variants = "queued";
            toast(T.retried);
         } catch (err2) {
            btn.disabled = false;
            fail(T, err2);
         }
      } else if (t.closest("[data-media-alt-save]")) {
         try {
            await api("PATCH", `/admin/api/media/${card.dataset.media}/alt`, { alt: $<HTMLInputElement>("[data-media-alt]", card)!.value });
            toast(T.saved);
         } catch (err2) {
            fail(T, err2);
         }
      } else if (t.closest("[data-media-delete]")) {
         if (!(await confirmDialog(card.dataset.used ? T.deleteUsed : undefined))) return;
         try {
            await api("DELETE", `/api/media/file/${encodeURIComponent(card.dataset.path!)}`, { reason: takeReason($("#confirm")) });
            card.remove();
            toast(T.saved);
         } catch (err2) {
            fail(T, err2);
         }
      }
   });
}

export function initRows(): void {
   const T = strings<S>();
   initRowList(T);
   initAddRow(T);
   initVideos(T);
   initSite(T);
   initLibrary(T);
}
