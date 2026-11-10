/**
 * Builds (once per isolate) the bknd app in code mode on top of the D1 and R2 bindings.
 *
 * bknd never mutates the schema here: `syncSchema: false` and `isProduction: true` on every env.
 * The schema is created by `wrangler d1 migrations apply` (deploy workflows; locally `npm run
 * db:migrate:local`), and `npm run check:schema` proves migrations == src/schema.ts.
 */
import { Exception, type App } from "bknd";
import { createApp, registries, StorageR2Adapter, type CloudflareBkndConfig } from "bknd/adapter/cloudflare";
import { code } from "bknd/modes";
import { MEDIA_BINDING, moduleConfig } from "./bknd-config.ts";
import { contentRulesPlugin } from "./lib/content-rules.ts";
import { revisionsPlugin } from "./lib/revisions.ts";
import { feedPlugin } from "./lib/feed/plugin.ts";
import type { Env, RuntimeConfig } from "./env.ts";

/** 409: an upload would replace an existing media object (bknd serializes an Exception with its code). */
export class MediaExistsError extends Exception {
   constructor(name: string) {
      super(`A file named "${name}" already exists. Rename the file, or upload it without a name to get a generated one.`, 409);
      this.name = "MediaExistsError";
   }
}

/** Registers the "r2" media adapter on the MEDIA bucket (config `{ binding: "MEDIA" }`). */
export function registerR2(bucket: R2Bucket): void {
   class R2Media extends StorageR2Adapter {
      constructor(_config?: unknown) {
         super(bucket);
      }
      /**
       * Create-only: never replaces an existing object (audit CMS-1). bknd's adapter does a blind
       * put, so a second upload with the same name silently swapped the bytes of a published
       * image. R2 evaluates the condition atomically, so of N concurrent same-name uploads exactly
       * one writes; the others fail with 409 before bknd inserts a media row.
       */
      override async putObject(key: string, body: Parameters<StorageR2Adapter["putObject"]>[1]): Promise<string | undefined> {
         const fullKey = this.keyPrefix.length > 0 ? `${this.keyPrefix}/${key}`.replace(/^\/\//, "/") : key;
         let put: R2Object | null;
         try {
            put = await bucket.put(fullKey, body as never, { onlyIf: { etagDoesNotMatch: "*" } });
         } catch {
            return undefined; // as bknd's adapter: bknd answers "Failed to upload file"
         }
         if (put === null) throw new MediaExistsError(key);
         return put.etag;
      }
      override toJSON() {
         return { type: "r2", config: { binding: MEDIA_BINDING } };
      }
   }
   registries.media.register("r2", R2Media as never);
}

let cached: { key: string; app: Promise<App> } | undefined;

export function bkndConfig(cfg: RuntimeConfig, db?: D1Database, env?: Env): CloudflareBkndConfig<Env> {
   return code<CloudflareBkndConfig<Env>>({
      isProduction: true,
      syncSchema: false,
      config: moduleConfig({ jwtSecret: cfg.jwtSecret, secureCookie: !cfg.isLocal, publicUrl: cfg.publicUrl }),
      options: {
         plugins: [contentRulesPlugin(db), revisionsPlugin(db), feedPlugin(env)],
         // Run async event listeners inline: a cached app must not hold on to an old request's waitUntil.
         asyncEventsMode: "sync",
      },
      bindings: (env) => ({ db: env.DB }),
      // bknd's default registerMedia scans every env binding with util.inspect; register ours directly.
      registerMedia: (env) => registerR2(env.MEDIA),
      // bknd's admin UI is retired (docs/ADMIN_UI_SPEC.md §9): staff use the screens in src/admin.
      adminOptions: false,
   });
}

export function getBkndApp(env: Env, ctx: ExecutionContext, request: Request, cfg: RuntimeConfig): Promise<App> {
   const key = `${cfg.jwtSecret.length}:${cfg.publicUrl}`;
   if (!cached || cached.key !== key) {
      const app = createApp<Env>(bkndConfig(cfg, env.DB, env), { env, ctx, request });
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
