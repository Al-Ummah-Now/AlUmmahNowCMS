/** @jsxImportSource hono/jsx */
/** Content history (#8): the versions of a page or post, what changed in each, and restore. */
import { lineDiff, listRevisions, previousRevision, REVISIONS_PAGE, RESTORABLE, type Revision, getRevision } from "../../lib/revisions.ts";
import type { Data, Row } from "../data.ts";
import { Icon } from "../ui/icons.tsx";
import { PageHead, type View } from "../ui/layout.tsx";
import { I18nScript, LocalTime } from "../ui/parts.tsx";
import type { ContentKind } from "./content.tsx";

/** Long text: shown as a line diff. Everything else: before / after. */
const LONG = new Set(["body", "summary", "excerpt", "seo_description"]);
const DATES = new Set(["publish_at", "published_at"]);
/** Unchanged lines kept around a change in a line diff. */
const CONTEXT = 2;

function fieldOrder(kind: ContentKind, fields: string[]): string[] {
   const known = [...RESTORABLE[kind], "status", "publish_at", "published_at", "translation_key", "locale"];
   return [...fields].sort((a, b) => (known.indexOf(a) === -1 ? 99 : known.indexOf(a)) - (known.indexOf(b) === -1 ? 99 : known.indexOf(b)));
}

function text(v: unknown): string {
   if (v === null || v === undefined) return "";
   if (typeof v === "string") {
      if (v.startsWith("[")) {
         try {
            const arr = JSON.parse(v);
            if (Array.isArray(arr)) return arr.join(", ");
         } catch {
            /* plain text */
         }
      }
      return v;
   }
   if (Array.isArray(v)) return v.join(", ");
   return String(v);
}

function Value(props: { v: View; field: string; value: unknown; lang: string }) {
   const { t } = props.v;
   const val = props.value;
   if (val === null || val === undefined || val === "") return <em class="muted">{t.history.empty}</em>;
   if (DATES.has(props.field)) return <LocalTime iso={val} lang={props.v.prefs.lang} />;
   if (props.field === "show_in_sitemap") return <span>{val === true || val === 1 || val === "1" ? t.history.yes : t.history.no}</span>;
   if (props.field === "status") return <span>{val === "published" ? t.status.published : t.status.draft}</span>;
   const dir = props.field === "slug" ? "ltr" : "auto";
   return (
      <span lang={props.field === "slug" ? undefined : props.lang} dir={dir}>
         {text(val)}
      </span>
   );
}

function LineDiff(props: { v: View; before: string; after: string; lang: string }) {
   const lines = lineDiff(props.before, props.after);
   const keep = lines.map((l, i) => l.op !== "same" || lines.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some((x) => x.op !== "same"));
   const out: unknown[] = [];
   let skipped = 0;
   lines.forEach((l, i) => {
      if (!keep[i]) {
         skipped++;
         return;
      }
      if (skipped) {
         out.push(<li class="dl skip">{props.v.t.history.unchangedLines(skipped)}</li>);
         skipped = 0;
      }
      out.push(
         <li class={`dl ${l.op}`}>
            <span class="dl-m" aria-hidden="true">
               {l.op === "add" ? "+" : l.op === "del" ? "−" : ""}
            </span>
            {l.op === "add" ? <ins>{l.text || " "}</ins> : l.op === "del" ? <del>{l.text || " "}</del> : <span>{l.text || " "}</span>}
         </li>,
      );
   });
   if (skipped) out.push(<li class="dl skip">{props.v.t.history.unchangedLines(skipped)}</li>);
   return (
      <ol class="diff" lang={props.lang} dir="auto">
         {out}
      </ol>
   );
}

