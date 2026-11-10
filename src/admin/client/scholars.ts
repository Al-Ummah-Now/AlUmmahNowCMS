/**
 * Scholars (docs/SCHOLARS.md): the profile form (own or staff), deleting a profile, featuring
 * articles and videos (Featuring screen and the editor's "Main site" card). Driven by data-*
 * attributes; strings come from the shell (#i18n-shell `sch`). Destructive actions confirm in the
 * page's own dialog (#confirm), never a browser prompt.
 */
import { $, $$, api, ApiError, errorMessage, strings, takeReason, toast } from "./dom.ts";
import { chooseMedia, initMediaPicker } from "./blocks.ts";
import { openPicker } from "./picker.ts";

interface S {
   saved: string;
   deleted: string;
   errors: Record<string, string>;
   failed: string;
   featuredDone: string;
   unfeaturedDone: string;
   videoAdded: string;
   videoAlready: string;
   videoRemoved: string;
}

const T = (): S => strings<{ sch: S }>("i18n-shell").sch;

function messageOf(e: unknown): string {
   const t = T();
   if (e instanceof ApiError) {
      const code = (e.body as { error?: unknown } | undefined)?.error;
      if (typeof code === "string" && t.errors[code]) return t.errors[code];
      if (typeof code !== "string") return errorMessage(e.body) ?? t.failed;
   }
   return t.failed;
}

const reload = () => setTimeout(() => location.reload(), 400);

function initProfile(): void {
   const form = $<HTMLFormElement>("form[data-scholar-form]");
   if (!form) return;
   initMediaPicker();
   const box = $<HTMLElement>("[data-avatar]", form)!;
   const img = $<HTMLImageElement>("[data-avatar-img]", form)!;
   const remove = $<HTMLButtonElement>("[data-avatar-remove]", form)!;
   const choose = $<HTMLButtonElement>("[data-avatar-choose]", form)!;
   choose.addEventListener("click", async () => {
      const [pick] = await chooseMedia(false, choose);
      if (!pick) return;
      box.dataset.avatar = String(pick.id);
      img.src = pick.url;
      img.hidden = false;
      remove.hidden = false;
   });
   remove.addEventListener("click", () => {
      box.dataset.avatar = "";
      img.removeAttribute("src");
      img.hidden = true;
      remove.hidden = true;
      choose.focus();
   });
   const slugErr = $<HTMLElement>("#sp-slug-err", form);
   form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const t = T();
      const val = (n: string) => (form.elements.namedItem(n) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? "";
      const body: Record<string, unknown> = {
         name_en: val("name_en"),
         name_ar: val("name_ar"),
         bio_en: val("bio_en"),
         bio_ar: val("bio_ar"),
         slug: val("slug").trim(),
         avatar_media_id: box.dataset.avatar ? Number(box.dataset.avatar) : null,
         updated_at: form.dataset.updated ?? "",
      };
      // Channels can only be changed while the videos API answers (the list is on the page).
      if ($("[data-channels]", form)) body.channel_ids = $$<HTMLInputElement>("input[name=channel_ids]:checked", form).map((x) => x.value);
      const submit = $<HTMLButtonElement>("button[type=submit]", form)!;
      submit.disabled = true;
      slugErr?.setAttribute("hidden", "");
      try {
         const res = await api<{ data: { updated_at: string } }>("PUT", String(form.dataset.endpoint), body);
         form.dataset.updated = res.data.updated_at;
         toast(t.saved);
      } catch (e) {
         const msg = messageOf(e);
         const code = e instanceof ApiError ? (e.body as { error?: unknown } | undefined)?.error : null;
         if (slugErr && (code === "bad_slug" || code === "slug_taken")) {
            slugErr.textContent = msg;
            slugErr.removeAttribute("hidden");
            $<HTMLInputElement>("#sp-slug", form)?.focus();
         }
         toast(msg, "bad");
      } finally {
         submit.disabled = false;
      }
   });

   const del = $<HTMLButtonElement>("[data-scholar-delete]");
   const dlg = $<HTMLDialogElement>("#confirm");
   if (del && dlg) {
      del.addEventListener("click", () => dlg.showModal());
      dlg.addEventListener("close", async () => {
         if (dlg.returnValue !== "ok") return;
         try {
            await api("DELETE", String(del.dataset.endpoint), { reason: takeReason(dlg) });
            location.assign("/scholars?done=scholarDeleted");
         } catch (e) {
            toast(messageOf(e), "bad");
         }
      });
   }
}

function initFeaturing(): void {
   for (const b of $$<HTMLButtonElement>("[data-feature-post]")) {
      b.addEventListener("click", async () => {
         const on = b.dataset.on === "true";
         b.disabled = true;
         try {
            await api("POST", `/admin/api/featuring/posts/${b.dataset.featurePost}`, { on });
            toast(on ? T().featuredDone : T().unfeaturedDone);
            reload();
         } catch (e) {
            toast(messageOf(e), "bad");
            b.disabled = false;
         }
      });
   }

   const addVideo = async (refId: string) => {
      const res = await api<{ data: { existing: boolean } }>("POST", "/admin/api/timeline/videos", { kind: "video", ref_id: refId, locale: "all" });
      toast(res.data.existing ? T().videoAlready : T().videoAdded, res.data.existing ? "bad" : "ok");
      reload();
   };
   for (const b of $$<HTMLButtonElement>("[data-feature-video]")) {
      b.addEventListener("click", async () => {
         b.disabled = true;
         try {
            await addVideo(String(b.dataset.featureVideo));
         } catch (e) {
            toast(messageOf(e), "bad");
            b.disabled = false;
         }
      });
   }
   const pick = $<HTMLButtonElement>("[data-feature-pick]");
   pick?.addEventListener("click", () =>
      openPicker(async (item) => {
         try {
            await addVideo(item.id);
         } catch (e) {
            toast(messageOf(e), "bad");
         }
      }, pick),
   );

   // Unfeature a video = remove its timeline entry (a soft delete), after the in-page confirmation.
   const dlg = $<HTMLDialogElement>("#confirm");
   let pending: HTMLButtonElement | null = null;
   for (const b of $$<HTMLButtonElement>("[data-unfeature-video]")) {
      b.addEventListener("click", () => {
         pending = b;
         dlg?.showModal();
      });
   }
   if (dlg && $("[data-unfeature-video]")) {
      dlg.addEventListener("close", async () => {
         const b = pending;
         pending = null;
         if (!b || dlg.returnValue !== "ok") return;
         b.disabled = true;
         try {
            await api("DELETE", `/admin/api/timeline/entries/${b.dataset.unfeatureVideo}`, {});
            toast(T().videoRemoved);
            reload();
         } catch (e) {
            toast(messageOf(e), "bad");
            b.disabled = false;
         }
      });
   }
}

export function initScholars(): void {
   initProfile();
   initFeaturing();
}
