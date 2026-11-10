/**
 * Admin-managed AI assist settings, one row per environment's D1 (docs/AI_ASSIST_SPEC.md §2.2):
 * which providers exist and are enabled, the provider and model per feature, a fallback, and the
 * monthly budget. Keys are never stored: an HTTP provider names a secret (`AI_KEY_*`, a Worker secret
 * or Secrets Store binding) that is read at call time. Every change is versioned (optimistic
 * concurrency) and written to `ai_settings_audit` with who changed what.
 */
import { MODEL_ID, MODELS, FEATURES, type Feature } from "./prompts.ts";
import { HTTP_METHODS, type HttpProviderConfig, type SecretReader } from "./providers/http.ts";
import { BODY_PLACEHOLDERS, parsePath, placeholdersIn, renderBody, URL_PLACEHOLDERS } from "./providers/shared.ts";
import { WORKERS_AI_ID } from "./providers/workers-ai.ts";
import { log } from "../log.ts";

export interface WorkersAiProviderConfig {
   id: typeof WORKERS_AI_ID;
   kind: "workers-ai";
   label: string;
   enabled: boolean;
   models: string[];
}

export type ProviderConfig = WorkersAiProviderConfig | HttpProviderConfig;

export interface Route {
   provider: string;
   model: string;
}

export interface AiSettings {
   providers: ProviderConfig[];
   features: Record<Feature, Route>;
   /** Tried once when the feature's provider fails for a reason another provider could fix. */
   fallback: Route | null;
   /** USD per calendar month (UTC) for this environment; null = no cap. Jobs stop once it's reached. */
   monthlyBudgetUsd: number | null;
}

export const DEFAULT_BUDGET_USD = 50;
export const MAX_BUDGET_USD = 500;
export const MAX_PROVIDERS = 12;

export function defaultSettings(): AiSettings {
   return {
      providers: [{ id: WORKERS_AI_ID, kind: "workers-ai", label: "Cloudflare Workers AI", enabled: true, models: [MODEL_ID] }],
      features: { translate: { provider: WORKERS_AI_ID, model: MODELS.translate.model }, seo: { provider: WORKERS_AI_ID, model: MODELS.seo.model }, check: { provider: WORKERS_AI_ID, model: MODELS.check.model } },
      fallback: null,
      monthlyBudgetUsd: DEFAULT_BUDGET_USD,
   };
}

/** A blank HTTP provider (disabled) that the admin fills in. */
export function blankHttpProvider(id: string): HttpProviderConfig {
   return {
      id,
      kind: "http",
      label: "",
      enabled: false,
      method: "POST",
      url: "https://",
      auth: { type: "header", header: "Authorization", prefix: "Bearer ", secret: "AI_KEY_" },
      headers: [],
      bodyTemplate: '{\n  "model": {{model}},\n  "messages": {{messages_with_system_json}},\n  "max_tokens": {{max_tokens}},\n  "temperature": {{temperature}}\n}',
      response: { text: "", inputTokens: "", outputTokens: "", error: "", finish: "" },
      streaming: false,
      timeoutMs: 120_000,
      pricing: { inputPer1k: 0, outputPer1k: 0 },
      models: [],
   };
}

// ---- secrets (names only) ----

/** Only secrets with this prefix can be sent to a provider (an admin can't point a provider at BKND_JWT_SECRET). */
export const SECRET_NAME = /^AI_KEY_[A-Z0-9_]{1,48}$/;

export function secretReader(env: object): SecretReader {
   return async (name) => {
      if (!SECRET_NAME.test(name)) return null;
      const v = (env as Record<string, unknown>)[name];
      if (typeof v === "string") return v.trim() || null;
      if (v && typeof (v as { get?: unknown }).get === "function") {
         try {
            const s = await (v as { get(): Promise<string> }).get();
            return typeof s === "string" && s.trim() ? s.trim() : null;
         } catch (error) {
            log.warn("ai secret read failed", { secret: name, error: error instanceof Error ? error.name : "unknown" });
            return null;
         }
      }
      return null;
   };
}

/** Bound secret names usable by providers (for the admin's autocomplete). Never values. */
export const boundSecretNames = (env: object): string[] => Object.keys(env).filter((k) => SECRET_NAME.test(k)).sort();

// ---- validation ----

export interface SettingsError {
   path: string;
   code:
      | "required"
      | "invalid"
      | "too_long"
      | "too_many"
      | "duplicate"
      | "reserved"
      | "unknown_provider"
      | "disabled_provider"
      | "unknown_model"
      | "not_https"
      | "credential"
      | "unknown_placeholder"
      | "bad_template"
      | "bad_path"
      | "secret_name"
      | "auth_header"
      | "out_of_range"
      | "in_use";
}

