/** @jsxImportSource hono/jsx */
/**
 * Recently deleted (admins, docs/SOFT_DELETE.md): what was soft-deleted, by whom, when, why, and
 * how long until the cleanup purges it. Restore and "Delete permanently now" (type to confirm)
 * are in-app dialogs (src/admin/client/trash.ts).
 */
import { listTrash, TRASH_KINDS, type TrashKind, type TrashListItem } from "../../lib/trash.ts";
import { PURGE_CONFIRM, TRASH_PAGE_SIZE } from "../trash-api.ts";
import { Icon } from "../ui/icons.tsx";
import { Empty, PageHead, type View } from "../ui/layout.tsx";
import { I18nScript, LocalTime } from "../ui/parts.tsx";

function Remaining(props: { v: View; item: TrashListItem }) {
   const tr = props.v.t.trash;
   if (props.item.days_left === null) {
      return <span class="badge scheduled">{props.item.purge_requested_by ? tr.queuedBy(props.item.purge_requested_by) : tr.queued}</span>;
   }
   return <span class="badge draft">{props.item.days_left > 0 ? tr.daysLeft(props.item.days_left) : tr.lastDay}</span>;
}

export async function trashScreen(v: View, db: D1Database, kind: TrashKind | null, page: number) {
   const { t } = v;
   const tr = t.trash;
   const res = await listTrash(db, { kind, limit: TRASH_PAGE_SIZE, offset: (page - 1) * TRASH_PAGE_SIZE });
   const pages = Math.max(1, Math.ceil(res.total / TRASH_PAGE_SIZE));
   const href = (k: TrashKind | null, p = 1) => `/deleted${k || p > 1 ? "?" : ""}${new URLSearchParams({ ...(k ? { kind: k } : {}), ...(p > 1 ? { page: String(p) } : {}) }).toString()}`;
   return (
      <>
         <I18nScript nonce={v.nonce} strings={{ restored: tr.restored, purgeQueued: tr.purgeQueued, conflict: tr.conflict, purging: tr.purging, failed: t.common.failed, word: tr.purgeWord, confirm: PURGE_CONFIRM }} />
         <PageHead title={tr.title} intro={tr.intro} />
         <div class="seg" role="group" aria-label={t.common.filters} style="margin-block-end:16px;flex-wrap:wrap">
            <a href={href(null)} aria-current={kind === null ? "true" : undefined}>
               {tr.all}
            </a>
            {TRASH_KINDS.map((k) => (
               <a href={href(k)} aria-current={kind === k ? "true" : undefined}>
                  {tr.kinds[k]}
               </a>
            ))}
         </div>
         {res.items.length ? (
            <ul class="list" aria-label={tr.title} data-trash>
               {res.items.map((x) => (
                  <li class="li" style="grid-template-columns:minmax(0,1fr) auto" data-trash-id={String(x.id)}>
                     <div class="li-body">
                        <div class="li-title" dir="auto">
                           {x.label || tr.untitled}
                        </div>
                        <div class="li-meta">
                           <span class="badge loc">{tr.kindOne[x.kind] ?? x.kind}</span>
                           {x.locale && (x.locale === "en" || x.locale === "ar") ? <span>{t.locales[x.locale]}</span> : null}
                           <span>
                              {tr.deletedBy}: <span dir="ltr">{x.deleted_by ?? tr.unknown}</span>
                           </span>
                           <LocalTime iso={x.deleted_at} lang={v.prefs.lang} />
                           <Remaining v={v} item={x} />
                        </div>
                        {x.reason ? (
                           <p class="muted" style="margin:6px 0 0" dir="auto">
                              {tr.reason}: {x.reason}
                           </p>
                        ) : null}
                        {x.purge_error ? (
                           <p class="err" role="status" style="margin:6px 0 0">
                              {tr.purgeFailed}
                           </p>
                        ) : null}
                     </div>
                     <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
                        <button type="button" class="btn sm" data-trash-restore aria-label={`${tr.restore}: ${x.label || tr.untitled}`}>
                           <Icon name="refresh" size={16} /> {tr.restore}
                        </button>
                        {x.days_left !== null ? (
                           <button type="button" class="btn danger sm" data-trash-purge aria-label={`${tr.purge}: ${x.label || tr.untitled}`}>
                              <Icon name="trash" size={16} /> {tr.purge}
                           </button>
                        ) : null}
                     </div>
                  </li>
               ))}
            </ul>
         ) : (
            <Empty icon="trash" title={tr.empty} />
         )}
         {pages > 1 ? (
            <nav class="pager" aria-label={tr.title} style="display:flex;gap:8px;margin-block-start:16px">
               {page > 1 ? (
                  <a class="btn sm" href={href(kind, page - 1)}>
                     {tr.newer}
                  </a>
               ) : null}
               {page < pages ? (
                  <a class="btn sm" href={href(kind, page + 1)}>
                     {tr.older}
                  </a>
               ) : null}
            </nav>
         ) : null}
         <dialog class="dlg sm" id="trash-restore" aria-labelledby="trash-restore-h">
            <form method="dialog">
               <div class="dlg-h">
                  <h2 id="trash-restore-h">{tr.restoreTitle}</h2>
               </div>
               <div class="dlg-b">
                  <p style="margin:0">{tr.restoreBody}</p>
               </div>
               <div class="dlg-f">
                  <button class="btn" value="cancel" autofocus>
                     {t.common.cancel}
                  </button>
                  <button class="btn primary" value="ok">
                     <Icon name="refresh" size={16} /> {tr.restore}
                  </button>
               </div>
            </form>
         </dialog>
         <dialog class="dlg sm" id="trash-purge" aria-labelledby="trash-purge-h" aria-describedby="trash-purge-b">
            <form method="dialog">
               <div class="dlg-h">
                  <h2 id="trash-purge-h">{tr.purgeTitle}</h2>
               </div>
               <div class="dlg-b">
                  <p style="margin:0" id="trash-purge-b">
                     {tr.purgeBody}
                  </p>
                  <div class="field" style="margin-block-start:14px">
                     <label for="trash-purge-word">{tr.purgeType(tr.purgeWord)}</label>
                     <input id="trash-purge-word" class="input" autocomplete="off" spellcheck={false} dir="auto" data-purge-word />
                  </div>
               </div>
               <div class="dlg-f">
                  <button class="btn" value="cancel" autofocus>
                     {t.common.cancel}
                  </button>
                  <button class="btn danger" value="ok" disabled data-purge-ok>
                     <Icon name="trash" size={16} /> {tr.purge}
                  </button>
               </div>
            </form>
         </dialog>
      </>
   );
}
