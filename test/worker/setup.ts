import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS ?? []);

// Loud guard (owner rule: no paid AI in tests): the real Workers AI binding is replaced by one that
// throws, so a test that forgets to inject the mock (test/support/workers-ai-mock.ts) fails at once
// instead of reaching a model.
(env as { AI?: unknown }).AI = {
   run() {
      throw new Error("REAL WORKERS AI CALLED UNDER TEST: inject mockWorkersAi() as env.AI");
   },
};
