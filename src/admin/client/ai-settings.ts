/**
 * AI assist settings screen (src/admin/screens/ai-settings.tsx): renders the form from the page's
 * JSON, keeps the feature pickers in step with the providers, removes a provider through an in-app
 * dialog, runs "Test connection" on the form as it is, and saves with the loaded version.
 */
import { $, $$, api, ApiError, strings, toast } from "./dom.ts";
import { attachCombobox } from "./combobox.ts";

type Json = Record<string, unknown>;
interface Provider extends Json {
   id: string;
   kind: "workers-ai" | "http";
   label: string;
   enabled: boolean;
   models: string[];
}
interface Route {
   provider: string;
   model: string;
}
interface Settings {
   providers: Provider[];
   features: Record<string, Route>;
   fallback: Route | null;
   monthlyBudgetUsd: number | null;
}
interface AuditEntry {
   at: number;
   email: string | null;
   action: "update" | "test";
   changed: string[];
}
interface Data {
   settings: Settings;
   version: number;
   secrets: string[];
   budget: { capUsd: number | null; spentUsd: number; reached: boolean };
   audit: AuditEntry[];
   blank: Provider;
}
type A = Record<string, string> & { features: Record<string, string>; codes: Record<string, string>; results: Record<string, string> };
interface S {
   a: A;
   lang: string;
}

const FEATURES = ["translate", "seo", "check"] as const;

/** Reads `a.b.c` from an object. */
const getIn = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Json)[k] : undefined), o);

function setIn(o: Json, path: string, v: unknown): void {
   const ks = path.split(".");
   let cur = o;
   for (const k of ks.slice(0, -1)) cur = (cur[k] ??= {}) as Json;
   cur[ks[ks.length - 1]] = v;
}

/** Text fill-ins like "{0}" for the template functions the server serialised (they become plain strings). */
const fmt = (s: string, ...args: string[]) => args.reduce((acc, a, i) => acc.split(`{${i}}`).join(a), s);

