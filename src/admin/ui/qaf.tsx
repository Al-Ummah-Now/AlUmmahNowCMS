/** @jsxImportSource hono/jsx */
import { fill, formatDateTime, formatNumber } from "../../lib/format.ts";
import { QAF_GENRES } from "../../lib/qaf/genres.ts";
import type { QafStatus } from "../../lib/qaf/settings.ts";
import { Icon } from "./icons.tsx";
import type { View } from "./layout.tsx";

export function QafSettingsCard({ v, status }: { v: View; status: QafStatus }) {
   const t = v.t.qaf;
   return (
      <form class="card stack" data-qaf-settings aria-labelledby="qaf-settings-h" style="margin-block-end:24px">
         <h2 id="qaf-settings-h" style="margin:0">{t.settings}</h2>
         <p class="help">{t.settingsHelp}</p>
         <div><span class="badge loc">{status.configured ? t.connected : t.notSet}</span></div>
         {status.configured ? (
            <p>{fill(t.remaining, { n: formatNumber(status.remaining, v.prefs.lang, { useGrouping: v.prefs.lang !== "ar" }) }, v.prefs.lang)}{" "}
               <a href="https://qaf.ai/settings/usage" target="_blank" rel="noopener noreferrer nofollow">{t.accountUsage}</a>
            </p>
         ) : null}
         <div class="field" style="max-inline-size:440px">
            <label for="qaf-key">{status.configured ? t.replaceKey : t.key}</label>
            <input class="input" id="qaf-key" type="password" dir="ltr" autocomplete="new-password" maxlength={519} required />
         </div>
         <div class="ph-actions">
            <button class="btn primary" type="submit">{t.saveKey}</button>
            {status.configured ? <button class="btn" type="button" data-qaf-remove>{t.removeKey}</button> : null}
         </div>
         <p class="err" role="status" data-qaf-settings-error />
      </form>
   );
}

export function QafFailureCard({ v, status }: { v: View; status: QafStatus | null }) {
   if (!status?.issue) return null;
   const t = v.t.qaf;
   return (
      <section class="card stack" data-qaf-failure aria-labelledby="qaf-error-h">
         <h2 id="qaf-error-h">{t.connectionIssue}</h2>
         <p>{t.errors[status.issue]}</p>
         {status.retryAt && status.retryAt > Date.now() ? <p>{t.retryAt.replace("{time}", formatDateTime(status.retryAt, v.prefs.lang))}</p> : null}
         {status.requestId ? <p class="help">{t.requestId} <code dir="ltr">{status.requestId}</code></p> : null}
         <div class="ph-actions">
            <a class="btn" href="/ai-settings#qaf-settings-h">{t.settings}</a>
            {status.issue !== "week" && status.issue !== "sealed_key" ? <button class="btn" type="button" data-qaf-retry>{v.t.overview.retry}</button> : null}
         </div>
         <p class="err" role="status" data-qaf-settings-error />
      </section>
   );
}

export function QafCard({ v }: { v: View }) {
   return (
      <section class="card stack" aria-labelledby="qaf-card-h" data-qaf-card>
         <h2 id="qaf-card-h" style="margin:0">{v.t.qaf.title}</h2>
         <button type="button" class="btn" data-qaf-open><Icon name="search" size={18} /> {v.t.qaf.open}</button>
      </section>
   );
}

export function QafDialog({ v, canSuggest }: { v: View; canSuggest: boolean }) {
   const t = v.t.qaf;
   const lang = v.prefs.lang;
   return (
      <dialog class="dlg qaf-dialog" id="qaf-dialog" aria-labelledby="qaf-h">
         <form method="dialog" class="dlg-h">
            <h2 id="qaf-h">{t.title}</h2>
            <button class="btn ghost sm icon-only" aria-label={v.t.ai.close}><Icon name="x" size={18} /></button>
         </form>
         <div class="dlg-b stack">
            <form class="stack" data-qaf-search>
               <div class="field">
                  <label for="qaf-query">{t.topic}</label>
                  <div class="input qaf-query">
                     <input id="qaf-query" type="search" dir="auto" maxlength={2000} required autofocus />
                     <button class="ic" type="button" data-qaf-clear aria-label={t.clear} hidden><Icon name="x" size={18} /></button>
                  </div>
               </div>
               <details class="qaf-filters">
                  <summary>{t.filters}</summary>
                  <div class="stack">
                     <div class="field">
                        <label for="qaf-genre">{t.genre}</label>
                        <select id="qaf-genre" class="select">
                           <option value="">{t.anyGenre}</option>
                           {Object.entries(QAF_GENRES).map(([slug, names]) => <option value={slug}>{names[lang === "ar" ? 1 : 0]}</option>)}
                        </select>
                     </div>
                     <div class="qaf-grid">
                        {(["author", "book"] as const).map((type) => (
                           <div class="field" data-qaf-catalog={type}>
                              <label for={`qaf-${type}`}>{t[type]}</label>
                              <div class="qaf-lookup">
                                 <input id={`qaf-${type}`} class="input" type="search" dir="auto" maxlength={200} />
                                 <button class="btn" type="button" data-qaf-lookup aria-label={type === "author" ? t.lookupAuthor : t.lookupBook}>{t.lookup}</button>
                              </div>
                              <label class="vh" for={`qaf-${type}-id`}>{type === "author" ? t.chooseAuthor : t.chooseBook}</label>
                              <select id={`qaf-${type}-id`} class="select" hidden />
                              <p class="help" role="status" />
                           </div>
                        ))}
                     </div>
                     <div class="qaf-grid">
                        <div class="field">
                           <label for="qaf-min">{t.fromYear}</label>
                           <input id="qaf-min" class="input" inputmode="numeric" pattern="[0-9]+" maxlength={4} />
                        </div>
                        <div class="field">
                           <label for="qaf-max">{t.toYear}</label>
                           <input id="qaf-max" class="input" inputmode="numeric" pattern="[0-9]+" maxlength={4} />
                        </div>
                     </div>
                  </div>
               </details>
               <div class="ph-actions">
                  <button class="btn primary" type="submit"><Icon name="search" size={18} /> {t.search}</button>
                  {canSuggest ? <button class="btn" type="button" data-qaf-suggest><Icon name="sparkle" size={18} /> {t.suggest}</button> : null}
               </div>
            </form>
            <p class="help" role="status" data-qaf-message />
            <div class="stack" data-qaf-results />
         </div>
      </dialog>
   );
}
