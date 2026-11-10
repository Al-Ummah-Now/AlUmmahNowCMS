/** @jsxImportSource hono/jsx */
/**
 * AI assist settings (admins, docs/AI_PROVIDERS.md): monthly budget, the provider and model per
 * feature plus a fallback, the providers (built-in Workers AI and any number of generic HTTP
 * providers), "Test connection", and the audit trail. The form is filled and read by
 * src/admin/client/ai-settings.ts from the JSON below; saving is one PUT with the version it loaded.
 * No key is ever in this page: providers name an AI_KEY_* secret, and the list of bound names is
 * offered as an autocomplete.
 */
import { raw } from "hono/html";
import type { Child } from "hono/jsx";
import { budgetState } from "../../lib/ai/budget.ts";
import { FEATURES } from "../../lib/ai/prompts.ts";
import { HTTP_METHODS } from "../../lib/ai/providers/http.ts";
import { blankHttpProvider, boundSecretNames, loadSettings, recentAudit } from "../../lib/ai/settings.ts";
import type { Env } from "../../env.ts";
import { Icon } from "../ui/icons.tsx";
import { PageHead, type View } from "../ui/layout.tsx";
import { I18nScript } from "../ui/parts.tsx";

function Field(props: { k: string; label: string; help?: string; children: Child; wide?: boolean }) {
   return (
      <div class="field" style={props.wide ? "grid-column:1/-1" : undefined}>
         <label data-for={props.k}>{props.label}</label>
         {props.children}
         {props.help ? (
            <p class="help" data-help={props.k}>
               {props.help}
            </p>
         ) : null}
      </div>
   );
}

const ltr = { dir: "ltr", spellcheck: false, autocapitalize: "off", autocomplete: "off" } as const;

/** One combobox (an input with a filtered list of suggestions, src/admin/client/combobox.ts). */
function Combo(props: { k: string; maxlength: number; placeholder?: string }) {
   return (
      <div class="combo">
         <input class="input" data-k={props.k} data-combo={props.k} role="combobox" aria-autocomplete="list" aria-expanded="false" maxlength={props.maxlength} placeholder={props.placeholder} {...ltr} />
         <ul class="combo-list" role="listbox" hidden />
      </div>
   );
}

function HttpCard(props: { v: View }) {
   const a = props.v.t.aiSettings;
   return (
      <section class="card flat stack ai-provider" data-provider data-kind="http">
         <div class="ai-provider-h">
            <h3 data-title style="margin:0" dir="auto" />
            <span class="badge loc">{a.httpKind}</span>
            <label class="switch">
               <input type="checkbox" data-k="enabled" />
               {a.enabled}
            </label>
         </div>
         <div class="grid2">
            <Field k="label" label={a.name}>
               <input class="input" data-k="label" maxlength={60} dir="auto" autocomplete="off" />
            </Field>
            <Field k="id" label={a.id} help={a.idHelp}>
               <input class="input" data-k="id" maxlength={32} pattern="[a-z0-9][a-z0-9\-]{1,31}" {...ltr} />
            </Field>
            <Field k="method" label={a.method}>
               <select class="select" data-k="method">
                  {HTTP_METHODS.map((m) => (
                     <option value={m}>{m}</option>
                  ))}
               </select>
            </Field>
            <Field k="url" label={a.url} help={a.urlHelp}>
               <input class="input" data-k="url" type="url" maxlength={500} {...ltr} />
            </Field>
            <Field k="auth.type" label={a.auth}>
               <select class="select" data-k="auth.type">
                  <option value="header">{a.authHeader}</option>
                  <option value="query">{a.authQuery}</option>
                  <option value="none">{a.authNone}</option>
               </select>
            </Field>
            <Field k="auth.secret" label={a.secret} help={a.secretHelp}>
               <Combo k="auth.secret" maxlength={55} placeholder="AI_KEY_…" />
            </Field>
            <Field k="auth.header" label={a.authHeaderName}>
               <input class="input" data-k="auth.header" maxlength={64} {...ltr} />
            </Field>
            <Field k="auth.prefix" label={a.authPrefix} help={a.authPrefixHelp}>
               <input class="input" data-k="auth.prefix" maxlength={20} {...ltr} />
            </Field>
            <Field k="auth.param" label={a.authParam}>
               <input class="input" data-k="auth.param" maxlength={64} {...ltr} />
            </Field>
         </div>
         <fieldset class="stack ai-headers">
            <legend class="label">{a.headers}</legend>
            <p class="help">{a.headersHelp}</p>
            <ul class="stack" data-headers style="list-style:none;margin:0;padding:0" />
            <div>
               <button type="button" class="btn sm" data-add-header>
                  {a.addHeader}
               </button>
            </div>
         </fieldset>
         <Field k="bodyTemplate" label={a.body} help={a.bodyHelp} wide>
            <textarea class="textarea code" data-k="bodyTemplate" rows={8} maxlength={8000} {...ltr} />
         </Field>
         <fieldset class="stack">
            <legend class="label">{a.response}</legend>
            <p class="help">{a.responseHelp}</p>
            <div class="grid2">
               {(
                  [
                     ["response.text", a.pText],
                     ["response.json", a.pJson],
                     ["response.inputTokens", a.pInput],
                     ["response.outputTokens", a.pOutput],
                     ["response.error", a.pError],
                     ["response.finish", a.pFinish],
                  ] as const
               ).map(([k, label]) => (
                  <Field k={k} label={label}>
                     <input class="input code" data-k={k} maxlength={200} {...ltr} />
                  </Field>
               ))}
            </div>
         </fieldset>
         <div class="grid2">
            <div class="field">
               <label class="switch">
                  <input type="checkbox" data-k="streaming" />
                  {a.streaming}
               </label>
            </div>
            <Field k="timeoutSeconds" label={a.timeout}>
               <input class="input" data-k="timeoutSeconds" type="number" min={1} max={300} step={1} inputmode="numeric" dir="ltr" />
            </Field>
            <Field k="pricing.inputPer1k" label={a.priceIn}>
               <input class="input" data-k="pricing.inputPer1k" type="number" min={0} max={10} step="any" inputmode="decimal" dir="ltr" />
            </Field>
            <Field k="pricing.outputPer1k" label={a.priceOut}>
               <input class="input" data-k="pricing.outputPer1k" type="number" min={0} max={10} step="any" inputmode="decimal" dir="ltr" />
            </Field>
         </div>
         <Field k="models" label={a.models} help={a.modelsHelp} wide>
            <textarea class="textarea code" data-k="models" rows={3} {...ltr} />
         </Field>
         <TestBox v={props.v} />
         <div>
            <button type="button" class="btn danger sm" data-remove-provider>
               <Icon name="trash" size={16} /> {a.removeProvider}
            </button>
         </div>
      </section>
   );
}

