/** @jsxImportSource hono/jsx */
/**
 * AI writing assist in the page/post editor (docs/AI_ASSIST_SPEC.md §1, §8). Server-rendered
 * skeletons; src/admin/client/ai.ts fills them. Rendered only when AI assist is configured, except
 * the admin-only "isn't set up" card. Editors see nothing when it isn't configured.
 */
import { Icon } from "./icons.tsx";
import { isAdmin, type View } from "./layout.tsx";

type Locale = "en" | "ar";

/** Strings the client needs (no functions: JSON). */
export function aiClientStrings(v: View) {
   const a = v.t.ai;
   return {
      translating: a.translating,
      suggesting: a.suggesting,
      checking: a.checking,
      filled: a.filled,
      warnings: a.warnings,
      copied: a.copied,
      nothing: a.nothing,
      suggestion: a.suggestion,
      verify: a.verify,
      severity: a.severity,
      categories: a.categories,
      errors: a.errors,
      saveFirst: a.saveFirst,
   };
}

/** Side-panel card: translate, or the admin-only "not set up" notice. */
export function AiCard(props: { v: View; locale: Locale; other: Locale; saved: boolean; siblingId: number | null }) {
   const { v, other } = props;
   const a = v.t.ai;
   if (!v.ai) {
      if (!isAdmin(v)) return null;
      return (
         <section class="card flat stack ai-off" aria-labelledby="ai-h" data-ai-off style="gap:10px">
            <h2 id="ai-h" style="margin:0;display:flex;align-items:center;gap:8px">
               <Icon name="sparkle" size={18} /> {a.card}
            </h2>
            <p class="notice" role="note" style="margin:0">
               <Icon name="info" size={18} />
               <span>
                  <strong>{a.notSetUp}</strong>
                  <br />
                  <span class="muted">{a.notSetUpBody}</span>
               </span>
            </p>
         </section>
      );
   }
   const otherName = v.t.locales[other];
   return (
      <section class="card stack" aria-labelledby="ai-h" data-ai-card style="gap:12px">
         <h2 id="ai-h" style="margin:0;display:flex;align-items:center;gap:8px">
            <Icon name="sparkle" size={18} /> {a.card}
         </h2>
         <p class="help">{a.intro}</p>
         <button class="btn" type="button" data-ai-translate data-target={other} data-sibling={props.siblingId ? String(props.siblingId) : ""}>
            <Icon name="languages" size={18} /> {a.translateTo(otherName)}
         </button>
         <p class="help ai-status" data-ai-status="translate" role="status" aria-live="polite" />
      </section>
   );
}

export function AiSeoButton(props: { v: View }) {
   if (!props.v.ai) return null;
   return (
      <button class="btn sm" type="button" data-ai-seo aria-label={props.v.t.ai.suggestSeo}>
         <Icon name="sparkle" size={16} /> {props.v.t.ai.suggest}
      </button>
   );
}

/** Suggestion rows under the SEO fields (hidden until a result arrives). */
export function AiSeoPanel(props: { v: View; locale: Locale }) {
   const { v, locale } = props;
   if (!v.ai) return null;
   const a = v.t.ai;
   const row = (key: string, label: string, max: number, target?: string, help?: string) => (
      <div class="field ai-sugg" data-sugg={key}>
         <span style="display:flex;justify-content:space-between;gap:8px;align-items:center">
            <label for={`ai-${key}`}>{a.suggestedField(label)}</label>
            <span class="muted" style="font-size:12px" data-counter={`ai-${key}`} data-max={String(max)} aria-hidden="true" />
         </span>
         <div class="ai-sugg-row">
            <textarea id={`ai-${key}`} class="textarea" rows={2} lang={locale} dir="auto" style="min-height:60px" aria-describedby={help ? `ai-${key}-help` : undefined} />
            {target ? (
               <button class="btn sm" type="button" data-use={target} data-from={`ai-${key}`} aria-label={`${a.use}: ${label}`}>
                  {a.use}
               </button>
            ) : (
               <button class="btn sm" type="button" data-copy={`ai-${key}`} aria-label={`${a.copy}: ${label}`}>
                  {a.copy}
               </button>
            )}
         </div>
         {help ? (
            <p class="help" id={`ai-${key}-help`}>
               {help}
            </p>
         ) : null}
      </div>
   );
   return (
      <>
         <p class="help ai-status" data-ai-status="seo" role="status" aria-live="polite" />
         <div class="card flat stack" data-ai-seo-panel hidden aria-labelledby="ai-seo-h" style="gap:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
               <h3 id="ai-seo-h" style="margin:0;display:flex;align-items:center;gap:6px">
                  <Icon name="sparkle" size={16} /> {a.suggestions}
               </h3>
               <span class="ph-actions">
                  <button class="btn sm primary" type="button" data-use-all>
                     {a.useAll}
                  </button>
                  <button class="btn sm ghost" type="button" data-ai-seo-discard>
                     {a.discard}
                  </button>
               </span>
            </div>
            {row("seo_title", v.t.content.seoTitle, 60, "f-seo-title")}
            {row("seo_description", v.t.content.seoDescription, 160, "f-seo-desc")}
            {row("social_summary", a.socialSummary, 200, undefined, a.socialHelp)}
         </div>
      </>
   );
}

export function AiCheckButton(props: { v: View }) {
   if (!props.v.ai) return null;
   return (
      <>
         <button class="btn ghost" type="button" data-ai-check style="justify-self:start">
            <Icon name="sparkle" size={18} /> {props.v.t.ai.check}
         </button>
         <p class="help ai-status" data-ai-status="check" role="status" aria-live="polite" />
      </>
   );
}

