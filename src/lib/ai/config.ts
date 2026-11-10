/**
 * Where the Anthropic key comes from (docs/AI_ASSIST_SPEC.md §2). `ANTHROPIC_API_KEY` is either a
 * Secrets Store binding (an object with `get()`) or a Worker secret (a string). No key, or an empty
 * one, means "not configured": the feature is hidden from editors and admins see a notice.
 * The value is never logged or returned.
 */

/** A Secrets Store binding, as `secrets_store_secrets` provides it. */
export interface StoreSecret {
   get(): Promise<string>;
}

export interface AiEnv {
   ENVIRONMENT: string;
   ANTHROPIC_API_KEY?: string | StoreSecret;
   /** Local development and the local E2E only: a mock Messages API. Ignored on deployed envs. */
   ANTHROPIC_BASE_URL?: string;
   AI_JOBS?: Queue<AiJobMessage>;
}

export interface AiJobMessage {
   jobId: string;
}

export async function resolveApiKey(env: AiEnv): Promise<string | null> {
   const b = env.ANTHROPIC_API_KEY;
   if (!b) return null;
   try {
      const value = typeof b === "string" ? b : typeof b.get === "function" ? await b.get() : "";
      const key = (value ?? "").trim();
      return key ? key : null;
   } catch {
      // A store binding whose secret was deleted: treat as not configured (never a raw error).
      return null;
   }
}

/** The API base URL: the SDK default, unless this is a local run pointing at a mock. */
export function apiBaseUrl(env: AiEnv): string | undefined {
   if (env.ENVIRONMENT !== "local") return undefined;
   let u = env.ANTHROPIC_BASE_URL?.trim() ?? "";
   // Drop trailing slashes with a loop, not /\/+$/ (polynomial backtracking on long "////" runs)
   while (u.endsWith("/")) u = u.slice(0, -1);
   return u || undefined;
}

/** Configured = a key and a queue to run jobs on. */
export async function aiConfigured(env: AiEnv): Promise<boolean> {
   return !!env.AI_JOBS && (await resolveApiKey(env)) !== null;
}
