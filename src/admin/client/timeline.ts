/**
 * The Timeline screen (src/admin/screens/timeline.tsx): pin / unpin, hide / show, remove, edit a
 * video entry's date, language and title, reorder the pinned items (drag, Move up / Move down,
 * Alt+↑/↓), add a post (chooser) or a video (the picker). Every change goes to
 * /admin/api/timeline/* and the page reloads where the list itself changes.
 */
import { $, $$, api, ApiError, el, strings, toast } from "./dom.ts";
import { askConfirm } from "./dialogs.ts";
import { openPicker } from "./picker.ts";
import { initLocalizedPairs, num, pairValues, translateInto, validatePair } from "./localized-pair.ts";

interface S {
   failed: string;
   saved: string;
   added: string;
   already: string;
   conflict: string;
   removePost: string;
   removeVideo: string;
   moved: string;
   candidatesNone: string;
   candidatesAllOn: string;
   candidatesAllOnOne: string;
   candidatesNoMatch: string;
   add: string;
   rebuildQueued: string;
   retried: string;
   required: string;
   missingDone: string;
   missingNone: string;
}

const fmt = (s: string, ...a: (string | number)[]) => a.reduce<string>((out, v, i) => out.split(`{${i}}`).join(String(v)), s);

const reload = () => location.reload();

/**
 * Why the "Add a post" chooser is empty: no published posts in this language at all, a search that
 * matches none of the switched-off posts, or every published post already on the timeline.
 */
export function emptyCandidates(T: Pick<S, "candidatesNone" | "candidatesAllOn" | "candidatesAllOnOne" | "candidatesNoMatch">, q: string, published: number, off: number): string {
   if (!published) return T.candidatesNone;
   if (q && off > 0) return T.candidatesNoMatch;
   return published === 1 ? T.candidatesAllOnOne : fmt(T.candidatesAllOn, published);
}

