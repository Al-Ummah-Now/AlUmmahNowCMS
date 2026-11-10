/**
 * The one place that calls the Claude API (official SDK). Structured output (JSON schema), adaptive
 * thinking (the model default), an explicit effort, and server-side refusal fallbacks
 * (`fallbacks: "default"`), streamed so long translations never hit an HTTP timeout.
 * Errors are classified for the job runner: retryable (429, 5xx/overloaded, network, timeout) or
 * permanent (anything else). Tests inject `fetch` to mock the API.
 */
import Anthropic from "@anthropic-ai/sdk";

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface StructuredCall {
   model: string;
   effort: "low" | "medium" | "high";
   maxTokens: number;
   system: string;
   user: string;
   schema: Record<string, unknown>;
}

export interface CallUsage {
   model: string;
   input: number;
   output: number;
   cacheRead: number;
   cacheWrite: number;
}

export type CallOutcome =
   | { ok: true; data: unknown; usage: CallUsage }
   | { ok: false; retryable: boolean; code: AiErrorCode; usage?: CallUsage };

export type AiErrorCode = "rate_limited" | "unavailable" | "network" | "declined" | "incomplete" | "invalid_output" | "auth" | "bad_request" | "unknown";

export interface ClaudeOptions {
   apiKey: string;
   baseURL?: string;
   fetch?: typeof fetch;
}

export interface Claude {
   call(c: StructuredCall): Promise<CallOutcome>;
}

export function createClaude(opts: ClaudeOptions): Claude {
   const client = new Anthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      fetch: opts.fetch,
      // The queue retries with backoff; one quick SDK retry absorbs a blip without holding the consumer.
      maxRetries: 1,
      timeout: 10 * 60 * 1000,
   });
   return {
      async call(c) {
         try {
            const stream = client.beta.messages.stream({
               model: c.model,
               max_tokens: c.maxTokens,
               betas: [FALLBACK_BETA],
               fallbacks: "default",
               output_config: { effort: c.effort, format: { type: "json_schema", schema: c.schema } },
               system: c.system,
               messages: [{ role: "user", content: c.user }],
            });
            const msg = await stream.finalMessage();
            const usage: CallUsage = {
               model: msg.model || c.model,
               input: msg.usage?.input_tokens ?? 0,
               output: msg.usage?.output_tokens ?? 0,
               cacheRead: msg.usage?.cache_read_input_tokens ?? 0,
               cacheWrite: msg.usage?.cache_creation_input_tokens ?? 0,
            };
            if (msg.stop_reason === "refusal") return { ok: false, retryable: false, code: "declined", usage };
            if (msg.stop_reason === "max_tokens") return { ok: false, retryable: false, code: "incomplete", usage };
            const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
            try {
               return { ok: true, data: JSON.parse(text), usage };
            } catch {
               return { ok: false, retryable: true, code: "invalid_output", usage };
            }
         } catch (error) {
            return { ok: false, ...classify(error) };
         }
      },
   };
}

export function classify(error: unknown): { retryable: boolean; code: AiErrorCode } {
   if (error instanceof Anthropic.RateLimitError) return { retryable: true, code: "rate_limited" };
   if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return { retryable: false, code: "auth" };
   if (error instanceof Anthropic.InternalServerError) return { retryable: true, code: "unavailable" };
   if (error instanceof Anthropic.APIConnectionError) return { retryable: true, code: "network" }; // includes timeouts
   if (error instanceof Anthropic.APIError) {
      const status = error.status ?? 0;
      if (status === 408 || status === 409 || status >= 500) return { retryable: true, code: "unavailable" };
      return { retryable: false, code: "bad_request" };
   }
   return { retryable: true, code: "unknown" };
}
