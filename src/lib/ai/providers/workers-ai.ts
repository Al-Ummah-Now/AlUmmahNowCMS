/**
 * The built-in provider: Cloudflare Workers AI through the Worker's `AI` binding (the default, no key).
 * Chat-style input with a JSON-schema `response_format`, an explicit reasoning level and a hard timeout.
 * Errors are classified by the Workers AI error code (developers.cloudflare.com/workers-ai/platform/errors).
 */
import { estimateNeurons, neuronsToUsd } from "../pricing.ts";
import { CALL_TIMEOUT_MS, CallTimeout, finishKind, num, parseJsonAnswer, TEMPERATURE, withTimeout } from "./shared.ts";
import type { AiErrorCode, CompletionRequest, CompletionResult, CompletionUsage, WritingAssistProvider } from "./types.ts";

/** The slice of the Workers AI binding we use (`env.AI`). */
export interface AiBinding {
   run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export const WORKERS_AI_ID = "workers-ai";

/** The answer text, finish reason, refusal and usage from either output shape Workers AI returns. */
export function readOutput(raw: unknown): { text: string; finish: string; refusal: boolean; usage: Record<string, unknown> } {
   const r = (raw ?? {}) as Record<string, unknown>;
   const usage = (r.usage ?? {}) as Record<string, unknown>;
   const choices = r.choices as { message?: { content?: unknown; refusal?: unknown }; finish_reason?: unknown }[] | undefined;
   if (Array.isArray(choices)) {
      const c = choices[0] ?? {};
      const content = c.message?.content;
      return { text: typeof content === "string" ? content : "", finish: String(c.finish_reason ?? ""), refusal: !!c.message?.refusal, usage };
   }
   // Older models: { response: string | object, usage }.
   const resp = r.response;
   return { text: typeof resp === "string" ? resp : resp && typeof resp === "object" ? JSON.stringify(resp) : "", finish: "", refusal: false, usage };
}

export function createWorkersAiProvider(ai: AiBinding, opts: { id?: string; timeoutMs?: number; now?: () => number } = {}): WritingAssistProvider {
   const id = opts.id ?? WORKERS_AI_ID;
   const timeoutMs = opts.timeoutMs ?? CALL_TIMEOUT_MS;
   const now = opts.now ?? Date.now;
   return {
      id,
      kind: "workers-ai",
      async complete(req: CompletionRequest): Promise<CompletionResult> {
         const base = { provider: id, kind: "workers-ai" as const, model: req.model };
         const reasoning = req.reasoning ?? "none";
         const inputs: Record<string, unknown> = {
            messages: [{ role: "system", content: req.system }, ...req.messages],
            max_tokens: req.maxTokens,
            temperature: TEMPERATURE,
            reasoning_effort: reasoning,
            // Models that think by default read this switch; others ignore it.
            chat_template_kwargs: { enable_thinking: reasoning !== "none" },
         };
         if (req.schema) inputs.response_format = { type: "json_schema", json_schema: { name: "result", schema: req.schema, strict: true } };
         const started = now();
         let raw: unknown;
         try {
            raw = await withTimeout(ai.run(req.model, inputs), timeoutMs);
         } catch (error) {
            return { ok: false, ...base, ...classify(error), latencyMs: now() - started };
         }
         const latencyMs = now() - started;
         const out = readOutput(raw);
         const details = (out.usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
         const usage: CompletionUsage = {
            inputTokens: num(out.usage.prompt_tokens),
            outputTokens: num(out.usage.completion_tokens),
            cachedTokens: num(details.cached_tokens),
            neurons: typeof out.usage.neurons === "number" ? out.usage.neurons : null,
         };
         const neurons = usage.neurons ?? estimateNeurons(req.model, { input: usage.inputTokens, output: usage.outputTokens, cached: usage.cachedTokens });
         const costUsd = neuronsToUsd(neurons);
         const fk = finishKind(out.finish);
         if (out.refusal || fk === "refused") return { ok: false, ...base, retryable: false, code: "declined", usage, costUsd, latencyMs };
         if (fk === "length") return { ok: false, ...base, retryable: false, code: "incomplete", usage, costUsd, latencyMs };
         if (!req.schema) return { ok: true, ...base, text: out.text, usage, costUsd, latencyMs };
         const json = parseJsonAnswer(out.text);
         if (json === undefined) return { ok: false, ...base, retryable: true, code: "invalid_output", usage, costUsd, latencyMs };
         return { ok: true, ...base, text: out.text, json, usage, costUsd, latencyMs };
      },
   };
}

/**
 * Workers AI errors arrive as an Error whose message carries the internal code, e.g.
 * "AiError: … (3040)" or "3046: Request timeout".
 */
export function classify(error: unknown): { retryable: boolean; code: AiErrorCode } {
   if (error instanceof CallTimeout) return { retryable: true, code: "network" };
   const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? "");
   const code = Number(/\b([35]\d{3})\b/.exec(msg)?.[1] ?? 0);
   switch (code) {
      case 3040: // out of capacity
      case 3036: // daily free allocation used up (paid accounts are not limited)
         return { retryable: true, code: "rate_limited" };
      case 3007: // timeout
      case 3008: // aborted
      case 3046: // request timeout (observed)
      case 3043: // internal error
         return { retryable: true, code: "unavailable" };
      case 3023: // account blocked
      case 3041: // account not allowed for the model
      case 5018:
      case 5016: // model agreement not accepted
      case 5035: // model needs the Workers Paid plan
         return { retryable: false, code: "auth" };
      case 3003: // incomplete request
      case 3006: // request too large
      case 3042: // invalid model id
      case 5004: // invalid data
      case 5005: // LoRA unsupported
      case 5007: // no such model
      case 5019: // deprecated SDK
      case 5028: // model deprecated
         return { retryable: false, code: "bad_request" };
   }
   if (/\b429\b|capacity|rate.?limit/i.test(msg)) return { retryable: true, code: "rate_limited" };
   if (/\b5\d\d\b|internal|unavailable|timed? ?out/i.test(msg)) return { retryable: true, code: "unavailable" };
   if (/network|fetch failed|connection|ECONN/i.test(msg)) return { retryable: true, code: "network" };
   return { retryable: true, code: "unknown" };
}
