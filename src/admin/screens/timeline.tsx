/** @jsxImportSource hono/jsx */
/**
 * Home timeline (www's home page): pinned items in their order, then everything else newest first,
 * with hidden and scheduled items marked; add a post or a video, pin, reorder pins, hide, remove;
 * recent changes (who, when); the KV publishing state. Behaviour: src/admin/client/timeline.ts.
 */
import { adminTimeline, postCounts, recentChanges, type AdminEntry, type Change } from "../../lib/feed/admin.ts";
import { feedStatus, type FeedStatus } from "../../lib/feed/jobs.ts";
import { relative } from "../format.ts";
import { Icon, type IconName } from "../ui/icons.tsx";
import { Empty, isAdmin, PageHead, type View } from "../ui/layout.tsx";
import { ConfirmDialog, I18nScript, LocalTime } from "../ui/parts.tsx";
import { PickerDialog } from "../ui/picker.tsx";

const KIND_ICON: Record<string, IconName> = { article: "newspaper", cards: "images", video: "film", playlist: "playlist" };

function kindLabel(v: View, e: AdminEntry): string {
   const t = v.t.timeline;
   return e.type === "post" ? (e.kind === "cards" ? t.kindCards : t.kindPost) : e.kind === "playlist" ? t.kindPlaylist : t.kindVideo;
}

/** Date input value (YYYY-MM-DD, UTC) of an ISO date. */
const dateInput = (iso: string) => iso.slice(0, 10);

