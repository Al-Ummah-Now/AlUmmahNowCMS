/**
 * Where the model comes from (docs/AI_ASSIST_SPEC.md §2): by default the Workers AI binding `AI`
 * (wrangler.jsonc `"ai": { "binding": "AI" }` in every env, no key); admins may add generic HTTP
 * providers (src/lib/ai/settings.ts). No jobs queue, or no provider a feature can run on, means "not
 * configured": the feature is hidden from editors and admins see a notice.
 */
import type { AiBinding } from "./providers/workers-ai.ts";

export interface AiEnv {
   ENVIRONMENT: string;
   AI?: AiBinding;
   /**
    * Local development and the local E2E only: a mock of the Workers AI REST shape
    * (`POST <url>/ai/run/<model>` → the binding's output). `wrangler dev` cannot run the real binding
    * without Cloudflare credentials. Ignored on deployed envs.
    */
   AI_MOCK_URL?: string;
   AI_JOBS?: Queue<AiJobMessage>;
}

export interface AiJobMessage {
   jobId: string;
}

/** The mock base URL, only when this is a local run that set one. */
export function mockUrl(env: AiEnv): string | undefined {
   if (env.ENVIRONMENT !== "local") return undefined;
   let u = env.AI_MOCK_URL?.trim() ?? "";
   // Drop trailing slashes with a loop, not /\/+$/ (polynomial backtracking on long "////" runs)
   while (u.endsWith("/")) u = u.slice(0, -1);
   return u || undefined;
}

/** A binding-shaped client for the local mock (errors come back as the binding's would: "AiError … (code)"). */
export function mockBinding(base: string, fetchImpl: typeof fetch = fetch): AiBinding {
   return {
      async run(model, inputs) {
         const res = await fetchImpl(`${base}/ai/run/${model}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(inputs) });
         const body = (await res.json().catch(() => ({}))) as { result?: unknown; errors?: { code?: number; message?: string }[] };
         if (!res.ok) {
            const e = body.errors?.[0];
            throw new Error(`AiError: ${e?.message ?? res.status} (${e?.code ?? res.status})`);
         }
         return body.result;
      },
   };
}

export function aiBinding(env: AiEnv): AiBinding | null {
   const mock = mockUrl(env);
   if (mock) return mockBinding(mock);
   return env.AI && typeof env.AI.run === "function" ? env.AI : null;
}