const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{1,31}$/;
const MODEL = /^[\w@.:/+-]{1,128}$/;
const HEADER = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const PARAM = /^[A-Za-z0-9_.-]{1,64}$/;
const BANNED_HEADERS = new Set(["host", "content-length", "cookie", "connection", "transfer-encoding", "content-type", "accept"]);
/** Header names that carry credentials: they must come from `auth` (a secret), never a static value. */
const AUTHY_HEADER = /authorization|api[-_]?key|token|secret|password|^x-.*key$|^key$/i;

/** True when a literal looks like a credential (so it can't be pasted into a URL, header or template). */
export function looksLikeCredential(text: string): boolean {
   for (const w of text.split(/[^A-Za-z0-9_\-+/=.]+/)) {
      if (w.length < 20 || w.includes("://")) continue;
      if (/^[0-9a-f]{32,}$/i.test(w)) return true;
      if (/^[A-Za-z]{2,8}[-_][A-Za-z0-9_-]{20,}$/.test(w) && /\d/.test(w)) return true;
      if (/^eyJ[A-Za-z0-9_-]{10,}\./.test(w)) return true;
      if (w.length >= 28 && /^[A-Za-z0-9+/_=-]+$/.test(w) && /[A-Z]/.test(w) && /[a-z]/.test(w) && /\d/.test(w)) return true;
   }
   return false;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const bool = (v: unknown) => v === true;

function validateModels(raw: unknown, path: string, errors: SettingsError[]): string[] {
   if (!Array.isArray(raw)) {
      errors.push({ path, code: "required" });
      return [];
   }
   const models = [...new Set(raw.map(str).filter(Boolean))];
   if (models.length === 0) errors.push({ path, code: "required" });
   if (models.length > 20) errors.push({ path, code: "too_many" });
   models.forEach((m, i) => {
      if (!MODEL.test(m)) errors.push({ path: `${path}.${i}`, code: "invalid" });
   });
   return models.slice(0, 20);
}

function validateUrl(raw: string, path: string, local: boolean, errors: SettingsError[]): void {
   if (!raw) return void errors.push({ path, code: "required" });
   if (raw.length > 500) return void errors.push({ path, code: "too_long" });
   const unknown = placeholdersIn(raw).filter((p) => !(URL_PLACEHOLDERS as readonly string[]).includes(p));
   if (unknown.length) return void errors.push({ path, code: "unknown_placeholder" });
   let u: URL;
   try {
      u = new URL(raw.replace(/\{\{\s*model\s*\}\}/g, "m"));
   } catch {
      return void errors.push({ path, code: "invalid" });
   }
   const loopback = u.hostname === "127.0.0.1" || u.hostname === "localhost";
   if (u.protocol !== "https:" && !(local && loopback && u.protocol === "http:")) errors.push({ path, code: "not_https" });
   if (u.username || u.password) errors.push({ path, code: "credential" });
   if (looksLikeCredential(u.search + u.pathname)) errors.push({ path, code: "credential" });
}

export function validatePath(p: string): boolean {
   return parsePath(p) !== null;
}

function validateHttp(raw: Record<string, unknown>, path: string, local: boolean, errors: SettingsError[]): HttpProviderConfig {
   const method = (HTTP_METHODS as string[]).includes(String(raw.method)) ? (raw.method as HttpProviderConfig["method"]) : "POST";
   if (!(HTTP_METHODS as string[]).includes(String(raw.method))) errors.push({ path: `${path}.method`, code: "invalid" });
   const url = str(raw.url);
   validateUrl(url, `${path}.url`, local, errors);

   const a = isObj(raw.auth) ? raw.auth : {};
   let auth: HttpProviderConfig["auth"] = { type: "none" };
   if (a.type === "header") {
      const header = str(a.header);
      const prefix = typeof a.prefix === "string" ? a.prefix.replace(/[\r\n]/g, "") : "";
      const secret = str(a.secret);
      if (!HEADER.test(header)) errors.push({ path: `${path}.auth.header`, code: "invalid" });
      if (prefix.length > 20 || looksLikeCredential(prefix)) errors.push({ path: `${path}.auth.prefix`, code: prefix.length > 20 ? "too_long" : "credential" });
      if (!SECRET_NAME.test(secret)) errors.push({ path: `${path}.auth.secret`, code: "secret_name" });
      auth = { type: "header", header, prefix, secret };
   } else if (a.type === "query") {
      const param = str(a.param);
      const secret = str(a.secret);
      if (!PARAM.test(param)) errors.push({ path: `${path}.auth.param`, code: "invalid" });
      if (!SECRET_NAME.test(secret)) errors.push({ path: `${path}.auth.secret`, code: "secret_name" });
      auth = { type: "query", param, secret };
   } else if (a.type !== "none") errors.push({ path: `${path}.auth.type`, code: "invalid" });

   const rawHeaders = Array.isArray(raw.headers) ? raw.headers : [];
   if (rawHeaders.length > 10) errors.push({ path: `${path}.headers`, code: "too_many" });
   const headers = rawHeaders.slice(0, 10).map((h, i) => {
      const o = isObj(h) ? h : {};
      const name = str(o.name);
      const value = typeof o.value === "string" ? o.value : "";
      const p = `${path}.headers.${i}`;
      if (!HEADER.test(name) || BANNED_HEADERS.has(name.toLowerCase())) errors.push({ path: `${p}.name`, code: "invalid" });
      else if (AUTHY_HEADER.test(name)) errors.push({ path: `${p}.name`, code: "auth_header" });
      if (/[\r\n]/.test(value) || value.length > 200) errors.push({ path: `${p}.value`, code: "invalid" });
      else if (looksLikeCredential(value)) errors.push({ path: `${p}.value`, code: "credential" });
      return { name, value };
   });

   const bodyTemplate = typeof raw.bodyTemplate === "string" ? raw.bodyTemplate : "";
   const bp = `${path}.bodyTemplate`;
   if (!bodyTemplate.trim()) errors.push({ path: bp, code: "required" });
   else if (bodyTemplate.length > 8000) errors.push({ path: bp, code: "too_long" });
   else {
      const used = placeholdersIn(bodyTemplate);
      if (used.some((p) => !(BODY_PLACEHOLDERS as readonly string[]).includes(p))) errors.push({ path: bp, code: "unknown_placeholder" });
      else if (!used.some((p) => ["system", "prompt", "messages_json", "messages_with_system_json"].includes(p))) errors.push({ path: bp, code: "bad_template" });
      else if (looksLikeCredential(bodyTemplate.replace(/\{\{[^}]*\}\}/g, " "))) errors.push({ path: bp, code: "credential" });
      else {
         // Render with sample values: the result must be one JSON object.
         const sample = renderBody(bodyTemplate, { model: "m", system: "s", prompt: "p", messages_json: [], messages_with_system_json: [], max_tokens: 1, temperature: 0.2, json_schema: { type: "object" }, reasoning: "none" });
         try {
            if (!isObj(JSON.parse(sample))) errors.push({ path: bp, code: "bad_template" });
         } catch {
            errors.push({ path: bp, code: "bad_template" });
         }
      }
   }

   const r = isObj(raw.response) ? raw.response : {};
   const response: HttpProviderConfig["response"] = { text: str(r.text) };
   if (!response.text) errors.push({ path: `${path}.response.text`, code: "required" });
   else if (!validatePath(response.text)) errors.push({ path: `${path}.response.text`, code: "bad_path" });
   for (const k of ["json", "inputTokens", "outputTokens", "error", "finish"] as const) {
      const v = str(r[k]);
      if (!v) continue;
      if (!validatePath(v)) errors.push({ path: `${path}.response.${k}`, code: "bad_path" });
      response[k] = v;
   }

   const timeoutMs = Number(raw.timeoutMs);
   if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 300_000) errors.push({ path: `${path}.timeoutMs`, code: "out_of_range" });
   const pr = isObj(raw.pricing) ? raw.pricing : {};
   const price = (k: "inputPer1k" | "outputPer1k") => {
      const n = Number(pr[k]);
      if (pr[k] === "" || pr[k] === null || pr[k] === undefined || !Number.isFinite(n) || n < 0 || n > 10) errors.push({ path: `${path}.pricing.${k}`, code: "out_of_range" });
      return Number.isFinite(n) ? n : 0;
   };
   return {
      id: str(raw.id),
      kind: "http",
      label: str(raw.label).slice(0, 60),
      enabled: bool(raw.enabled),
      method,
      url,
      auth,
      headers,
      bodyTemplate,
      response,
      streaming: bool(raw.streaming),
      timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 120_000,
      pricing: { inputPer1k: price("inputPer1k"), outputPer1k: price("outputPer1k") },
      models: validateModels(raw.models, `${path}.models`, errors),
   };
}