function FieldChange(props: { v: View; kind: ContentKind; field: string; before: Row | null; after: Row; lang: string }) {
   const { t } = props.v;
   const { field } = props;
   const label = t.history.field[field] ?? field;
   const b = props.before?.[field];
   const a = props.after[field];
   return (
      <section class="fc" aria-label={label}>
         <h3>{label}</h3>
         {LONG.has(field) && props.before ? (
            <LineDiff v={props.v} before={text(b)} after={text(a)} lang={props.lang} />
         ) : (
            <dl class="ba">
               {props.before ? (
                  <>
                     <dt>{t.history.before}</dt>
                     <dd class="was">
                        <Value v={props.v} field={field} value={b} lang={props.lang} />
                     </dd>
                  </>
               ) : null}
               <dt>{t.history.after}</dt>
               <dd class="now">
                  <Value v={props.v} field={field} value={a} lang={props.lang} />
               </dd>
            </dl>
         )}
      </section>
   );
}

function who(v: View, r: Revision) {
   return r.actor_email ?? v.t.history.unknown;
}

export async function historyScreen(v: View, data: Data, kind: ContentKind, id: number, page: number, revParam: number | null) {
   const { t } = v;
   const row = await data.one(kind, id);
   if (!row) return null;
   const list = await listRevisions(data.db, kind, id, page);
   const pages = Math.max(1, Math.ceil(list.total / REVISIONS_PAGE));
   const latest = page === 1 ? list.items[0] : (await listRevisions(data.db, kind, id, 1, 1)).items[0];
   let selected: Revision | null = list.items[0] ?? null;
   if (revParam) {
      const r = await getRevision(data.db, revParam);
      selected = r && r.entity === kind && r.entity_id === id ? r : selected;
   }
   const [prev, source] = await Promise.all([
      selected ? previousRevision(data.db, selected) : Promise.resolve(null),
      selected?.restored_from ? getRevision(data.db, selected.restored_from) : Promise.resolve(null),
   ]);
   const lang = String(row.locale ?? "en");
   const base = `/${kind}/${id}/history`;
   const href = (p: number, rev?: number) => `${base}?${new URLSearchParams({ ...(p > 1 ? { page: String(p) } : {}), ...(rev ? { rev: String(rev) } : {}) })}`.replace(/\?$/, "");
   const isCurrent = !!selected && !!latest && selected.id === latest.id;
   const fields = selected ? fieldOrder(kind, selected.changed) : [];

   return (
      <>
         <I18nScript nonce={v.nonce} strings={{ conflict: t.common.conflict, slugTaken: t.content.slugTaken, failed: t.common.failed }} />
         <PageHead title={t.history.title} intro={t.history.intro} back={{ href: `/${kind}/${id}`, label: String(row.title ?? t.entities[kind].one) }} />
         {list.total === 0 ? (
            <p class="notice">
               <Icon name="info" /> {t.history.none}
            </p>
         ) : (
            <div class="split" data-history={kind} data-id={String(id)} data-updated={row.updated_at == null ? "" : String(row.updated_at)}>
               <section class="card stack" aria-labelledby="rev-h" data-revision={selected ? String(selected.id) : ""}>
                  {selected ? (
                     <>
                        <div class="rev-head">
                           <div>
                              <h2 id="rev-h" style="margin:0">
                                 {t.history.version(selected.version)}
                              </h2>
                              <p class="li-meta" style="margin:4px 0 0">
                                 <span class={`badge act-${selected.action}`}>{t.history.actions[selected.action]}</span>
                                 <span>
                                    {t.history.by} <strong>{who(v, selected)}</strong>
                                 </span>
                                 <LocalTime iso={selected.created_at} lang={v.prefs.lang} />
                              </p>
                              {source ? (
                                 <p class="help" style="margin-top:6px">
                                    <Icon name="swap" size={14} class="h-ic" />
                                    <a href={href(page, source.id)}>{t.history.restoredFrom(source.version)}</a>
                                 </p>
                              ) : null}
                           </div>
                           {isCurrent ? (
                              <span class="badge published">{t.history.current}</span>
                           ) : (
                              <button class="btn primary" type="button" data-restore={String(selected.id)} data-restore-version={String(selected.version)}>
                                 <Icon name="swap" size={18} /> {t.history.restore}
                              </button>
                           )}
                        </div>
                        {isCurrent ? null : <p class="help">{t.history.restoreNote}</p>}
                        <h3 class="sub-h">{t.history.changed}</h3>
                        {!prev ? <p class="help">{t.history.first}</p> : null}
                        {fields.length ? (
                           fields.map((f) => <FieldChange v={v} kind={kind} field={f} before={prev?.snapshot ?? null} after={selected!.snapshot} lang={lang} />)
                        ) : (
                           <p class="muted" style="margin:0">
                              {t.history.nothingChanged}
                           </p>
                        )}
                     </>
                  ) : null}
               </section>
               <aside class="card stack" aria-labelledby="vers-h">
                  <h2 id="vers-h" style="margin:0">
                     {t.history.versions}
                  </h2>
                  <ol class="revs">
                     {list.items.map((r) => (
                        <li>
                           <a class="rev" href={href(page, r.id)} aria-current={selected?.id === r.id ? "true" : undefined}>
                              <span class="rev-n">{r.version}</span>
                              <span class="rev-b">
                                 <span class="rev-t">
                                    {t.history.actions[r.action]} · <LocalTime iso={r.created_at} lang={v.prefs.lang} />
                                 </span>
                                 <span class="rev-w">{who(v, r)}</span>
                                 {r.changed.length && r.version > 1 ? (
                                    <span class="rev-f">{fieldOrder(kind, r.changed).map((f) => t.history.field[f] ?? f).join(" · ")}</span>
                                 ) : null}
                              </span>
                           </a>
                        </li>
                     ))}
                  </ol>
                  {pages > 1 ? (
                     <nav class="pager" aria-label={t.common.page(page, pages)}>
                        {page > 1 ? (
                           <a class="btn sm" href={href(page - 1)} rel="prev">
                              <Icon name="chevronStart" size={16} class="flip" /> {t.common.prev}
                           </a>
                        ) : (
                           <span />
                        )}
                        <span class="muted">{t.common.page(page, pages)}</span>
                        {page < pages ? (
                           <a class="btn sm" href={href(page + 1)} rel="next">
                              {t.common.next} <Icon name="chevronEnd" size={16} class="flip" />
                           </a>
                        ) : (
                           <span />
                        )}
                     </nav>
                  ) : null}
               </aside>
            </div>
         )}
         <dialog class="dlg sm" id="restore-dlg" aria-labelledby="restore-h">
            <form method="dialog">
               <div class="dlg-h">
                  <h2 id="restore-h">{t.history.confirmTitle}</h2>
               </div>
               <div class="dlg-b">
                  <p style="margin:0">{t.history.confirmBody}</p>
               </div>
               <div class="dlg-f">
                  <button class="btn" value="cancel" autofocus>
                     {t.common.cancel}
                  </button>
                  <button class="btn primary" value="ok">
                     <Icon name="swap" size={16} /> {t.history.restore}
                  </button>
               </div>
            </form>
         </dialog>
      </>
   );
}

