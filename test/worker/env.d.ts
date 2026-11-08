// Bindings seen by `env` from "cloudflare:test" (wrangler.jsonc + vitest.config.ts miniflare bindings).
type CmsWorkerEnv = import("../../src/env.ts").Env;
type CmsD1Migration = import("cloudflare:test").D1Migration;

declare namespace Cloudflare {
   interface Env extends CmsWorkerEnv {
      TEST_MIGRATIONS?: CmsD1Migration[];
   }
}