function TestBox(props: { v: View }) {
   const a = props.v.t.aiSettings;
   return (
      <div class="ai-test stack">
         <div class="ai-test-row">
            <Field k="testModel" label={a.testModel}>
               <Combo k="testModel" maxlength={128} />
            </Field>
            <button type="button" class="btn sm" data-test-provider>
               <Icon name="refresh" size={16} /> {a.test}
            </button>
         </div>
         <p class="help">{a.testUnsaved}</p>
         <div data-test-result role="status" aria-live="polite" />
      </div>
   );
}

function WorkersAiCard(props: { v: View }) {
   const a = props.v.t.aiSettings;
   return (
      <section class="card flat stack ai-provider" data-provider data-kind="workers-ai">
         <div class="ai-provider-h">
            <h3 data-title style="margin:0" dir="auto" />
            <span class="badge loc">{a.builtIn}</span>
            <label class="switch">
               <input type="checkbox" data-k="enabled" />
               {a.enabled}
            </label>
         </div>
         <Field k="models" label={a.models} help={a.modelsHelp}>
            <textarea class="textarea code" data-k="models" rows={2} {...ltr} />
         </Field>
         <TestBox v={props.v} />
      </section>
   );
}

/** The strings as JSON for the client: sentence functions become "{0}"/"{1}" templates. */
function clientStrings(a: View["t"]["aiSettings"]) {
   return {
      ...a,
      spent: a.spent("{0}", "{1}"),
      spentNoCap: a.spentNoCap("{0}"),
      testOk: a.testOk("{0}", "{1}"),
      testTokens: a.testTokens("{0}", "{1}"),
      changed: a.changed("{0}"),
      tested: a.tested("{0}"),
   };
}

