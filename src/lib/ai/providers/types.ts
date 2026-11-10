/**
 * The writing-assist provider contract (docs/AI_ASSIST_SPEC.md §2.1). Translate, SEO and the
 * pre-publish check call only this interface: prompts, chunking and output validation stay in
 * prompts.ts / runner.ts and never depend on who answers. An adapter turns one request into one
 * vendor call and reports what it cost; it never throws (every failure is a classified outcome).
 * How to add a provider (configuration, not code): docs/AI_PROVIDERS.md.
 */

export type Reasoning = "none" | "low" | "high";

/**
 * The two adapters the CMS ships: the Workers AI binding (default) and one generic HTTP adapter that
 * an admin configures entirely as data (endpoint, auth, body template, response paths). Any number of
 * HTTP providers can be configured; none is vendor-specific code.
 */
export type ProviderKind = "workers-ai" | "http";

export type AiErrorCode =
   | "rate_limited"
   | "unavailable"
   | "network"
   | "declined"
   | "incomplete"
   | "invalid_output"
   | "auth"
   | "bad_request"
   /** The provider is disabled, or its key secret / binding is missing. */
   | "not_configured"
   | "unknown";

export interface CompletionMessage {
   role: "user" | "assistant";
   content: string;
}

export interface CompletionRequest {
   model: string;
   system: string;
   messages: CompletionMessage[];
   /** JSON schema the answer must match. Present → `json` is set on success. */
   schema?: Record<string, unknown>;
   /** Thinking effort for models that reason; adapters that can't control it ignore it. */
   reasoning?: Reasoning;
   maxTokens: number;
}

export interface CompletionUsage {
   inputTokens: number;
   outputTokens: number;
   /** Prompt tokens served from the provider's prefix cache. */
   cachedTokens: number;
   /** Workers AI only: the Neurons billed for the call (null when not reported). */
   neurons?: number | null;
}

interface Answered {
   provider: string;
   kind: ProviderKind;
   model: string;
   usage: CompletionUsage;
   /** Estimated from the provider's pricing config; never under-reports (unknown → the dearest rate). */
   costUsd: number;
}

export type CompletionResult =
   | (Answered & { ok: true; text: string; json?: unknown; latencyMs: number; raw?: string })
   | ({
        ok: false;
        code: AiErrorCode;
        retryable: boolean;
        latencyMs: number;
        provider: string;
        kind: ProviderKind;
        model: string;
        /** The response as received (truncated, secrets redacted) — only for the admin's "Test connection". */
        raw?: string;
        /** Status and mapped error message, for logs and "Test connection"; never shown to editors. */
        detail?: string;
     } & Partial<Pick<Answered, "usage" | "costUsd">>);

export interface WritingAssistProvider {
   /** The configured provider id (e.g. "workers-ai", "openrouter"). */
   readonly id: string;
   readonly kind: ProviderKind;
   complete(req: CompletionRequest): Promise<CompletionResult>;
}

/** USD per 1,000 tokens (HTTP providers; Workers AI is priced in Neurons, pricing.ts). */
export interface TokenPrice {
   inputPer1k: number;
   outputPer1k: number;
}
