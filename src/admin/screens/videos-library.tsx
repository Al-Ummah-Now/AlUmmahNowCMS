/** @jsxImportSource hono/jsx */
/**
 * Videos: the CMS video library (docs/specs/WWW-PAGES.md, src/lib/library.ts). Every video, playlist
 * and channel an editor added in the CMS, newest first. What /videos on www lists. Add from the
 * picker, set the language, delete (soft: Recently deleted, 30 days; it leaves /videos only).
 * Behaviour: src/admin/client/library.ts.
 */
import type { Env } from "../../env.ts";
import { libraryRefs, LIBRARY_PAGE_SIZE, listLibrary, type LibraryKind } from "../../lib/library.ts";
import { Icon, type IconName } from "../ui/icons.tsx";
import { Autocomplete, comboboxProps } from "../ui/autocomplete.tsx";
import { ConfirmDialog } from "../ui/dialogs.tsx";
import { Empty, PageHead, type View } from "../ui/layout.tsx";
import { I18nScript, LocalTime } from "../ui/parts.tsx";
import { PickerDialog } from "../ui/picker.tsx";

const KIND_ICON: Record<LibraryKind, IconName> = { video: "film", playlist: "playlist", channel: "users" };

export async function libraryVideosScreen(v: View, env: Env, p: { q: string; kind: LibraryKind | null; page: number }, videosWebUrl: string) {
   const { t } = v;
   const L = t.library2;
   const [res, refs] = await Promise.all([listLibrary(env, p), libraryRefs(env)]);
   const pages = Math.max(1, Math.ceil(res.total / LIBRARY_PAGE_SIZE));
   const kindLabel = (k: LibraryKind) => (k === "playlist" ? t.timeline.kindPlaylist : k === "channel" ? t.timeline.kindChannel : t.timeline.kindVideo);
   const qs = (o: Partial<typeof p>) => {
      const n = { ...p, ...o };
      const u = new URLSearchParams({ ...(n.q ? { q: n.q } : {}), ...(n.kind ? { kind: n.kind } : {}), ...(n.page > 1 ? { page: String(n.page) } : {}) }).toString();
      return `/videos${u ? `?${u}` : ""}`;
   };
   const watch = (k: LibraryKind, id: string) => `${videosWebUrl}/${k === "video" ? "watch" : k}/${encodeURIComponent(id)}`;
   return (
      <>
         <I18nScript
            nonce={v.nonce}
            strings={{ failed: t.common.failed, saved: L.saved, added: L.added, already: L.already, deleted: L.deleted, deleteTitle: L.deleteTitle, deleteBody: L.deleteBody, delete: L.delete, picker: t.picker }}
         />
         <PageHead title={L.title} intro={L.intro}>
            <a class="btn ghost" href={`${v.wwwUrl}/${v.prefs.lang}/videos/`} target="_blank" rel="noopener">
               <Icon name="external" size={18} class="flip" /> {L.openOnSite}
            </a>
            <button class="btn primary" type="button" data-library-add aria-haspopup="dialog" data-picker-added={refs.join(" ")}>
               <Icon name="film" size={18} /> {L.add}
            </button>
         </PageHead>
         <form class="toolbar" method="get" action="/videos" role="search">
            <Autocomplete kind="library" listId="lib-q-list" label={L.search}>
               <div class="search">
                  <label class="vh" for="lib-q">
                     {L.search}
                  </label>
                  <input id="lib-q" name="q" type="search" value={p.q} placeholder={L.search} maxlength={100} {...comboboxProps("lib-q-list")} />
                  {p.kind ? <input type="hidden" name="kind" value={p.kind} /> : null}
                  <button type="submit" aria-label={t.common.search}>
                     <Icon name="search" />
                  </button>
               </div>
            </Autocomplete>
            <div class="seg" role="group" aria-label={t.common.filters}>
               {([null, "video", "playlist", "channel"] as const).map((k) => (
                  <a href={qs({ kind: k, page: 1 })} aria-current={p.kind === k ? "true" : undefined}>
                     {k ? kindLabel(k) : t.common.all}
                  </a>
               ))}
            </div>
            {p.q || p.kind ? (
               <a class="btn ghost sm" href="/videos">
                  {t.common.clear}
               </a>
            ) : null}
         </form>
         <p class="muted" role="status" style="margin:0 0 12px;font-size:14px">
            {t.common.results(res.total)}
         </p>
         {res.items.length ? (
            <ol class="rows vrows" data-library>
               {res.items.map((r, i) => (
                  <li class="row vrow card" data-id={String(r.id)} data-title={r.title}>
                     <a class="vthumb" href={watch(r.kind, r.ref_id)} target="_blank" rel="noopener">
                        <span class="vh">{`${t.videos.watch}: ${r.title}`}</span>
                        {r.thumb ? <img src={r.thumb} alt="" loading={i < 4 ? "eager" : "lazy"} width={320} height={180} /> : <Icon name={KIND_ICON[r.kind]} size={28} />}
                        <span class="vkind">
                           <Icon name={KIND_ICON[r.kind]} size={14} /> {kindLabel(r.kind)}
                        </span>
                     </a>
                     <div class="vbody stack" style="gap:8px">
                        <div>
                           <div class="li-title" dir="auto">
                              {r.title}
                           </div>
                           <div class="li-meta">
                              {r.channel ? <span dir="auto">{r.channel}</span> : null}
                              <span>
                                 {L.addedOn} <LocalTime iso={r.added_at} lang={v.prefs.lang} />
                                 {r.added_by ? (
                                    <>
                                       {" "}
                                       · <span dir="ltr">{r.added_by}</span>
                                    </>
                                 ) : null}
                              </span>
                              {r.unavailable ? <span class="badge draft">{t.timeline.unavailable}</span> : null}
                           </div>
                           <div class="li-meta">
                              <span>{L.usedOn}</span>
                              {r.usedOn.length ? r.usedOn.map((u) => <span class="badge loc" dir="auto">{u === "home" ? L.home : u}</span>) : <span class="muted">{L.usedNowhere}</span>}
                           </div>
                        </div>
                        <div class="field" style="max-width:16rem">
                           <label for={`ll-${r.id}`}>{t.timeline.showFor}</label>
                           <select id={`ll-${r.id}`} class="select" data-library-locale>
                              {(["all", "en", "ar"] as const).map((l) => (
                                 <option value={l} selected={r.locale === l}>
                                    {t.locales[l]}
                                 </option>
                              ))}
                           </select>
                        </div>
                     </div>
                     <div class="vend">
                        <button type="button" class="btn ghost sm" data-library-delete aria-label={`${L.delete}: ${r.title}`}>
                           <Icon name="trash" size={16} /> {L.delete}
                        </button>
                     </div>
                  </li>
               ))}
            </ol>
         ) : (
            <Empty icon="play" title={p.q || p.kind ? t.common.emptySearch : L.empty}>
               {p.q || p.kind ? null : (
                  <button class="btn primary" type="button" data-library-add aria-haspopup="dialog" data-picker-added={refs.join(" ")}>
                     <Icon name="film" size={18} /> {L.add}
                  </button>
               )}
            </Empty>
         )}
         {pages > 1 ? (
            <nav class="pager" aria-label={t.common.page(p.page, pages)}>
               {p.page > 1 ? (
                  <a class="btn sm" href={qs({ page: p.page - 1 })} rel="prev">
                     <Icon name="chevronStart" size={16} class="flip" /> {t.common.prev}
                  </a>
               ) : (
                  <span />
               )}
               <span class="muted">{t.common.page(p.page, pages)}</span>
               {p.page < pages ? (
                  <a class="btn sm" href={qs({ page: p.page + 1 })} rel="next">
                     {t.common.next} <Icon name="chevronEnd" size={16} class="flip" />
                  </a>
               ) : (
                  <span />
               )}
            </nav>
         ) : null}
         <PickerDialog v={v} kinds={["video", "playlist", "channel"]} />
         <ConfirmDialog v={v} title={L.deleteTitle} body={L.deleteBody} ok={L.delete} reason />
      </>
   );
}