/** The editor's History card: the latest versions and a link to the full history. */
export async function historyCard(props: { v: View; data: Data; kind: ContentKind; id: number }) {
   const { t } = props.v;
   const list = await listRevisions(props.data.db, props.kind, props.id, 1, 3);
   const base = `/${props.kind}/${props.id}/history`;
   return (
      <section class="card stack" aria-labelledby="hist-h" data-history-card>
         <h2 id="hist-h">{t.history.title}</h2>
         {list.items.length ? (
            <>
               <ol class="revs">
                  {list.items.map((r) => (
                     <li>
                        <a class="rev" href={`${base}?rev=${r.id}`}>
                           <span class="rev-n">{r.version}</span>
                           <span class="rev-b">
                              <span class="rev-t">
                                 {t.history.actions[r.action]} · <LocalTime iso={r.created_at} lang={props.v.prefs.lang} />
                              </span>
                              <span class="rev-w">{r.actor_email ?? t.history.unknown}</span>
                           </span>
                        </a>
                     </li>
                  ))}
               </ol>
               <a class="btn sm" href={base}>
                  <Icon name="clock" size={16} /> {t.history.seeAll(list.total)}
               </a>
            </>
         ) : (
            <p class="help">{t.history.none}</p>
         )}
      </section>
   );
}
