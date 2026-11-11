/** @jsxImportSource hono/jsx */
/**
 * The translation glossary (docs/TRANSLATION_FLAGS.md §4): preferred renderings that machine translation
 * uses. Editors and admins add terms; admins delete (soft, restorable for 30 days) and restore. Opens with
 * the newest terms listed; the search filters as you type (src/admin/client/glossary.ts).
 */
import { listEntries, type GlossaryEntry } from "../../lib/translation-flags/glossary.ts";
import { Icon } from "../ui/icons.tsx";
import { isAdmin, PageHead, type View } from "../ui/layout.tsx";
import { ConfirmDialog, I18nScript, LocalTime } from "../ui/parts.tsx";

const P0 = "{0}" as unknown as number;

/** Strings for the client (it renders rows after a search or an add with the same markup). */
export function glossaryClientStrings(v: View) {
   const g = v.t.glossary;
   return { ...g, failed: v.t.common.failed, locales: v.t.locales, admin: isAdmin(v), results: v.t.common.results(P0), result1: v.t.common.results(1), lang: v.prefs.lang };
}

export function GlossaryRow(props: { v: View; e: GlossaryEntry; deleted: boolean }) {
   const { v, e } = props;
   const g = v.t.glossary;
   const dir = (l: string) => (l === "ar" ? "rtl" : "ltr");
   return (
      <li class="li" data-gl-id={e.id}>
         <div class="li-body">
            <div class="gl-terms">
               <span lang={e.source_locale} dir={dir(e.source_locale)}>
                  {e.source_term}
               </span>
               <span aria-hidden="true">→</span>
               <span class="vh">{e.source_locale === "ar" ? g.arToEn : g.enToAr}</span>
               <span lang={e.target_locale} dir={dir(e.target_locale)}>
                  {e.target_term}
               </span>
            </div>
            <div class="li-meta">
               <span class="badge loc">{`${e.source_locale.toUpperCase()} → ${e.target_locale.toUpperCase()}`}</span>
               {e.flag_id ? <span class="badge trf">{g.fromFlag}</span> : null}
               {e.note ? <span dir="auto">{e.note}</span> : null}
               {props.deleted ? (
                  <span>{g.deletedBy.replace("{0}", e.deleted_by_email ?? "—")}</span>
               ) : e.created_by_email ? (
                  <span>{g.by.replace("{0}", e.created_by_email)}</span>
               ) : null}
               <LocalTime iso={new Date(props.deleted ? (e.deleted_at ?? e.updated_at) : e.created_at).toISOString()} lang={v.prefs.lang} />
            </div>
         </div>
         {isAdmin(v) ? (
            props.deleted ? (
               <button class="btn sm" type="button" data-gl-restore={e.id}>
                  <Icon name="refresh" size={16} /> {g.restore}
               </button>
            ) : (
               <button class="btn ghost sm" type="button" data-gl-delete={e.id} aria-label={`${g.delete}: ${e.source_term}`}>
                  <Icon name="trash" size={16} /> {g.delete}
               </button>
            )
         ) : (
            <span />
         )}
      </li>
   );
}

export async function glossaryScreen(v: View, db: D1Database, q: string, deleted: boolean) {
   const { t } = v;
   const g = t.glossary;
   const entries = await listEntries(db, { q, deleted }).catch(() => [] as GlossaryEntry[]);
   const from = v.prefs.lang === "ar" ? "en" : "ar";
   return (
      <>
         <I18nScript nonce={v.nonce} strings={{ glossary: glossaryClientStrings(v) }} />
         <PageHead title={g.title} intro={g.intro} />
         {isAdmin(v) ? (
            <div class="seg" role="group" aria-label={t.common.filters} style="margin-block-end:16px">
               <a href="/glossary" aria-current={deleted ? undefined : "true"}>
                  {g.live}
               </a>
               <a href="/glossary?deleted=1" aria-current={deleted ? "true" : undefined}>
                  {g.deleted}
               </a>
            </div>
         ) : null}
         {deleted ? (
            <p class="help">{g.deletedHelp}</p>
         ) : (
            <section class="card stack" aria-labelledby="gl-add-h" style="margin-block-end:16px">
               <h2 id="gl-add-h" style="margin:0">
                  {g.add}
               </h2>
               <form class="gl-form" data-gl-add novalidate>
                  <div class="field">
                     <label for="gl-dir">{g.direction}</label>
                     <select id="gl-dir" class="select" name="sourceLocale">
                        <option value="ar" selected={from === "ar"}>
                           {g.arToEn}
                        </option>
                        <option value="en" selected={from === "en"}>
                           {g.enToAr}
                        </option>
                     </select>
                  </div>
                  <div class="field">
                     <label for="gl-src">{g.source}</label>
                     <input id="gl-src" class="input" name="sourceTerm" maxlength={200} dir="auto" required />
                  </div>
                  <div class="field">
                     <label for="gl-tgt">{g.target}</label>
                     <input id="gl-tgt" class="input" name="targetTerm" maxlength={200} dir="auto" required />
                  </div>
                  <div class="field">
                     <label for="gl-note">{g.note}</label>
                     <input id="gl-note" class="input" name="note" maxlength={1000} dir="auto" />
                  </div>
                  <button class="btn primary" type="submit">
                     <Icon name="book" size={18} /> {g.add}
                  </button>
               </form>
               <p class="err" data-gl-err role="alert" hidden />
            </section>
         )}
         <form class="toolbar" method="get" action="/glossary" role="search" data-gl-search>
            <div class="search">
               <label class="vh" for="gl-q">
                  {g.search}
               </label>
               <input id="gl-q" name="q" type="search" value={q} placeholder={g.search} maxlength={100} autocomplete="off" aria-controls="gl-list" />
               {deleted ? <input type="hidden" name="deleted" value="1" /> : null}
               <button type="submit" aria-label={g.search}>
                  <Icon name="search" />
               </button>
            </div>
         </form>
         <p class="muted" role="status" aria-live="polite" style="margin:0 0 12px;font-size:14px" data-gl-count>
            {t.common.results(entries.length)}
         </p>
         <ul class="list gl-list" id="gl-list" aria-label={g.title} data-gl-list data-deleted={deleted ? "1" : ""} data-empty={q ? g.emptySearch : g.empty}>
            {entries.map((e) => (
               <GlossaryRow v={v} e={e} deleted={deleted} />
            ))}
         </ul>
         {entries.length ? null : (
            <p class="help" data-gl-empty>
               {q ? g.emptySearch : g.empty}
            </p>
         )}
         <ConfirmDialog v={v} title={g.deleteTitle} body={g.deleteBody} ok={g.delete} />
      </>
   );
}
