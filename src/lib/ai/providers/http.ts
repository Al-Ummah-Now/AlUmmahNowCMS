/**
 * The generic HTTP provider. Nothing in here knows any vendor: an admin describes the endpoint as data
 * (docs/AI_PROVIDERS.md) — URL and method, how the key is sent, static headers, a JSON body template
 * with placeholders, and JSON paths that say where the answer, the token counts and the error message
 * are in the response. Optional server-sent-events streaming. The key is read from a Worker secret or
 * Secrets Store binding by name at call time and never leaves this function except in the request.
 */
import { bodyValues, classifyStatus, finishKind, getPath, num, parseJsonAnswer, redact, renderBody, renderUrl } from "./shared.ts";
import type { AiErrorCode, CompletionRequest, CompletionResult, CompletionUsage, TokenPrice, WritingAssistProvider } from "./types.ts";

export type HttpMethod = "POST" | "PUT" | "PATCH";
export const HTTP_METHODS: HttpMethod[] = ["POST", "PUT", "PATCH"];

export type HttpAuth = { type: "none" } | { type: "header"; header: string; prefix: string; secret: string } | { type: "query"; param: string; secret: string };

export interface ResponseMapping {
   /** Where the answer text is. With streaming on, read from each event and concatenated. */
   text: string;
   /** Optional: where the answer already is JSON (used instead of parsing `text`). */
   json?: string;
   inputTokens?: string;
   outputTokens?: string;
   /** A provider error message in a 2xx or error body. */
   error?: string;
   /** Why generation stopped ("length" → cut off, "content_filter"/"refusal"/"safety" → declined). */
   finish?: string;
}

export interface HttpProviderConfig {
   id: string;
   kind: "http";
   label: string;
   enabled: boolean;
   method: HttpMethod;
   url: string;
   auth: HttpAuth;
   headers: { name: string; value: string }[];
   bodyTemplate: string;
   response: ResponseMapping;
   streaming: boolean;
   timeoutMs: number;
   pricing: TokenPrice;
   /** Model ids offered in the feature pickers (any id may still be typed). */
   models: string[];
}

/** Reads a secret by name: a Worker secret (string) or a Secrets Store binding (`get()`). */
export type SecretReader = (name: string) => Promise<string | null>;

/** Cost with unknown token counts estimated at 1 token per 3 characters (over-, never under-reports). */
export function httpCost(p: TokenPrice, inputTokens: number, outputTokens: number): number {
   return Math.round(((inputTokens / 1000) * p.inputPer1k + (outputTokens / 1000) * p.outputPer1k) * 1e8) / 1e8;
}

/** The request this config makes for `req` (no network). Exported for "Test connection" and tests. */
export function buildHttpRequest(cfg: HttpProviderConfig, req: CompletionRequest, key: string | null): { url: string; init: RequestInit } {
   const values = bodyValues(withSchemaInstruction(cfg, req));
   const url = new URL(renderUrl(cfg.url, req.model));
   const headers = new Headers({ "content-type": "application/json", accept: cfg.streaming ? "text/event-stream" : "application/json" });
   for (const h of cfg.headers) headers.set(h.name, h.value);
   if (cfg.auth.type === "header" && key !== null) headers.set(cfg.auth.header, `${cfg.auth.prefix}${key}`);
   if (cfg.auth.type === "query" && key !== null) url.searchParams.set(cfg.auth.param, key);
   return { url: url.toString(), init: { method: cfg.method, headers, body: renderBody(cfg.bodyTemplate, values) } };
}

/**
 * A body template without {{json_schema}} can't pass the schema as a parameter, so the schema goes
 * into the system prompt instead (provider-agnostic; the validators check the answer either way).
 */
function withSchemaInstruction(cfg: HttpProviderConfig, req: CompletionRequest): CompletionRequest {
   if (!req.schema || cfg.bodyTemplate.includes("json_schema")) return req;
   return { ...req, system: `${req.system}\n\nAnswer with one JSON object only (no prose, no code fence) that matches this JSON schema:\n${JSON.stringify(req.schema)}` };
}

async function readStream(res: Response, map: ResponseMapping): Promise<{ text: string; last: unknown; events: unknown[]; raw: string }> {
   const raw = await res.text();
   let text = "";
   let last: unknown = undefined;
   const events: unknown[] = [];
   for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let ev: unknown;
      try {
         ev = JSON.parse(data);
      } catch {
         continue;
      }
      events.push(ev);
      const piece = getPath(ev, map.text);
      if (typeof piece === "string") text += piece;
      last = ev;
   }
   return { text, last, events, raw };
}