function Entry(props: { v: View; e: AdminEntry; pinned: boolean; videosWebUrl: string; index: number }) {
   const { v, e, pinned } = props;
   const t = v.t.timeline;
   const label = e.title || e.refId || e.key;
   const href = e.type === "post" ? `/posts/${e.id}` : `${props.videosWebUrl}/${e.kind === "playlist" ? "playlist" : "watch"}/${encodeURIComponent(e.refId ?? "")}`;
   const unavailable = e.unavailable;
   return (
      <li class={`row vrow card tl-row${e.hidden ? " is-hidden" : ""}`} data-key={e.key} data-title={label} draggable={pinned ? "true" : undefined}>
         {pinned ? (
            <span class="grip" aria-hidden="true">
               <Icon name="grip" size={18} />
            </span>
         ) : (
            <span class="tl-dot" aria-hidden="true" />
         )}
         <a class="vthumb" href={href} target={e.type === "video" ? "_blank" : undefined} rel={e.type === "video" ? "noopener" : undefined}>
            <span class="vh">{`${e.type === "post" ? t.edit : v.t.videos.watch}: ${label}`}</span>
            {e.thumb ? <img src={e.thumb} alt="" loading={props.index < 4 ? "eager" : "lazy"} width={320} height={180} /> : <Icon name={KIND_ICON[e.kind] ?? "file"} size={28} />}
            <span class="vkind">
               <Icon name={KIND_ICON[e.kind] ?? "file"} size={14} /> {kindLabel(v, e)}
            </span>
         </a>
         <div class="vbody stack" style="gap:8px">
            <div>
               <div class="li-title" dir="auto">
                  {e.type === "post" ? <a href={href}>{label}</a> : label}
               </div>
               <div class="li-meta">
                  <LocalTime iso={e.date} lang={v.prefs.lang} />
                  {e.type === "video" && e.channel ? <span dir="auto">{e.channel}</span> : null}
                  {e.type === "video" ? <span class="badge loc">{v.t.locales[(e.locale as "en" | "ar" | "all") ?? "all"]}</span> : null}
                  {e.hidden ? (
                     <span class="badge draft" data-hidden-badge>
                        {t.hidden}
                     </span>
                  ) : null}
                  {e.scheduled ? (
                     <span class="badge scheduled">
                        {t.scheduledFor} <LocalTime iso={e.publishAt} lang={v.prefs.lang} />
                     </span>
                  ) : null}
                  {unavailable ? <span class="badge draft">{t.unavailable}</span> : null}
               </div>
            </div>
            {e.type === "video" ? (
               <div class="row2" style="gap:12px">
                  <div class="field">
                     <label for={`td-${e.key}`}>{t.date}</label>
                     <input id={`td-${e.key}`} class="input" type="date" data-entry-field="entry_date" value={dateInput(e.date)} required aria-describedby={`tdh-${e.key}`} />
                     <p class="help" id={`tdh-${e.key}`}>
                        {t.dateHelp}
                     </p>
                  </div>
                  <div class="field">
                     <label for={`tl-${e.key}`}>{t.showFor}</label>
                     <select id={`tl-${e.key}`} class="select" data-entry-field="locale">
                        {(["all", "en", "ar"] as const).map((l) => (
                           <option value={l} selected={e.locale === l}>
                              {v.t.locales[l]}
                           </option>
                        ))}
                     </select>
                  </div>
                  <div class="field" style="grid-column:1/-1">
                     <label for={`to-${e.key}`}>{t.override}</label>
                     <input id={`to-${e.key}`} spellcheck={true} class="input" data-entry-field="title_override" value={e.titleOverride ?? ""} maxlength={200} dir="auto" />
                  </div>
               </div>
            ) : null}
         </div>
         <div class="vend">
            {pinned ? (
               <span class="row-tools">
                  <button type="button" class="btn ghost sm icon-only" data-move="up" aria-label={`${v.t.common.moveUp}: ${label}`} title={v.t.common.moveUp}>
                     <Icon name="up" size={18} />
                  </button>
                  <button type="button" class="btn ghost sm icon-only" data-move="down" aria-label={`${v.t.common.moveDown}: ${label}`} title={v.t.common.moveDown}>
                     <Icon name="down" size={18} />
                  </button>
               </span>
            ) : null}
            <button type="button" class="btn sm" data-pin={pinned ? "0" : "1"} aria-label={`${pinned ? t.unpin : t.pin}: ${label}`}>
               <Icon name="pin" size={16} /> {pinned ? t.unpin : t.pin}
            </button>
            <button type="button" class="btn sm" data-hide={e.hidden ? "0" : "1"} aria-pressed={e.hidden ? "true" : "false"} aria-label={`${e.hidden ? t.show : t.hide}: ${label}`}>
               <Icon name={e.hidden ? "eye" : "eyeOff"} size={16} /> {e.hidden ? t.show : t.hide}
            </button>
            <button type="button" class="btn ghost sm tl-remove" data-remove={e.type} aria-label={`${t.remove}: ${label}`}>
               <Icon name="x" size={16} /> {t.remove}
            </button>
         </div>
      </li>
   );
}

function Status(props: { v: View; s: FeedStatus }) {
   const { v, s } = props;
   const t = v.t.timeline;
   const text = s.full ? t.rebuildProgress(s.full.left, s.full.total) : s.pending ? t.statusPending(s.pending) : s.lastBuildAt ? t.statusOk(relative(s.lastBuildAt, v.prefs.lang)) : t.statusNever;
   return (
      <section class="card tl-status" aria-labelledby="tl-status-h">
         <div class="tl-status-row">
            <span class={`tl-led${s.deadAt ? " bad" : s.pending || s.full ? " busy" : ""}`} aria-hidden="true" />
            {/* 14rem basis: in a narrow column the button wraps below instead of squeezing the text to a word per line */}
            <div style="flex:1 1 14rem;min-width:0">
               <h2 id="tl-status-h" class="tl-status-h">
                  {t.status}
               </h2>
               <p class="muted" style="margin:2px 0 0" role="status" data-feed-status>
                  {text}
               </p>
            </div>
            {isAdmin(v) ? (
               <button type="button" class="btn sm" data-feed-rebuild aria-describedby="tl-rebuild-help">
                  <Icon name="refresh" size={16} /> {t.rebuild}
               </button>
            ) : null}
         </div>
         {s.deadAt ? (
            <div class="notice bad" role="alert" style="margin:12px 0 0;display:grid;gap:8px" data-feed-flag>
               <strong>{v.t.overview.feedFlag}</strong>
               <span>
                  {v.t.overview.feedFlagBody} <span dir="auto">{s.lastError ?? "—"}</span>
               </span>
               <button type="button" class="btn sm" data-feed-retry style="justify-self:start">
                  <Icon name="refresh" size={16} /> {v.t.overview.feedRetry}
               </button>
            </div>
         ) : null}
         {isAdmin(v) ? (
            <p class="help" id="tl-rebuild-help" style="margin:8px 0 0">
               {t.rebuildHelp}
            </p>
         ) : null}
      </section>
   );
}