/** One provider on its own (also used by "Test connection" on an unsaved form). */
export function validateProvider(raw: unknown, path: string, opts: { local: boolean }, errors: SettingsError[]): ProviderConfig | null {
   if (!isObj(raw)) {
      errors.push({ path, code: "invalid" });
      return null;
   }
   const id = str(raw.id);
   const label = str(raw.label);
   if (!label) errors.push({ path: `${path}.label`, code: "required" });
   else if (label.length > 60) errors.push({ path: `${path}.label`, code: "too_long" });
   if (raw.kind === "workers-ai") {
      if (id !== WORKERS_AI_ID) errors.push({ path: `${path}.id`, code: "invalid" });
      return { id: WORKERS_AI_ID, kind: "workers-ai", label: label.slice(0, 60), enabled: bool(raw.enabled), models: validateModels(raw.models, `${path}.models`, errors) };
   }
   if (raw.kind !== "http") {
      errors.push({ path: `${path}.kind`, code: "invalid" });
      return null;
   }
   if (!PROVIDER_ID.test(id)) errors.push({ path: `${path}.id`, code: "invalid" });
   else if (id === WORKERS_AI_ID) errors.push({ path: `${path}.id`, code: "reserved" });
   return validateHttp(raw, path, opts.local, errors);
}