/** The last numeric / string value of `path` over the events (usage and finish usually come last). */
function lastOf(events: unknown[], path: string | undefined): unknown {
   if (!path) return undefined;
   for (let i = events.length - 1; i >= 0; i--) {
      const v = getPath(events[i], path);
      if (v !== undefined && v !== null && v !== "") return v;
   }
   return undefined;
}

export function createHttpProvider(cfg: HttpProviderConfig, deps: { readSecret: SecretReader; fetch?: typeof fetch; now?: () => number }): WritingAssistProvider {
   const doFetch = deps.fetch ?? fetch;
   const now = deps.now ?? Date.now;
   return {
      id: cfg.id,
      kind: "http",
      async complete(req: CompletionRequest): Promise<CompletionResult> {
         const base = { provider: cfg.id, kind: "http" as const, model: req.model };
         const started = now();
         const fail = (c: { retryable: boolean; code: AiErrorCode }, detail: string): CompletionResult => ({ ok: false, ...base, ...c, latencyMs: now() - started, detail });
         if (!cfg.enabled) return fail({ retryable: false, code: "not_configured" }, "provider disabled");
         let key: string | null = null;
         if (cfg.auth.type !== "none") {
            key = await deps.readSecret(cfg.auth.secret);
            if (!key) return fail({ retryable: false, code: "not_configured" }, `secret ${cfg.auth.secret} is not bound`);
         }
         const secrets = key ? [key, encodeURIComponent(key)] : [];
         const { url, init } = buildHttpRequest(cfg, req, key);
         const promptChars = init.body ? String(init.body).length : 0;
         let res: Response;
         try {
            res = await doFetch(url, { ...init, signal: AbortSignal.timeout(cfg.timeoutMs) });
         } catch (error) {
            const name = error instanceof Error ? error.name : "";
            return fail({ retryable: true, code: "network" }, name === "TimeoutError" || name === "AbortError" ? "timeout" : "network error");
         }
         const map = cfg.response;
         let body: unknown;
         let events: unknown[];
         let streamedText = "";
         let raw: string;
         if (res.ok && cfg.streaming) {
            const s = await readStream(res, map).catch(() => ({ text: "", last: undefined, events: [], raw: "" }));
            events = s.events;
            streamedText = s.text;
            body = s.last;
            raw = s.raw;
         } else {
            raw = await res.text().catch(() => "");
            try {
               body = raw ? JSON.parse(raw) : undefined;
            } catch {
               body = undefined;
            }
            events = body === undefined ? [] : [body];
         }
         const latencyMs = now() - started;
         const shown = redact(raw, secrets);
         const message = lastOf(events, map.error);
         const errText = typeof message === "string" ? message.slice(0, 300) : message !== undefined ? JSON.stringify(message).slice(0, 300) : "";
         if (!res.ok) {
            return { ok: false, ...base, ...classifyStatus(res.status), latencyMs, raw: shown, detail: `HTTP ${res.status}${errText ? `: ${redact(errText, secrets)}` : ""}` };
         }
         const inTok = num(Number(lastOf(events, map.inputTokens) ?? NaN));
         const outTok = num(Number(lastOf(events, map.outputTokens) ?? NaN));
         const text = cfg.streaming ? streamedText : ((): string => {
            const v = getPath(body, map.text);
            return typeof v === "string" ? v : v !== undefined && v !== null ? JSON.stringify(v) : "";
         })();
         const usage: CompletionUsage = {
            inputTokens: inTok || Math.ceil(promptChars / 3),
            outputTokens: outTok || Math.ceil(text.length / 3),
            cachedTokens: 0,
         };
         const costUsd = httpCost(cfg.pricing, usage.inputTokens, usage.outputTokens);
         const answered = { ...base, usage, costUsd, latencyMs };
         if (errText && !text) return { ok: false, ...answered, retryable: true, code: "unknown", raw: shown, detail: redact(errText, secrets) };
         const fk = finishKind(String(lastOf(events, map.finish) ?? ""));
         if (fk === "refused") return { ok: false, ...answered, retryable: false, code: "declined", raw: shown };
         if (fk === "length") return { ok: false, ...answered, retryable: false, code: "incomplete", raw: shown };
         if (!req.schema) {
            if (!text) return { ok: false, ...answered, retryable: true, code: "invalid_output", raw: shown, detail: `nothing at ${map.text}` };
            return { ok: true, ...answered, text, raw: shown };
         }
         const direct = map.json ? getPath(body, map.json) : undefined;
         const json = direct !== undefined && direct !== null && typeof direct === "object" ? direct : parseJsonAnswer(text);
         if (json === undefined) return { ok: false, ...answered, retryable: true, code: "invalid_output", raw: shown, detail: text ? "answer is not JSON" : `nothing at ${map.text}` };
         return { ok: true, ...answered, text, json, raw: shown };
      },
   };
}