function Changes(props: { v: View; items: Change[] }) {
   const { v } = props;
   const t = v.t.timeline;
   return (
      <section class="card stack" aria-labelledby="tl-changes-h">
         <h2 id="tl-changes-h">{t.changes}</h2>
         {props.items.length ? (
            <ol class="tl-changes">
               {props.items.map((c) => (
                  <li>
                     <span class="tl-who" dir="ltr">
                        {c.actor_email ?? "—"}
                     </span>{" "}
                     {t.actions[c.action] ?? c.action} {c.action !== "reorder" && c.action !== "rebuild" ? c.title ? <bdi dir="auto">{c.title}</bdi> : <span class="muted">{t.gone}</span> : null} · <LocalTime iso={c.created_at} lang={v.prefs.lang} />
                  </li>
               ))}
            </ol>
         ) : (
            <p class="muted" style="margin:0">
               {t.changesEmpty}
            </p>
         )}
      </section>
   );
}

export async function timelineScreen(v: View, env: Parameters<typeof adminTimeline>[0], locale: "en" | "ar", before: string | null, videosWebUrl: string) {
   const t = v.t.timeline;
   const [list, status, changes, counts] = await Promise.all([adminTimeline(env, locale, before), feedStatus(env.DB), recentChanges(env, 12), postCounts(env, locale)]);
   const lang = v.t.locales[locale];
   // The empty list says why it is empty, in the same terms as the "Add a post" chooser.
   const emptyTitle = list.pinned.length ? t.itemsAllPinned : t.itemsEmpty(lang);
   const emptyBody = list.pinned.length ? undefined : counts.published === 0 ? t.itemsNoPosts(lang) : counts.off > 0 ? t.itemsOff(counts.off) : undefined;
   const q = (extra = "") => `/timeline?locale=${locale}${extra}`;
   return (
      <>
         <I18nScript
            nonce={v.nonce}
            strings={{
               failed: v.t.common.failed,
               saved: t.saved,
               added: t.added,
               already: t.already,
               conflict: t.conflict,
               removePost: t.removePost,
               removeVideo: t.removeVideo,
               moved: t.moved(-1, -2).replace("-1", "{0}").replace("-2", "{1}"),
               candidatesNone: t.candidatesNone(lang),
               candidatesAllOn: t.candidatesAllOn(-1).replace("-1", "{0}"),
               candidatesAllOnOne: t.candidatesAllOn(1),
               candidatesNoMatch: t.candidatesNoMatch,
               add: t.add,
               rebuildQueued: t.rebuildQueued,
               retried: v.t.overview.feedRetried,
               required: v.t.common.required,
               picker: v.t.picker,
            }}
         />
         <PageHead title={t.title} intro={t.intro}>
            <button class="btn" type="button" data-tl-add-post aria-haspopup="dialog">
               <Icon name="newspaper" size={18} /> {t.addPost}
            </button>
            <button class="btn primary" type="button" data-tl-add-video aria-haspopup="dialog">
               <Icon name="film" size={18} /> {t.addVideo}
            </button>
         </PageHead>
         <div class="toolbar">
            <div class="seg" role="group" aria-label={v.t.common.language}>
               {(["en", "ar"] as const).map((l) => (
                  <a href={`/timeline?locale=${l}`} aria-current={l === locale ? "true" : undefined}>
                     {v.t.locales[l]}
                  </a>
               ))}
            </div>
            <a class="btn ghost sm" href={`${v.wwwUrl}/${locale}/`} target="_blank" rel="noopener">
               <Icon name="external" size={16} class="flip" /> {t.openSite}
            </a>
         </div>
         <div class="tl-layout" data-timeline data-locale={locale}>
            <div class="stack">
               {!before ? (
                  <section class="stack" aria-labelledby="tl-pinned-h">
                     <div>
                        <h2 id="tl-pinned-h" class="tl-h">
                           <Icon name="pin" size={18} /> {t.pinned}
                        </h2>
                        <p class="help" id="tl-pinned-help" style="margin:0">
                           {t.pinnedHelp} {v.t.common.dragHint}
                        </p>
                     </div>
                     {list.pinned.length ? (
                        <ol class="rows vrows" data-pins aria-describedby="tl-pinned-help">
                           {list.pinned.map((e, i) => (
                              <Entry v={v} e={e} pinned={true} videosWebUrl={videosWebUrl} index={i} />
                           ))}
                        </ol>
                     ) : (
                        <p class="muted tl-empty">{t.pinnedEmpty}</p>
                     )}
                  </section>
               ) : null}
               <section class="stack" aria-labelledby="tl-items-h">
                  <h2 id="tl-items-h" class="tl-h">
                     <Icon name="timeline" size={18} /> {t.items}
                  </h2>
                  {list.items.length ? (
                     <ol class="rows vrows tl-list" data-entries>
                        {list.items.map((e, i) => (
                           <Entry v={v} e={e} pinned={false} videosWebUrl={videosWebUrl} index={i + list.pinned.length} />
                        ))}
                     </ol>
                  ) : (
                     <Empty icon="timeline" title={emptyTitle} body={emptyBody} />
                  )}
                  {before || list.next ? (
                     <nav class="pager" aria-label={t.items}>
                        {before ? (
                           <a class="btn sm" href={q()}>
                              <Icon name="chevronStart" size={16} class="flip" /> {t.newest}
                           </a>
                        ) : null}
                        {list.next ? (
                           <a class="btn sm" href={q(`&before=${encodeURIComponent(list.next)}`)} rel="next">
                              {t.older} <Icon name="chevronEnd" size={16} class="flip" />
                           </a>
                        ) : null}
                     </nav>
                  ) : null}
               </section>
            </div>
            <aside class="stack sticky">
               <Status v={v} s={status} />
               <Changes v={v} items={changes} />
            </aside>
         </div>
         <dialog class="dlg" id="tl-posts" aria-labelledby="tl-posts-h">
            <div class="dlg-h">
               <h2 id="tl-posts-h">{t.candidates}</h2>
               <button class="ic" type="button" data-dlg-close aria-label={v.t.picker.close} style="color:inherit">
                  <Icon name="x" />
               </button>
            </div>
            <div class="dlg-b stack">
               <div class="search" style="background:var(--fanous-c-form-input-bg);box-shadow:inset 0 0 0 1px var(--fanous-c-form-input-border)">
                  <label class="vh" for="tl-q">
                     {t.candidatesHint}
                  </label>
                  <input id="tl-q" type="search" spellcheck={true} maxlength={100} placeholder={t.candidatesHint} autocomplete="off" dir="auto" lang={locale} style="color:var(--fanous-c-form-input-text)" />
                  <span aria-hidden="true" style="display:grid;place-items:center;padding-inline:10px">
                     <Icon name="search" />
                  </span>
               </div>
               <p class="muted" role="status" aria-live="polite" data-tl-cand-status style="margin:0" />
               <ul class="picker-results" data-tl-candidates />
            </div>
         </dialog>
         <PickerDialog v={v} kinds={["video", "playlist"]} />
         <ConfirmDialog v={v} title={t.remove} body="" ok={t.remove} okIcon="x" />
         <p class="vh" aria-live="polite" data-tl-live />
      </>
   );
}