function validateRoute(raw: unknown, path: string, providers: ProviderConfig[], errors: SettingsError[]): Route | null {
   if (!isObj(raw)) {
      errors.push({ path, code: "required" });
      return null;
   }
   const route = { provider: str(raw.provider), model: str(raw.model) };
   const p = providers.find((x) => x.id === route.provider);
   if (!p) errors.push({ path: `${path}.provider`, code: "unknown_provider" });
   else if (!p.enabled) errors.push({ path: `${path}.provider`, code: "disabled_provider" });
   else if (!p.models.includes(route.model)) errors.push({ path: `${path}.model`, code: "unknown_model" });
   return route;
}

export function validateSettings(raw: unknown, opts: { local: boolean }): { ok: true; settings: AiSettings } | { ok: false; errors: SettingsError[] } {
   const errors: SettingsError[] = [];
   if (!isObj(raw)) return { ok: false, errors: [{ path: "", code: "invalid" }] };
   const list = Array.isArray(raw.providers) ? raw.providers : [];
   if (list.length > MAX_PROVIDERS) errors.push({ path: "providers", code: "too_many" });
   const providers: ProviderConfig[] = [];
   list.slice(0, MAX_PROVIDERS).forEach((p, i) => {
      const v = validateProvider(p, `providers.${i}`, opts, errors);
      if (!v) return;
      if (providers.some((x) => x.id === v.id)) errors.push({ path: `providers.${i}.id`, code: "duplicate" });
      providers.push(v);
   });
   if (!providers.some((p) => p.kind === "workers-ai")) errors.push({ path: "providers", code: "required" });
   const f = isObj(raw.features) ? raw.features : {};
   const features = {} as Record<Feature, Route>;
   for (const feature of FEATURES) features[feature] = validateRoute(f[feature], `features.${feature}`, providers, errors) ?? { provider: "", model: "" };
   const fallback = raw.fallback == null || (isObj(raw.fallback) && !str(raw.fallback.provider)) ? null : validateRoute(raw.fallback, "fallback", providers, errors);
   let monthlyBudgetUsd: number | null = null;
   if (raw.monthlyBudgetUsd !== null && raw.monthlyBudgetUsd !== undefined && raw.monthlyBudgetUsd !== "") {
      const n = Number(raw.monthlyBudgetUsd);
      if (!Number.isFinite(n) || n <= 0 || n > MAX_BUDGET_USD) errors.push({ path: "monthlyBudgetUsd", code: "out_of_range" });
      else monthlyBudgetUsd = Math.round(n * 100) / 100;
   }
   if (errors.length) return { ok: false, errors };
   return { ok: true, settings: { providers, features, fallback, monthlyBudgetUsd } };
}

// ---- storage ----

export interface StoredSettings {
   settings: AiSettings;
   version: number;
   updatedAt: number | null;
   updatedBy: string | null;
}

