/** Worker bindings and vars (wrangler.jsonc), plus the derived runtime config. */
export interface Env {
   DB: D1Database;
   MEDIA: R2Bucket;
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

const trimSlash = (u: string) => u.replace(/\/+$/, "");

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