/** A card's form values as a provider config (the shape the server validates). */
export function readCard(card: HTMLElement): Provider {
   const val = (k: string) => {
      const e = card.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-k="${k}"]`);
      if (!e) return undefined;
      if (e instanceof HTMLInputElement && e.type === "checkbox") return e.checked;
      return e.value;
   };
   const models = String(val("models") ?? "")
      .split(/\r?\n/)
      .map((m) => m.trim())
      .filter(Boolean);
   const kind = card.dataset.kind as Provider["kind"];
   if (kind === "workers-ai") return { id: "workers-ai", kind, label: card.dataset.label ?? "", enabled: !!val("enabled"), models };
   const out: Json = { kind, id: String(val("id") ?? "").trim(), label: String(val("label") ?? "").trim(), enabled: !!val("enabled"), method: val("method"), url: String(val("url") ?? "").trim(), models };
   const type = String(val("auth.type"));
   out.auth =
      type === "header"
         ? { type, header: String(val("auth.header") ?? "").trim(), prefix: String(val("auth.prefix") ?? ""), secret: String(val("auth.secret") ?? "").trim() }
         : type === "query"
           ? { type, param: String(val("auth.param") ?? "").trim(), secret: String(val("auth.secret") ?? "").trim() }
           : { type: "none" };
   out.headers = $$<HTMLLIElement>("[data-header]", card).map((li) => ({ name: $<HTMLInputElement>('[data-h="name"]', li)!.value.trim(), value: $<HTMLInputElement>('[data-h="value"]', li)!.value }));
   out.bodyTemplate = val("bodyTemplate");
   out.response = {};
   for (const k of ["text", "json", "inputTokens", "outputTokens", "error", "finish"]) {
      const v = String(val(`response.${k}`) ?? "").trim();
      if (v || k === "text") (out.response as Json)[k] = v;
   }
   out.streaming = !!val("streaming");
   out.timeoutMs = Math.round(Number(val("timeoutSeconds")) * 1000);
   out.pricing = { inputPer1k: val("pricing.inputPer1k") === "" ? "" : Number(val("pricing.inputPer1k")), outputPer1k: val("pricing.outputPer1k") === "" ? "" : Number(val("pricing.outputPer1k")) };
   return out as Provider;
}

export function initAiSettings(): void {
   const form = $<HTMLFormElement>("[data-ai-settings]");
   const dataNode = document.getElementById("ai-settings-data");
   if (!form || !dataNode) return;
   const { a, lang } = strings<S>();
   const data = JSON.parse(dataNode.textContent || "{}") as Data;
   let version = data.version;
   const host = $("[data-providers]", form)!;
   const removeDlg = $<HTMLDialogElement>("#ai-remove")!;
   const errorsBox = $("[data-ai-errors]", form)!;
   let uid = 0;
   const usd = (n: number) => new Intl.NumberFormat(lang, { style: "currency", currency: "USD", maximumFractionDigits: n < 1 ? 4 : 2 }).format(n);
   const ms = (n: number) => new Intl.NumberFormat(lang, { style: "unit", unit: "millisecond", unitDisplay: "short" }).format(Math.round(n));
   const intl = (n: number) => new Intl.NumberFormat(lang).format(n);
   const cards = () => $$<HTMLElement>("[data-provider]", host);

   // ---- budget ----
   const budget = $<HTMLInputElement>("[data-budget]", form)!;
   budget.value = data.settings.monthlyBudgetUsd === null ? "" : String(data.settings.monthlyBudgetUsd);
   const spent = $("[data-budget-spent]", form)!;
   spent.textContent = data.budget.capUsd === null ? fmt(a.spentNoCap, usd(data.budget.spentUsd)) : fmt(a.spent, usd(data.budget.spentUsd), usd(data.budget.capUsd));
   if (data.budget.reached) spent.classList.add("err");

   // ---- providers ----
   const linkLabels = (root: HTMLElement) => {
      for (const label of $$<HTMLLabelElement>("label[data-for]", root)) {
         const k = label.dataset.for!;
         const field = label.parentElement!;
         const control = field.querySelector<HTMLElement>(`[data-k="${k}"],[data-h="${k}"]`);
         if (!control) continue;
         const id = `ai-f${++uid}`;
         control.id = id;
         label.htmlFor = id;
         const help = field.querySelector<HTMLElement>(`[data-help="${k}"]`);
         if (help) {
            help.id = `${id}-help`;
            control.setAttribute("aria-describedby", help.id);
         }
      }
   };

   const addHeaderRow = (card: HTMLElement, h: { name: string; value: string }) => {
      const li = ($<HTMLTemplateElement>("#ai-tpl-header")!.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLLIElement;
      $<HTMLInputElement>('[data-h="name"]', li)!.value = h.name;
      $<HTMLInputElement>('[data-h="value"]', li)!.value = h.value;
      linkLabels(li);
      $("[data-headers]", card)!.append(li);
      return li;
   };

   const authVisibility = (card: HTMLElement) => {
      const type = $<HTMLSelectElement>('[data-k="auth.type"]', card)?.value;
      const show = (k: string, on: boolean) => {
         const f = $(`[data-k="${k}"]`, card)?.closest<HTMLElement>(".field");
         if (f) f.hidden = !on;
      };
      show("auth.header", type === "header");
      show("auth.prefix", type === "header");
      show("auth.param", type === "query");
      show("auth.secret", type !== "none");
   };

   const titleOf = (card: HTMLElement) => {
      const p = readCard(card);
      $("[data-title]", card)!.textContent = p.label || p.id || a.addProvider;
   };

   const addCard = (p: Provider, saved: boolean) => {
      const tpl = $<HTMLTemplateElement>(p.kind === "workers-ai" ? "#ai-tpl-workers-ai" : "#ai-tpl-http")!;
      const card = (tpl.content.firstElementChild as HTMLElement).cloneNode(true) as HTMLElement;
      if (p.kind === "workers-ai") card.dataset.label = p.label;
      for (const input of $$<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("[data-k]", card)) {
         const k = input.dataset.k!;
         if (k === "testModel") continue;
         const v = k === "timeoutSeconds" ? Number(p.timeoutMs ?? 120_000) / 1000 : k === "models" ? (p.models ?? []).join("\n") : getIn(p, k);
         if (input instanceof HTMLInputElement && input.type === "checkbox") input.checked = v === true;
         else input.value = v === undefined || v === null ? "" : String(v);
      }
      const idInput = $<HTMLInputElement>('[data-k="id"]', card);
      if (idInput && saved) idInput.readOnly = true;
      for (const h of (p.headers as { name: string; value: string }[] | undefined) ?? []) addHeaderRow(card, h);
      linkLabels(card);
      host.append(card);
      authVisibility(card);
      titleOf(card);
      const secret = $<HTMLInputElement>('[data-combo="auth.secret"]', card);
      if (secret) attachCombobox(secret, () => data.secrets, () => a.secretNone);
      attachCombobox($<HTMLInputElement>('[data-combo="testModel"]', card)!, () => readCard(card).models);
      const firstModel = readCard(card).models[0];
      if (firstModel) $<HTMLInputElement>('[data-combo="testModel"]', card)!.value = firstModel;
      return card;
   };

   for (const p of data.settings.providers) addCard(p, true);

   host.addEventListener("input", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>("[data-provider]");
      if (!card) return;
      if ((e.target as HTMLElement).matches('[data-k="label"],[data-k="id"]')) titleOf(card);
      if ((e.target as HTMLElement).matches('[data-k="auth.type"]')) authVisibility(card);
      if ((e.target as HTMLElement).matches('[data-k="label"],[data-k="id"],[data-k="enabled"],[data-k="models"]')) refreshRoutes();
   });
   host.addEventListener("change", (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>("[data-provider]");
      if (!card) return;
      if ((e.target as HTMLElement).matches('[data-k="auth.type"]')) authVisibility(card);
      if ((e.target as HTMLElement).matches('[data-k="enabled"]')) refreshRoutes();
   });

   host.addEventListener("click", async (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>("button");
      const card = btn?.closest<HTMLElement>("[data-provider]");
      if (!btn || !card) return;
      if (btn.hasAttribute("data-add-header")) {
         const li = addHeaderRow(card, { name: "", value: "" });
         $<HTMLInputElement>('[data-h="name"]', li)?.focus();
      } else if (btn.hasAttribute("data-remove-header")) {
         const li = btn.closest("li");
         const next = (li?.nextElementSibling ?? li?.previousElementSibling)?.querySelector<HTMLInputElement>("input") ?? $<HTMLButtonElement>("[data-add-header]", card);
         li?.remove();
         next?.focus();
      } else if (btn.hasAttribute("data-remove-provider")) {
         removeDlg.showModal();
         const ok = await new Promise<boolean>((resolve) => removeDlg.addEventListener("close", () => resolve(removeDlg.returnValue === "ok"), { once: true }));
         if (!ok) return btn.focus();
         card.remove();
         refreshRoutes();
         $<HTMLButtonElement>("[data-add-provider]", form)?.focus();
      } else if (btn.hasAttribute("data-test-provider")) {
         await runTest(card, btn);
      }
   });

   $("[data-add-provider]", form)!.addEventListener("click", () => {
      const used = new Set(cards().map((c) => readCard(c).id));
      let n = 1;
      while (used.has(`provider-${n}`)) n++;
      const card = addCard({ ...data.blank, id: `provider-${n}` }, false);
      refreshRoutes();
      $<HTMLInputElement>('[data-k="label"]', card)?.focus();
   });

   // ---- test connection ----
   const runTest = async (card: HTMLElement, btn: HTMLButtonElement) => {
      const out = $("[data-test-result]", card)!;
      const model = $<HTMLInputElement>('[data-combo="testModel"]', card)!.value.trim();
      btn.disabled = true;
      out.replaceChildren(document.createTextNode(a.testing));
      try {
         const r = await api<Json>("POST", "/admin/api/ai/settings/test", { provider: readCard(card), model });
         out.replaceChildren();
         if (r.ok) {
            const u = (r.usage ?? {}) as Json;
            const p = document.createElement("p");
            p.style.margin = "0";
            p.style.fontWeight = "600";
            p.textContent = `${fmt(a.testOk, ms(Number(r.latencyMs)), usd(Number(r.costUsd)))} ${fmt(a.testTokens, intl(Number(u.inputTokens ?? 0)), intl(Number(u.outputTokens ?? 0)))}`;
            out.append(p, labelled(a.testAnswer, String(r.answer ?? "")));
         } else {
            const p = document.createElement("p");
            p.className = "err";
            p.textContent = `${a.testFailed}: ${a.results[String(r.code)] ?? a.results.unknown}${r.detail ? ` (${String(r.detail)})` : ""}`;
            out.append(p);
            if (r.raw) out.append(labelled(a.testRaw, String(r.raw)));
         }
      } catch (e) {
         out.replaceChildren();
         showErrors(e instanceof ApiError ? e.body : null, card);
      } finally {
         btn.disabled = false;
      }
   };

   const labelled = (title: string, text: string) => {
      const box = document.createElement("div");
      const h = document.createElement("p");
      h.className = "label";
      h.style.margin = "8px 0 0";
      h.textContent = title;
      const pre = document.createElement("pre");
      pre.dir = "auto";
      pre.textContent = text;
      box.append(h, pre);
      return box;
   };

   // ---- routes ----
   const routeRows = () => $$<HTMLFieldSetElement>("[data-route]", form);
   const refreshRoutes = () => {
      const ps = cards().map(readCard);
      for (const row of routeRows()) {
         const sel = $<HTMLSelectElement>("[data-route-provider]", row)!;
         const keep = sel.value || sel.dataset.initial || "";
         sel.replaceChildren();
         if (row.dataset.route === "fallback") sel.append(new Option(a.noFallback, ""));
         for (const p of ps) sel.append(new Option(`${p.label || p.id}${p.enabled ? "" : ` (${a.enabled}: ✗)`}`, p.id));
         sel.value = ps.some((p) => p.id === keep) || keep === "" ? keep : "";
      }
   };
   for (const row of routeRows()) {
      const f = row.dataset.route!;
      const route = f === "fallback" ? data.settings.fallback : data.settings.features[f];
      const sel = $<HTMLSelectElement>("[data-route-provider]", row)!;
      sel.dataset.initial = route?.provider ?? "";
      const model = $<HTMLInputElement>("[data-route-model]", row)!;
      model.value = route?.model ?? "";
      attachCombobox(model, () => {
         const card = cards().find((c) => readCard(c).id === sel.value);
         return card ? readCard(card).models : [];
      });
      sel.addEventListener("change", () => {
         const card = cards().find((c) => readCard(c).id === sel.value);
         const models = card ? readCard(card).models : [];
         if (!models.includes(model.value)) model.value = models[0] ?? "";
      });
   }
   refreshRoutes();

   // ---- history ----
   const history = $("[data-history]", form)!;
   const renderHistory = (entries: AuditEntry[]) => {
      history.replaceChildren();
      if (!entries.length) {
         const li = document.createElement("li");
         li.className = "muted";
         li.textContent = a.historyEmpty;
         history.append(li);
      }
      for (const e of entries) {
         const li = document.createElement("li");
         const who = e.email ?? "—";
         const when = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeStyle: "short" }).format(new Date(e.at));
         const strong = document.createElement("strong");
         strong.textContent = `${fmt(e.action === "test" ? a.tested : a.changed, who)} · ${when}`;
         const code = document.createElement("div");
         code.className = "muted";
         code.dir = "ltr";
         code.style.overflowWrap = "anywhere";
         code.textContent = e.changed.join(", ");
         li.append(strong, code);
         history.append(li);
      }
   };
   renderHistory(data.audit);

   // ---- errors ----
   const pathLabel = (path: string): string => {
      const parts = path.split(".");
      if (parts[0] === "providers") {
         const card = cards()[Number(parts[1])];
         const k = parts.slice(2).join(".");
         const name = card ? readCard(card).label || readCard(card).id : "";
         const field = card?.querySelector<HTMLElement>(`[data-k="${k === "timeoutMs" ? "timeoutSeconds" : k}"]`);
         const label = field?.id ? (document.querySelector<HTMLLabelElement>(`label[for="${field.id}"]`)?.textContent ?? k) : k;
         return `${name} — ${label}`;
      }
      if (parts[0] === "provider") return parts.slice(1).join(".");
      if (parts[0] === "features") return `${a.features[parts[1]] ?? parts[1]} — ${parts[2] === "model" ? a.model : a.provider}`;
      if (parts[0] === "fallback") return `${a.fallback} — ${parts[1] === "model" ? a.model : a.provider}`;
      if (parts[0] === "monthlyBudgetUsd") return a.budgetLabel;
      return path;
   };
   const fieldFor = (path: string, scope?: HTMLElement): HTMLElement | null => {
      const parts = path.split(".");
      if (parts[0] === "providers" || parts[0] === "provider") {
         const card = parts[0] === "provider" ? scope : cards()[Number(parts[1])];
         const k = parts.slice(parts[0] === "provider" ? 1 : 2).join(".");
         if (k.startsWith("headers.")) {
            const [, i, h] = k.split(".");
            return card ? ($$<HTMLLIElement>("[data-header]", card)[Number(i)]?.querySelector<HTMLElement>(`[data-h="${h ?? "name"}"]`) ?? null) : null;
         }
         return card?.querySelector<HTMLElement>(`[data-k="${k === "timeoutMs" ? "timeoutSeconds" : k.replace(/^models\.\d+$/, "models")}"]`) ?? null;
      }
      if (parts[0] === "features" || parts[0] === "fallback") {
         const row = form.querySelector<HTMLElement>(`[data-route="${parts[0] === "fallback" ? "fallback" : parts[1]}"]`);
         return row?.querySelector<HTMLElement>(path.endsWith("model") ? "[data-route-model]" : "[data-route-provider]") ?? null;
      }
      if (parts[0] === "monthlyBudgetUsd") return budget;
      return null;
   };
   const clearErrors = () => {
      errorsBox.hidden = true;
      errorsBox.replaceChildren();
      for (const e of $$("[aria-invalid=true]", form)) e.removeAttribute("aria-invalid");
   };
   const showErrors = (body: unknown, scope?: HTMLElement) => {
      clearErrors();
      const list = (body && typeof body === "object" ? ((body as Json).errors as { path: string; code: string }[] | undefined) : undefined) ?? [];
      if (!list.length) {
         toast(a.testFailed, "bad");
         return;
      }
      const title = document.createElement("p");
      title.style.margin = "0";
      title.style.fontWeight = "600";
      title.textContent = a.invalid;
      const ul = document.createElement("ul");
      ul.className = "ai-errors-list";
      for (const err of list) {
         const li = document.createElement("li");
         li.textContent = `${pathLabel(err.path)}: ${a.codes[err.code] ?? err.code}`;
         ul.append(li);
         fieldFor(err.path, scope)?.setAttribute("aria-invalid", "true");
      }
      errorsBox.append(title, ul);
      errorsBox.hidden = false;
      errorsBox.focus();
   };

   // ---- save ----
   const collect = (): Settings => {
      const route = (row: string): Route => {
         const el = form.querySelector<HTMLElement>(`[data-route="${row}"]`)!;
         return { provider: $<HTMLSelectElement>("[data-route-provider]", el)!.value, model: $<HTMLInputElement>("[data-route-model]", el)!.value.trim() };
      };
      const features: Record<string, Route> = {};
      for (const f of FEATURES) features[f] = route(f);
      const fb = route("fallback");
      const budgetValue = budget.value.trim();
      const s: Json = { providers: cards().map(readCard), features, fallback: fb.provider ? fb : null };
      setIn(s, "monthlyBudgetUsd", budgetValue === "" ? null : Number(budgetValue));
      return s as unknown as Settings;
   };

   form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const btn = $<HTMLButtonElement>("[data-save]", form)!;
      btn.disabled = true;
      clearErrors();
      try {
         const res = await api<{ version: number; changed: string[] }>("PUT", "/admin/api/ai/settings", { settings: collect(), version });
         version = res.version;
         toast(res.changed.length ? a.saved : a.nothingChanged);
         for (const c of cards()) {
            const id = $<HTMLInputElement>('[data-k="id"]', c);
            if (id) id.readOnly = true;
         }
         const fresh = await api<Data>("GET", "/admin/api/ai/settings");
         renderHistory(fresh.audit);
      } catch (e) {
         if (e instanceof ApiError && e.status === 409) toast(a.conflict, "bad");
         else if (e instanceof ApiError && e.status === 400) showErrors(e.body);
         else toast(a.saveFailed, "bad");
      } finally {
         btn.disabled = false;
      }
   });
}
