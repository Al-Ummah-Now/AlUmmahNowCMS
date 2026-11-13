/** Worker bindings and vars (wrangler.jsonc), plus the derived runtime config. */
export interface Env {
   DB: D1Database;
   MEDIA: R2Bucket;
   /** Image variant jobs (src/lib/variants/jobs.ts). Optional so a missing binding degrades to originals. */
   VARIANTS?: Queue<import("./lib/variants/jobs.ts").VariantMessage>;
   /** www's home timeline (docs/FEED.md): this Worker is its only writer; www reads it. */
   FEED?: KVNamespace;
   /** Feed rebuild wake-ups (src/lib/feed/jobs.ts). Optional: without it changes wait for the cron. */
   FEED_JOBS?: Queue<import("./lib/feed/jobs.ts").FeedMessage>;
   ENVIRONMENT: "production" | "stage" | "qa" | "local";
   PUBLIC_URL: string;
   AUTH_ISSUER: string;
   AUTH_CLIENT_ID: string;
   VIDEOS_API_URL: string;
   VIDEOS_WEB_URL: string;
   WWW_URL: string;
   /** Videos admin API: `GET /public/site-theme` (the site theme, docs/ADMIN_UI_SPEC.md §5). */
   ADMIN_API_URL?: string;
   /** Videos admin site: where admins change the site theme. */
   ADMIN_WEB_URL?: string;
   /** Comma-separated origins allowed to call the public API from a browser. */
   WWW_ORIGINS: string;
   /** Worker secret (`openssl rand -hex 32`). Signs bknd sessions and the SSO state cookie. */
   BKND_JWT_SECRET?: string;
   /** Workers AI (docs/AI_ASSIST_SPEC.md §2): the AI assist model. Without it the feature is off. */
   AI?: import("./lib/ai/providers/workers-ai.ts").AiBinding;
   /** Local runs only (ENVIRONMENT=local): a mock of the Workers AI REST shape for the local E2E. */
   AI_MOCK_URL?: string;
   /** AI jobs queue (al-ummah-now-cms-ai[-env]). */
   AI_JOBS?: Queue<{ jobId: string }>;
   /** Per-IP limit on the public search (src/routes/public-api.ts). Without it search is unlimited. */
   SEARCH_LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
   /**
    * api-videos' service-to-service key (Secrets Store; its /internal/* routes): scholar channels and
    * community posts (src/lib/scholars/videos-internal.ts). Without it those features wait and retry.
    * A plain string in tests and local runs.
    */
   VIDEOS_INTERNAL_API_KEY?: string | { get(): Promise<string> };
}

export interface RuntimeConfig {
   isLocal: boolean;
   publicUrl: string;
   issuer: string;
   clientId: string;
   redirectUri: string;
   jwtSecret: string;
   wwwUrl: string;
   wwwOrigins: string[];
   videosApiUrl: string;
   videosWebUrl: string;
}

/** Only used when ENVIRONMENT=local and no secret is configured. Never valid on a deployed Worker. */
const LOCAL_DEV_SECRET = "local-dev-only-not-a-secret-local-dev-only-not-a-secret";

export class ConfigError extends Error {}

/** `u` without trailing slashes (a linear scan: no backtracking regex on configured URLs). */
export function trimSlash(u: string): string {
   let end = u.length;
   while (end > 0 && u.charCodeAt(end - 1) === 47) end--;
   return u.slice(0, end);
}

/** The videos platform's API and web app, as the snapshot jobs take them. */
export function videosUrls(env: Env): { apiUrl: string; webUrl: string } {
   return { apiUrl: trimSlash(env.VIDEOS_API_URL), webUrl: trimSlash(env.VIDEOS_WEB_URL) };
}

export function runtimeConfig(env: Env): RuntimeConfig {
   const isLocal = env.ENVIRONMENT === "local";
   const secret = env.BKND_JWT_SECRET?.trim();
   // Fail closed: a deployed Worker without its session secret serves nothing but /healthz.
   if (!secret && !isLocal) throw new ConfigError("BKND_JWT_SECRET is not set");
   if (secret && secret.length < 32) throw new ConfigError("BKND_JWT_SECRET is too short (need ≥ 32 chars)");
   for (const key of ["PUBLIC_URL", "AUTH_ISSUER", "AUTH_CLIENT_ID"] as const) {
      if (!env[key]) throw new ConfigError(`${key} is not set`);
   }
   const publicUrl = trimSlash(env.PUBLIC_URL);
   return {
      isLocal,
      publicUrl,
      issuer: trimSlash(env.AUTH_ISSUER),
      clientId: env.AUTH_CLIENT_ID,
      redirectUri: `${publicUrl}/sso/callback`,
      jwtSecret: secret || LOCAL_DEV_SECRET,
      wwwUrl: trimSlash(env.WWW_URL || "https://www.alummahnow.net"),
      wwwOrigins: (env.WWW_ORIGINS || "")
         .split(",")
         .map((o) => trimSlash(o.trim()))
         .filter(Boolean),
      videosApiUrl: trimSlash(env.VIDEOS_API_URL),
      videosWebUrl: trimSlash(env.VIDEOS_WEB_URL),
   };
}