export function AiDialogs(props: { v: View; locale: Locale; other: Locale; kind: "pages" | "posts" }) {
   const { v, other } = props;
   if (!v.ai) return null;
   const a = v.t.ai;
   const otherName = v.t.locales[other];
   return (
      <>
         <dialog class="dlg" id="ai-translate" aria-labelledby="ai-tr-h">
            <form method="dialog">
               <div class="dlg-h">
                  <h2 id="ai-tr-h">{a.translationTitle(otherName)}</h2>
                  <button class="btn ghost sm icon-only" value="cancel" aria-label={a.close}>
                     <Icon name="x" size={18} />
                  </button>
               </div>
               <div class="dlg-b stack" style="gap:14px" tabindex={0} role="group" aria-labelledby="ai-tr-h">
                  <p class="help">{a.translationIntro}</p>
                  <p class="notice bad" data-ai-tr-warn hidden role="note">
                     <Icon name="alert" size={18} /> <span>{a.warnings}</span>
                  </p>
                  <div class="field">
                     <label for="ai-tr-title">{a.translatedField(v.t.content.title, otherName)}</label>
                     <input id="ai-tr-title" class="input" maxlength={200} lang={other} dir={other === "ar" ? "rtl" : "ltr"} />
                  </div>
                  <div class="field">
                     <label for="ai-tr-summary">{a.translatedField(props.kind === "pages" ? v.t.content.summary : v.t.content.excerpt, otherName)}</label>
                     <textarea id="ai-tr-summary" class="textarea" rows={3} maxlength={500} lang={other} dir={other === "ar" ? "rtl" : "ltr"} />
                  </div>
                  <div class="field">
                     <label for="ai-tr-body">{a.translatedField(v.t.content.body, otherName)}</label>
                     <textarea id="ai-tr-body" class="textarea code" rows={14} lang={other} dir={other === "ar" ? "rtl" : "ltr"} />
                  </div>
                  <p class="help" data-ai-tr-savefirst hidden>
                     {a.saveFirst}
                  </p>
               </div>
               <div class="dlg-f">
                  <button class="btn" value="cancel">
                     {a.discard}
                  </button>
                  <button class="btn primary" type="button" data-ai-tr-create hidden>
                     <Icon name="pen" size={18} /> {a.createDraft(otherName)}
                  </button>
                  <button class="btn primary" type="button" data-ai-tr-fill hidden>
                     <Icon name="external" size={18} class="flip" /> {a.fillExisting(otherName)}
                  </button>
               </div>
            </form>
         </dialog>

         <dialog class="dlg" id="ai-check" aria-labelledby="ai-ck-h">
            <form method="dialog">
               <div class="dlg-h">
                  <h2 id="ai-ck-h">{a.checkTitle}</h2>
                  <button class="btn ghost sm icon-only" value="cancel" aria-label={a.close}>
                     <Icon name="x" size={18} />
                  </button>
               </div>
               <div class="dlg-b stack" style="gap:16px" tabindex={0} role="group" aria-labelledby="ai-ck-h">
                  <p class="help">{a.checkIntro}</p>
                  <p data-ai-ck-summary dir="auto" style="margin:0;font-weight:600" />
                  {(["tone", "claims", "policy"] as const).map((k) => (
                     <section class="stack" style="gap:8px" aria-labelledby={`ai-ck-${k}-h`}>
                        <h3 id={`ai-ck-${k}-h`} style="margin:0">
                           {a[k]}
                        </h3>
                        <ul class="list" data-ai-ck={k} />
                     </section>
                  ))}
               </div>
               <div class="dlg-f">
                  <button class="btn primary" value="cancel">
                     {a.close}
                  </button>
               </div>
            </form>
         </dialog>
      </>
   );
}

export interface AiFailure {
   id: string;
   feature: string;
   kind: string;
   row_id: number | null;
   error: string | null;
   email: string | null;
   updated_at: number;
}

/** Overview, admins only: failed AI jobs (spec §3 "flag admins"). */
export function AiFailuresCard(props: { v: View; failures: { total: number; items: AiFailure[] } | null }) {
   const { v, failures } = props;
   if (!isAdmin(v) || !failures || failures.total === 0) return null;
   const a = v.t.ai;
   const fmt = new Intl.DateTimeFormat(v.prefs.lang === "ar" ? "ar-u-nu-latn" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
   return (
      <section class="card stack" aria-labelledby="ai-fail-h" data-ai-failures style="gap:12px;margin-top:32px">
         <h2 id="ai-fail-h" style="margin:0;display:flex;align-items:center;gap:8px">
            <Icon name="alert" size={18} /> {a.failuresTitle} <span class="badge draft">{failures.total}</span>
         </h2>
         <p class="help">{a.failuresBody}</p>
         <ul class="list">
            {failures.items.map((f) => (
               <li class="li" style="grid-template-columns:minmax(0,1fr) auto;padding:10px 12px" data-ai-failure={f.id}>
                  <div class="li-body">
                     {f.row_id ? (
                        <a class="li-title" href={`/${f.kind}/${f.row_id}`}>
                           {a.features[f.feature] ?? f.feature}
                        </a>
                     ) : (
                        <span class="li-title">{a.features[f.feature] ?? f.feature}</span>
                     )}
                     <div class="li-meta">
                        <span>{a.reasons[f.error ?? ""] ?? f.error ?? ""}</span>
                        {f.email ? <span dir="ltr">{f.email}</span> : null}
                        <time datetime={new Date(f.updated_at).toISOString()}>{fmt.format(new Date(f.updated_at))}</time>
                     </div>
                  </div>
                  <button class="btn ghost sm" type="button" data-ai-dismiss={f.id}>
                     {a.dismiss}
                  </button>
               </li>
            ))}
         </ul>
      </section>
   );
}
