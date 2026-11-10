/**
 * Provider-agnostic pieces every adapter uses: the call timeout, reading a JSON answer out of model
 * text, the JSON-path reader for response mappings, the body/URL template renderer and the HTTP
 * status classifier. No vendor knowledge lives here.
 */
import type { AiErrorCode, CompletionRequest } from "./types.ts";

/** Per call. A queue consumer may run for 15 min; a translation chunk normally takes well under one. */
export const CALL_TIMEOUT_MS = 5 * 60 * 1000;
export const TEMPERATURE = 0.2;

export class CallTimeout extends Error {}

export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
   let timer: ReturnType<typeof setTimeout> | undefined;
   const t = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CallTimeout("timeout")), ms);
   });
   return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

export const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Strips a ```json fence some models wrap structured output in. */
export function unfence(text: string): string {
   const t = text.trim();
   if (!t.startsWith("```")) return t;
   const first = t.indexOf("\n");
   const last = t.lastIndexOf("```");
   return first > 0 && last > first ? t.slice(first + 1, last).trim() : t;
}

/** The answer as JSON, or undefined when it isn't JSON. */
export function parseJsonAnswer(text: string): unknown {
   try {
      return JSON.parse(unfence(text));
   } catch {
      return undefined;
   }
}

/** Finish reasons meaning "cut off" / "refused", in the words providers commonly use. */
const LENGTH = new Set(["length", "max_tokens", "max_output_tokens", "token_limit"]);
const REFUSED = new Set(["content_filter", "refusal", "safety", "blocked", "recitation"]);
export function finishKind(finish: string): "length" | "refused" | null {
   const f = finish.trim().toLowerCase();
   if (LENGTH.has(f)) return "length";
   if (REFUSED.has(f)) return "refused";
   return null;
}

// ---- JSON paths: `a.b[0].c`, optionally starting with `$.` ----

export type PathToken = string | number;

const PATH = /^\$?(?:\.?[A-Za-z_][\w-]*|\[\d{1,4}\])(?:\.[A-Za-z_][\w-]*|\[\d{1,4}\])*$/;

export function parsePath(path: string): PathToken[] | null {
   const p = path.trim();
   if (!p || p.length > 200 || !PATH.test(p)) return null;
   const out: PathToken[] = [];
   for (const m of p.replace(/^\$/, "").matchAll(/\.?([A-Za-z_][\w-]*)|\[(\d+)\]/g)) out.push(m[1] !== undefined ? m[1] : Number(m[2]));
   return out.length ? out : null;
}

export function getPath(value: unknown, path: string | undefined): unknown {
   if (!path) return undefined;
   const tokens = parsePath(path);
   if (!tokens) return undefined;
   let cur: unknown = value;
   for (const t of tokens) {
      if (cur === null || typeof cur !== "object") return undefined;
      if (typeof t === "number") {
         if (!Array.isArray(cur)) return undefined;
         cur = cur[t];
      } else {
         if (Array.isArray(cur) || !Object.prototype.hasOwnProperty.call(cur, t)) return undefined;
         cur = (cur as Record<string, unknown>)[t];
      }
   }
   return cur;
}

// ---- templates ----

/**
 * Placeholders a request body may use. Each stands alone as a JSON value and is replaced by that
 * value JSON-encoded (so `"model": {{model}}` becomes `"model": "the-model"`).
 */
export const BODY_PLACEHOLDERS = [
   "model",
   "system",
   "prompt",
   "messages_json",
   "messages_with_system_json",
   "max_tokens",
   "temperature",
   "json_schema",
   "reasoning",
] as const;
export type BodyPlaceholder = (typeof BODY_PLACEHOLDERS)[number];
/** The URL may name the model (URL-encoded), e.g. `https://host/v1/models/{{model}}:generate`. */
export const URL_PLACEHOLDERS = ["model"] as const;

const TOKEN = /\{\{\s*([A-Za-z_]+)\s*\}\}/g;

export const placeholdersIn = (template: string): string[] => [...template.matchAll(TOKEN)].map((m) => m[1]);

export function bodyValues(req: CompletionRequest): Record<BodyPlaceholder, unknown> {
   const prompt = req.messages.map((m) => m.content).join("\n\n");
   return {
      model: req.model,
      system: req.system,
      prompt,
      messages_json: req.messages,
      messages_with_system_json: [{ role: "system", content: req.system }, ...req.messages],
      max_tokens: req.maxTokens,
      temperature: TEMPERATURE,
      json_schema: req.schema ?? null,
      reasoning: req.reasoning ?? "none",
   };
}

export function renderBody(template: string, values: Record<string, unknown>): string {
   return template.replace(TOKEN, (_, name: string) => JSON.stringify(values[name] ?? null));
}

export function renderUrl(template: string, model: string): string {
   return template.replace(TOKEN, (_, name: string) => (name === "model" ? encodeURIComponent(model) : ""));
}

// ---- errors ----

export function classifyStatus(status: number): { retryable: boolean; code: AiErrorCode } {
   if (status === 429) return { retryable: true, code: "rate_limited" };
   if (status === 401 || status === 403) return { retryable: false, code: "auth" };
   if (status === 408 || status >= 500) return { retryable: true, code: "unavailable" };
   if (status >= 400) return { retryable: false, code: "bad_request" };
   return { retryable: true, code: "unknown" };
}


/** At most `max` characters of `text`, with every secret value blanked out. */
export function redact(text: string, secrets: string[], max = 4000): string {
   let out = text;
   for (const s of secrets) if (s && s.length >= 4) out = out.split(s).join("[redacted]");
   return out.length > max ? `${out.slice(0, max)}…` : out;
}
