/**
 * Which provider answers a feature's call (docs/AI_ASSIST_SPEC.md §2.2): the feature's configured
 * provider and model, then — once — the fallback when the first failure is one another provider could
 * fix (capacity, outage, network, key or model problems). A refusal or a cut-off answer is not retried
 * elsewhere: the text, not the provider, is the problem. Every attempt is reported so each is logged.
 */
import { aiBinding, type AiEnv } from "./config.ts";
import { createHttpProvider } from "./providers/http.ts";
import type { AiErrorCode, CompletionRequest, CompletionResult, WritingAssistProvider } from "./providers/types.ts";
import { createWorkersAiProvider, type AiBinding } from "./providers/workers-ai.ts";
import { loadSettings, secretReader, type AiSettings, type ProviderConfig, type Route } from "./settings.ts";
import type { Feature } from "./prompts.ts";

export interface ProviderDeps {
   /** Overrides the Workers AI binding (tests). */
   binding?: AiBinding;
   /** Overrides providers by id (tests: a fake provider). */
   providers?: Record<string, WritingAssistProvider>;
   fetch?: typeof fetch;
}

const FALLBACK_ON: AiErrorCode[] = ["rate_limited", "unavailable", "network", "auth", "bad_request", "not_configured", "unknown"];
export const shouldFallBack = (code: AiErrorCode) => FALLBACK_ON.includes(code);

/** A provider for a config, or null when it can't run here (disabled; Workers AI without a binding). */
export function buildProvider(cfg: ProviderConfig, env: AiEnv, deps: ProviderDeps = {}): WritingAssistProvider | null {
   const injected = deps.providers?.[cfg.id];
   if (injected) return injected;
   if (!cfg.enabled) return null;
   if (cfg.kind === "workers-ai") {
      const ai = deps.binding ?? aiBinding(env);
      return ai ? createWorkersAiProvider(ai, { id: cfg.id }) : null;
   }
   return createHttpProvider(cfg, { readSecret: secretReader(env), fetch: deps.fetch });
}

export type Attempt = { route: Route; result: CompletionResult };

export interface Router {
   /** Runs the feature's call; `onAttempt` sees every attempt (to log usage) before the next one starts. */
   complete(feature: Feature, req: Omit<CompletionRequest, "model">, onAttempt: (a: Attempt) => Promise<void>): Promise<CompletionResult>;
}

const unavailable = (route: Route): CompletionResult => ({ ok: false, code: "not_configured", retryable: false, latencyMs: 0, provider: route.provider, kind: "http", model: route.model });

export function createRouter(settings: AiSettings, env: AiEnv, deps: ProviderDeps = {}): Router {
   const providerFor = (route: Route) => {
      const cfg = settings.providers.find((p) => p.id === route.provider);
      return cfg ? buildProvider(cfg, env, deps) : null;
   };
   const attempt = async (route: Route, req: Omit<CompletionRequest, "model">) => {
      const p = providerFor(route);
      return p ? p.complete({ ...req, model: route.model }) : unavailable(route);
   };
   return {
      async complete(feature, req, onAttempt) {
         const primary = settings.features[feature];
         const first = await attempt(primary, req);
         await onAttempt({ route: primary, result: first });
         const fb = settings.fallback;
         if (first.ok || !fb || !shouldFallBack(first.code) || (fb.provider === primary.provider && fb.model === primary.model)) return first;
         const second = await attempt(fb, req);
         await onAttempt({ route: fb, result: second });
         // Both failed: report the more transient failure so the job retries when either could recover.
         if (!second.ok && first.retryable && !second.retryable) return first;
         return second;
      },
   };
}

/** True when some enabled provider in the settings can run in this env. */
export function anyProviderReady(settings: AiSettings, env: AiEnv, deps: ProviderDeps = {}): boolean {
   return Object.values(settings.features).some((r) => routeReady(settings, env, deps, r));
}

function routeReady(settings: AiSettings, env: AiEnv, deps: ProviderDeps, route: Route): boolean {
   const cfg = settings.providers.find((p) => p.id === route.provider);
   return !!cfg && buildProvider(cfg, env, deps) !== null;
}

/** Configured = a queue to run jobs on, and a provider that can answer at least one feature. */
export async function aiReady(env: AiEnv & { DB: D1Database }, deps: ProviderDeps = {}): Promise<boolean> {
   if (!env.AI_JOBS) return false;
   try {
      return anyProviderReady((await loadSettings(env.DB)).settings, env, deps);
   } catch {
      // No settings table yet (migration not applied): the built-in default.
      return (deps.binding ?? aiBinding(env)) !== null;
   }
}