export async function loadSettings(db: D1Database): Promise<StoredSettings> {
   const row = await db.prepare("SELECT data, version, updated_at, updated_by FROM ai_settings WHERE id = 1").first<{ data: string; version: number; updated_at: number; updated_by: string | null }>();
   if (!row) return { settings: defaultSettings(), version: 0, updatedAt: null, updatedBy: null };
   let parsed: unknown;
   try {
      parsed = JSON.parse(row.data);
   } catch {
      parsed = null;
   }
   // Stored rows were validated on save; re-validate (local rules are the loosest) so a bad row can't run.
   const v = validateSettings(parsed, { local: true });
   if (!v.ok) {
      log.error("ai settings invalid; using defaults", { version: row.version, errors: v.errors.length });
      return { settings: defaultSettings(), version: row.version, updatedAt: row.updated_at, updatedBy: row.updated_by };
   }
   return { settings: v.settings, version: row.version, updatedAt: row.updated_at, updatedBy: row.updated_by };
}

/** Paths whose value differs (for the audit summary). Never includes values. */
export function changedPaths(before: unknown, after: unknown, prefix = ""): string[] {
   if (JSON.stringify(before) === JSON.stringify(after)) return [];
   const bo = isObj(before) || Array.isArray(before);
   const ao = isObj(after) || Array.isArray(after);
   if (!bo || !ao) return [prefix || "(root)"];
   const b = before as Record<string, unknown>;
   const a = after as Record<string, unknown>;
   const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
   // Providers are keyed by id so a reorder doesn't read as "everything changed".
   if (prefix === "providers") {
      const byId = (x: Record<string, unknown>) => Object.fromEntries(Object.values(x).map((p) => [String((p as { id?: string }).id), p]));
      return changedPaths(byId(b), byId(a), "providers*");
   }
   return keys.flatMap((k) => changedPaths(b[k], a[k], prefix ? `${prefix.replace(/\*$/, "")}.${k}` : k)).slice(0, 50);
}

export interface Actor {
   id: number | null;
   email: string | null;
}

export class SettingsConflict extends Error {}

export async function saveSettings(db: D1Database, next: AiSettings, expectedVersion: number, actor: Actor, now: number): Promise<{ version: number; changed: string[] }> {
   const current = await loadSettings(db);
   if (current.version !== expectedVersion) throw new SettingsConflict("version");
   const changed = changedPaths(current.settings, next);
   if (changed.length === 0) return { version: current.version, changed };
   const version = current.version + 1;
   const write =
      current.version === 0
         ? db.prepare("INSERT INTO ai_settings (id, data, version, updated_at, updated_by) VALUES (1, ?1, ?2, ?3, ?4)").bind(JSON.stringify(next), version, now, actor.email)
         : db.prepare("UPDATE ai_settings SET data = ?1, version = ?2, updated_at = ?3, updated_by = ?4 WHERE id = 1 AND version = ?5").bind(JSON.stringify(next), version, now, actor.email, expectedVersion);
   const [res] = await db.batch([
      write,
      db
         .prepare("INSERT INTO ai_settings_audit (id, at, user_id, email, action, version, changed, before, after) VALUES (?1, ?2, ?3, ?4, 'update', ?5, ?6, ?7, ?8)")
         .bind(crypto.randomUUID(), now, actor.id, actor.email, version, JSON.stringify(changed), JSON.stringify(current.settings), JSON.stringify(next)),
   ]);
   if ((res.meta.changes ?? 0) !== 1) throw new SettingsConflict("version");
   log.info("ai settings changed", { by: actor.email, version, changed });
   return { version, changed };
}

/** Audit entry for a "Test connection" run (who tested which provider, the outcome; never the key). */
export async function auditTest(db: D1Database, actor: Actor, providerId: string, outcome: string, now: number): Promise<void> {
   await db
      .prepare("INSERT INTO ai_settings_audit (id, at, user_id, email, action, version, changed, before, after) VALUES (?1, ?2, ?3, ?4, 'test', NULL, ?5, NULL, NULL)")
      .bind(crypto.randomUUID(), now, actor.id, actor.email, JSON.stringify([`${providerId}: ${outcome}`]))
      .run();
}

export interface AuditEntry {
   at: number;
   email: string | null;
   action: "update" | "test";
   version: number | null;
   changed: string[];
}

export async function recentAudit(db: D1Database, limit = 20): Promise<AuditEntry[]> {
   const rows = await db.prepare("SELECT at, email, action, version, changed FROM ai_settings_audit ORDER BY at DESC LIMIT ?1").bind(limit).all<{ at: number; email: string | null; action: string; version: number | null; changed: string }>();
   return (rows.results ?? []).map((r) => {
      let changed: string[];
      try {
         changed = JSON.parse(r.changed) as string[];
      } catch {
         changed = [];
      }
      return { at: r.at, email: r.email, action: r.action === "test" ? "test" : "update", version: r.version, changed };
   });
}