export function initTimeline(): void {
   const root = $("[data-timeline]");
   if (!root) return;
   const T = strings<S>();
   const locale = root.dataset.locale === "ar" ? "ar" : "en";
   // Home ("/admin/api/timeline") or a curated page's list ("/admin/api/lists/<id>"): same routes.
   const base = root.dataset.api || "/admin/api/timeline";
   const live = $("[data-tl-live]");
   const fail = (e: unknown) => toast(e instanceof ApiError && e.status === 409 ? T.conflict : T.failed, "bad");
   const patch = (key: string, body: Record<string, unknown>) => api("PATCH", `${base}/entries/${key}`, body);

   // Row actions.
   root.addEventListener("click", async (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-pin],[data-hide],[data-remove]");
      const li = btn?.closest<HTMLLIElement>("li[data-key]");
      if (!btn || !li) return;
      const key = li.dataset.key!;
      btn.disabled = true;
      try {
         if (btn.dataset.pin) {
            await patch(key, { pinned: btn.dataset.pin === "1" });
            reload();
         } else if (btn.dataset.hide) {
            await patch(key, { hidden: btn.dataset.hide === "1" });
            reload();
         } else if (btn.dataset.remove) {
            const isPost = btn.dataset.remove === "post";
            if (!(await askConfirm({ body: isPost ? T.removePost : T.removeVideo }))) return;
            if (isPost) await api("POST", `${base}/posts/${key.slice(1)}`, { on: false });
            else await api("DELETE", `${base}/entries/${key}`);
            reload();
         }
      } catch (e) {
         fail(e);
      } finally {
         btn.disabled = false;
      }
   });

   // Video entry fields: saved on change.
   root.addEventListener("change", async (ev) => {
      const input = ev.target as HTMLInputElement | HTMLSelectElement;
      const field = input.dataset.entryField;
      const li = input.closest<HTMLLIElement>("li[data-key]");
      if (!field || !li) return;
      let value: string | null = input.value.trim();
      if (field === "entry_date") {
         if (!value) {
            input.setAttribute("aria-invalid", "true");
            toast(T.required, "bad");
            return;
         }
         value = `${value}T12:00:00.000Z`;
      }
      if (field === "title_override" && !value) value = null;
      input.removeAttribute("aria-invalid");
      try {
         await patch(li.dataset.key!, { [field]: value });
         li.classList.add("saved");
         setTimeout(() => li.classList.remove("saved"), 1200);
         toast(T.saved);
         if (field !== "title_override") setTimeout(reload, 600);
      } catch (e) {
         fail(e);
      }
   });

   // "Title on the site" of an entry shown in both languages: the en/ar pair, saved together with its
   // own button (both or neither; Translate results are only saved here, after the editor saw them).
   initLocalizedPairs(root);
   root.addEventListener("click", async (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-tl-save-titles]");
      const fs = btn?.closest<HTMLElement>("[data-l10n-pair]");
      const li = btn?.closest<HTMLLIElement>("li[data-key]");
      if (!btn || !fs || !li) return;
      if (!validatePair(fs)) return;
      const v = pairValues(fs);
      btn.disabled = true;
      try {
         await patch(li.dataset.key!, { title_override: v.en || null, title_override_ar: v.ar || null });
         fs.classList.remove("dirty");
         li.classList.add("saved");
         setTimeout(() => li.classList.remove("saved"), 1200);
         toast(T.saved);
         li.querySelector("[data-l10n-missing]")?.remove();
      } catch (e) {
         const code = e instanceof ApiError ? (e.body as { error?: string } | null)?.error : null;
         if (code === "ar_missing" || code === "en_missing") validatePair(fs);
         else fail(e);
      } finally {
         btn.disabled = false;
      }
   });

   // "Translate missing" (the Missing a language filter): fills each listed pair's empty side, one at a
   // time, and leaves every result in its form to be checked and saved row by row. Nothing is saved here.
   $<HTMLButtonElement>("[data-tl-translate-missing]")?.addEventListener("click", async (ev) => {
      const b = ev.currentTarget as HTMLButtonElement;
      b.disabled = true;
      let n = 0;
      for (const fs of $$<HTMLElement>("li[data-key] [data-l10n-pair]", root)) {
         const v = pairValues(fs);
         if (!!v.en === !!v.ar) continue;
         if (await translateInto(fs, v.en ? "ar" : "en", { quiet: true })) n++;
      }
      b.disabled = false;
      const msg = n ? fmt(T.missingDone, num(n)) : T.missingNone;
      if (live) live.textContent = msg;
      toast(msg, n ? "ok" : "bad");
      $<HTMLElement>("li[data-key] [data-l10n-pair].dirty [data-l10n-input]", root)?.focus();
   });

   // Pinned order: buttons, Alt+↑/↓, drag. Saved as the whole order (409 if it changed meanwhile).
   const pins = $("[data-pins]", root);
   if (pins) {
      const items = () => $$<HTMLLIElement>(":scope > li[data-key]", pins);
      const save = async (moved: HTMLLIElement, focus?: HTMLElement | null) => {
         try {
            await api("PUT", `${base}/pins`, { locale, keys: items().map((li) => li.dataset.key) });
            const list = items();
            if (live) live.textContent = fmt(T.moved, list.indexOf(moved) + 1, list.length);
            toast(T.saved);
         } catch (e) {
            fail(e);
         }
         focus?.focus();
      };
      const move = (li: HTMLLIElement, dir: -1 | 1) => {
         if (dir < 0 && li.previousElementSibling) pins.insertBefore(li, li.previousElementSibling);
         else if (dir > 0 && li.nextElementSibling) pins.insertBefore(li.nextElementSibling, li);
         else return false;
         return true;
      };
      pins.addEventListener("click", (ev) => {
         const btn = (ev.target as HTMLElement).closest<HTMLButtonElement>("[data-move]");
         const li = btn?.closest<HTMLLIElement>("li[data-key]");
         if (!btn || !li) return;
         if (move(li, btn.dataset.move === "up" ? -1 : 1)) void save(li, btn);
      });
      pins.addEventListener("keydown", (ev) => {
         if (!ev.altKey || (ev.key !== "ArrowUp" && ev.key !== "ArrowDown")) return;
         const li = (ev.target as HTMLElement).closest<HTMLLIElement>("li[data-key]");
         if (!li) return;
         ev.preventDefault();
         const focus = document.activeElement as HTMLElement | null;
         if (move(li, ev.key === "ArrowUp" ? -1 : 1)) void save(li, focus);
      });
      let dragged: HTMLLIElement | null = null;
      pins.addEventListener("dragstart", (ev) => {
         const li = (ev.target as HTMLElement).closest<HTMLLIElement>("li[data-key]");
         if (!li || (ev.target as HTMLElement).matches("input,select,textarea")) return;
         dragged = li;
         li.classList.add("dragging");
         ev.dataTransfer?.setData("text/plain", li.dataset.key!);
      });
      pins.addEventListener("dragover", (ev) => {
         const over = (ev.target as HTMLElement).closest<HTMLLIElement>("li[data-key]");
         if (!dragged || !over || over === dragged) return;
         ev.preventDefault();
         const r = over.getBoundingClientRect();
         items().forEach((x) => x.classList.remove("drop-before", "drop-after"));
         over.classList.add(ev.clientY < r.top + r.height / 2 ? "drop-before" : "drop-after");
      });
      pins.addEventListener("drop", (ev) => {
         const over = (ev.target as HTMLElement).closest<HTMLLIElement>("li[data-key]");
         if (!dragged || !over) return;
         ev.preventDefault();
         const before = over.classList.contains("drop-before");
         over.classList.remove("drop-before", "drop-after");
         pins.insertBefore(dragged, before ? over : over.nextElementSibling);
         void save(dragged);
      });
      pins.addEventListener("dragend", () => {
         dragged?.classList.remove("dragging");
         dragged = null;
         items().forEach((x) => x.classList.remove("drop-before", "drop-after"));
      });
   }

   // Add a video: the shared picker; the entry is dated by the video's own date.
   const addVideo = $<HTMLButtonElement>("[data-tl-add-video]");
   addVideo?.addEventListener("click", () =>
      openPicker(async (item) => {
         try {
            const res = await api<{ data: { existing: boolean } }>("POST", `${base}/videos`, { kind: item.kind, ref_id: item.id, locale: "all" });
            toast(res.data.existing ? T.already : T.added, res.data.existing ? "bad" : "ok");
            if (!res.data.existing) setTimeout(reload, 500);
         } catch (e) {
            fail(e);
         }
      }, addVideo),
   );

   // Add a post: published posts that are off the timeline.
   const dlg = $<HTMLDialogElement>("#tl-posts");
   const openPosts = $<HTMLButtonElement>("[data-tl-add-post]");
   if (dlg && openPosts) {
      const q = $<HTMLInputElement>("#tl-q", dlg)!;
      const list = $("[data-tl-candidates]", dlg)!;
      const status = $("[data-tl-cand-status]", dlg)!;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const search = async () => {
         try {
            const typed = q.value.trim();
            const { items, published, off } = await api<{ items: { id: number; title: string; date: string; kind: string }[]; published: number; off: number }>(
               "GET",
               `${base}/candidates?locale=${locale}&q=${encodeURIComponent(typed)}`,
            );
            list.replaceChildren();
            status.textContent = items.length ? String(items.length) : emptyCandidates(T, typed, published, off);
            for (const it of items) {
               const li = el("li");
               li.append(el("span", { class: "ph", "aria-hidden": "true" }));
               li.append(el("div", {}, el("div", { class: "t", dir: "auto" }, it.title), el("div", { class: "m", dir: "ltr" }, it.date.slice(0, 10))));
               const b = el("button", { type: "button", class: "btn primary sm", "aria-label": `${T.add}: ${it.title}` }, T.add);
               b.addEventListener("click", async () => {
                  b.setAttribute("disabled", "");
                  try {
                     await api("POST", `${base}/posts/${it.id}`, { on: true });
                     toast(T.added);
                     setTimeout(reload, 400);
                  } catch (e) {
                     b.removeAttribute("disabled");
                     fail(e);
                  }
               });
               li.append(b);
               list.append(li);
            }
         } catch (e) {
            fail(e);
         }
      };
      openPosts.addEventListener("click", () => {
         dlg.showModal();
         q.focus();
         void search();
      });
      q.addEventListener("input", () => {
         clearTimeout(timer);
         timer = setTimeout(search, 250);
      });
      $("[data-dlg-close]", dlg)?.addEventListener("click", () => dlg.close());
      dlg.addEventListener("click", (e) => {
         if (e.target === dlg) dlg.close();
      });
      dlg.addEventListener("close", () => openPosts.focus());
   }

   // Publishing state: Retry (DLQ flag), Rebuild (admins).
   for (const b of $$<HTMLButtonElement>("[data-feed-retry]", root)) {
      b.addEventListener("click", async () => {
         b.disabled = true;
         try {
            await api("POST", "/admin/api/timeline/retry");
            toast(T.retried);
            b.closest("[data-feed-flag]")?.remove();
         } catch (e) {
            b.disabled = false;
            fail(e);
         }
      });
   }
   $<HTMLButtonElement>("[data-feed-rebuild]", root)?.addEventListener("click", async (ev) => {
      const b = ev.currentTarget as HTMLButtonElement;
      b.disabled = true;
      try {
         await api("POST", "/admin/api/timeline/rebuild");
         toast(T.rebuildQueued);
         setTimeout(reload, 800);
      } catch (e) {
         b.disabled = false;
         fail(e);
      }
   });
}

/** Overview: the feed's DLQ flag has its own Retry. */
export function initFeedFlag(): void {
   if ($("[data-timeline]")) return;
   for (const b of $$<HTMLButtonElement>("[data-feed-flag] [data-feed-retry]")) {
      b.addEventListener("click", async () => {
         b.disabled = true;
         try {
            await api("POST", "/admin/api/timeline/retry");
            toast(String(b.dataset.done));
            b.closest("[data-feed-flag]")?.remove();
         } catch {
            toast(String(b.dataset.failed), "bad");
            b.disabled = false;
         }
      });
   }
}
