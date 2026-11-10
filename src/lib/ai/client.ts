/**
 * The one place that calls the model: Cloudflare Workers AI through the Worker's `AI` binding
 * (docs/AI_ASSIST_SPEC.md §1). OpenAI-style chat input with a JSON-schema `response_format`, an
 * explicit reasoning level per feature, and a hard timeout so a stuck call never holds the consumer.
 * Errors are classified for the job runner: retryable (capacity, timeout, 5xx, network) or permanent
 * (no such model, request too large, account not allowed, …). Tests inject a fake binding.
 */

/** The slice of the Workers AI binding we use (`env.AI`). */
export interface AiBinding {
   run(model: string, inputs: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export type Reasoning = "none" | "low" | "high";

export interface StructuredCall {
   model: string;
   reasoning: Reasoning;
   maxTokens: number;
   system: string;
   user: string;
   schema: Record<string, unknown>;
}

export interface CallUsage {
   model: string;
   input: number;
   output: number;
   /** Prompt tokens served from the provider's prefix cache (billed at the cached rate). */
   cached: number;
   /** Neurons billed for the call, as Workers AI reported it (or estimated from the token counts). */
   neurons: number | null;
}

export type CallOutcome =
   | { ok: true; data: unknown; usage: CallUsage }
   | { ok: false; retryable: boolean; code: AiErrorCode; usage?: CallUsage };

export type AiErrorCode = "rate_limited" | "unavailable" | "network" | "declined" | "incomplete" | "invalid_output" | "auth" | "bad_request" | "unknown";

export interface Model {
   call(c: StructuredCall): Promise<CallOutcome>;
}

/** Per call. A queue consumer may run for 15 min; a translation chunk normally takes well under one. */
export const CALL_TIMEOUT_MS = 5 * 60 * 1000;

class CallTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
   let timer: ReturnType<typeof setTimeout> | undefined;
   const t = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CallTimeout("timeout")), ms);
   });
   return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

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

/** Strips a ```json fence some models wrap structured output in. */
function unfence(text: string): string {
   const t = text.trim();
   if (!t.startsWith("```")) return t;
   const first = t.indexOf("\n");
   const last = t.lastIndexOf("```");
   return first > 0 && last > first ? t.slice(first + 1, last).trim() : t;
}

export function createWorkersAi(ai: AiBinding, timeoutMs = CALL_TIMEOUT_MS): Model {
   return {
      async call(c) {
         const inputs: Record<string, unknown> = {
            messages: [
               { role: "system", content: c.system },
               { role: "user", content: c.user },
            ],
            response_format: { type: "json_schema", json_schema: { name: "result", schema: c.schema, strict: true } },
            max_tokens: c.maxTokens,
            temperature: 0.2,
            reasoning_effort: c.reasoning,
            // Models that think by default (DeepSeek V4, GLM, Qwen) read this switch; others ignore it.
            chat_template_kwargs: { enable_thinking: c.reasoning !== "none" },
         };
         let raw: unknown;
         try {
            raw = await withTimeout(ai.run(c.model, inputs), timeoutMs);
         } catch (error) {
            return { ok: false, ...classify(error) };
         }
         const out = readOutput(raw);
         const neurons = typeof out.usage.neurons === "number" ? out.usage.neurons : null;
         const details = (out.usage.prompt_tokens_details ?? {}) as Record<string, unknown>;
         const usage: CallUsage = { model: c.model, input: num(out.usage.prompt_tokens), output: num(out.usage.completion_tokens), cached: num(details.cached_tokens), neurons };
         if (out.refusal || out.finish === "content_filter") return { ok: false, retryable: false, code: "declined", usage };
         if (out.finish === "length") return { ok: false, retryable: false, code: "incomplete", usage };
         try {
            return { ok: true, data: JSON.parse(unfence(out.text)), usage };
         } catch {
            return { ok: false, retryable: true, code: "invalid_output", usage };
         }
      },
   };
}

/**
 * Workers AI errors (developers.cloudflare.com/workers-ai/platform/errors) arrive as an Error whose
 * message carries the internal code, e.g. "AiError: … (3040)" or "3046: Request timeout".
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
