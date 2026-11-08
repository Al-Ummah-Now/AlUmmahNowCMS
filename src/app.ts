/**
 * Builds (once per isolate) the bknd app in code mode on top of the D1 and R2 bindings.
 *
 * bknd never mutates the schema here: `syncSchema: false` and `isProduction: true` on every env.
 * The schema is created by `wrangler d1 migrations apply` (deploy workflows; locally `npm run
 * db:migrate:local`), and `npm run check:schema` proves migrations == src/schema.ts.
 */
import type { App } from "bknd";
import { createApp, registries, StorageR2Adapter, type CloudflareBkndConfig } from "bknd/adapter/cloudflare";
import { code } from "bknd/modes";
import { MEDIA_BINDING, moduleConfig } from "./bknd-config.ts";
import { contentRulesPlugin } from "./lib/content-rules.ts";
import type { Env, RuntimeConfig } from "./env.ts";

/** Registers the "r2" media adapter on the MEDIA bucket (config `{ binding: "MEDIA" }`). */
export function registerR2(bucket: R2Bucket): void {
   class R2Media extends StorageR2Adapter {
      constructor(_config?: unknown) {
         super(bucket);
      }
      override toJSON() {
         return { type: "r2", config: { binding: MEDIA_BINDING } };
      }
   }
   registries.media.register("r2", R2Media as never);
}

let cached: { key: string; app: Promise<App> } | undefined;

export function bkndConfig(cfg: RuntimeConfig): CloudflareBkndConfig<Env> {
   return code<CloudflareBkndConfig<Env>>({
      isProduction: true,
      syncSchema: false,
      config: moduleConfig({ jwtSecret: cfg.jwtSecret, secureCookie: !cfg.isLocal, publicUrl: cfg.publicUrl }),
      options: {
         plugins: [contentRulesPlugin()],
         // Run async event listeners inline: a cached app must not hold on to an old request's waitUntil.
         asyncEventsMode: "sync",
      },
      bindings: (env) => ({ db: env.DB }),
      // bknd's default registerMedia scans every env binding with util.inspect; register ours directly.
      registerMedia: (env) => registerR2(env.MEDIA),
      adminOptions: { logoReturnPath: "/", theme: "light" },
   });
}

export function getBkndApp(env: Env, ctx: ExecutionContext, request: Request, cfg: RuntimeConfig): Promise<App> {
   const key = `${cfg.jwtSecret.length}:${cfg.publicUrl}`;
   if (!cached || cached.key !== key) {
      const app = createApp<Env>(bkndConfig(cfg), { env, ctx, request });
      cached = { key, app };
      app.catch(() => {
         if (cached?.app === app) cached = undefined;
      });
   }
   return cached.app;
}

/** Test hook: drop the cached app (a new D1 binding per test). */
export function resetBkndApp(): void {
   cached = undefined;
}