export async function aiSettingsScreen(v: View, env: Env) {
   const a = v.t.aiSettings;
   const stored = await loadSettings(env.DB);
   const now = Date.now();
   const budget = await budgetState(env.DB, env.ENVIRONMENT, stored.settings, now);
   const audit = await recentAudit(env.DB);
   const data = { settings: stored.settings, version: stored.version, secrets: boundSecretNames(env), budget, audit, blank: blankHttpProvider("") };
   const json = JSON.stringify(data).replace(/</g, "\\u003c");
   return (
      <>
         <I18nScript nonce={v.nonce} strings={{ a: clientStrings(a), lang: v.prefs.lang }} />
         <script type="application/json" id="ai-settings-data" nonce={v.nonce}>
            {raw(json)}
         </script>
         <PageHead title={a.title} intro={a.intro} />
         <form class="stack" data-ai-settings novalidate style="gap:24px">
            <div data-ai-errors role="alert" tabindex={-1} hidden class="card flat" />
            <section class="card stack" aria-labelledby="ai-budget-h">
               <h2 id="ai-budget-h" style="margin:0">
                  {a.budgetTitle}
               </h2>
               <div class="field" style="max-width:280px">
                  <label for="ai-budget">{a.budgetLabel}</label>
                  <input id="ai-budget" class="input" data-budget type="number" min={1} max={500} step="any" inputmode="decimal" dir="ltr" aria-describedby="ai-budget-help ai-budget-spent" />
               </div>
               <p class="help" id="ai-budget-help">
                  {a.budgetHelp}
               </p>
               <p id="ai-budget-spent" data-budget-spent style="margin:0;font-weight:600" />
            </section>
            <section class="card stack" aria-labelledby="ai-routes-h">
               <h2 id="ai-routes-h" style="margin:0">
                  {a.routesTitle}
               </h2>
               <p class="help">{a.routesIntro}</p>
               <div class="ai-routes" data-routes>
                  {[...FEATURES, "fallback" as const].map((f) => (
                     <fieldset class="ai-route" data-route={f}>
                        <legend class="label">{f === "fallback" ? a.fallback : a.features[f]}</legend>
                        <div class="field">
                           <label for={`ai-r-${f}-p`}>{a.provider}</label>
                           <select id={`ai-r-${f}-p`} class="select" data-route-provider />
                        </div>
                        <div class="field">
                           <label for={`ai-r-${f}-m`}>{a.model}</label>
                           <div class="combo">
                              <input id={`ai-r-${f}-m`} class="input" data-route-model role="combobox" aria-autocomplete="list" aria-expanded="false" maxlength={128} {...ltr} />
                              <ul class="combo-list" role="listbox" hidden />
                           </div>
                        </div>
                     </fieldset>
                  ))}
               </div>
            </section>
            <section class="stack" aria-labelledby="ai-providers-h">
               <div class="ph" style="margin:0">
                  <div>
                     <h2 id="ai-providers-h" style="margin:0">
                        {a.providersTitle}
                     </h2>
                     <p class="help" style="margin-block-start:6px">
                        {a.providersIntro}
                     </p>
                  </div>
                  <button type="button" class="btn" data-add-provider>
                     {a.addProvider}
                  </button>
               </div>
               <div class="stack" data-providers style="gap:18px" />
            </section>
            <div class="ai-save">
               <button type="submit" class="btn primary" data-save>
                  <Icon name="check" size={16} /> {a.save}
               </button>
            </div>
            <section class="card flat stack" aria-labelledby="ai-history-h">
               <h2 id="ai-history-h" style="margin:0">
                  {a.historyTitle}
               </h2>
               <ul class="stack" data-history style="list-style:none;margin:0;padding:0" />
            </section>
         </form>
         <template id="ai-tpl-http">
            <HttpCard v={v} />
         </template>
         <template id="ai-tpl-workers-ai">
            <WorkersAiCard v={v} />
         </template>
         <template id="ai-tpl-header">
            <li class="ai-header-row" data-header>
               <div class="field">
                  <label data-for="name">{a.headerName}</label>
                  <input class="input" data-h="name" maxlength={64} {...ltr} />
               </div>
               <div class="field">
                  <label data-for="value">{a.headerValue}</label>
                  <input class="input" data-h="value" maxlength={200} {...ltr} />
               </div>
               <button type="button" class="btn ghost sm icon-only" data-remove-header aria-label={a.removeHeader}>
                  <Icon name="x" size={16} />
               </button>
            </li>
         </template>
         <dialog class="dlg sm" id="ai-remove" aria-labelledby="ai-remove-h" aria-describedby="ai-remove-b">
            <form method="dialog">
               <div class="dlg-h">
                  <h2 id="ai-remove-h">{a.removeTitle}</h2>
               </div>
               <div class="dlg-b">
                  <p style="margin:0" id="ai-remove-b">
                     {a.removeBody}
                  </p>
               </div>
               <div class="dlg-f">
                  <button class="btn" value="cancel" autofocus>
                     {v.t.common.cancel}
                  </button>
                  <button class="btn danger" value="ok">
                     <Icon name="trash" size={16} /> {a.remove}
                  </button>
               </div>
            </form>
         </dialog>
      </>
   );
}
