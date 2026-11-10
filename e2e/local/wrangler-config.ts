/**
 * The local E2E's wrangler config: production's top level from wrangler.jsonc without the Workers AI
 * binding (`wrangler dev` needs Cloudflare credentials for it; the E2E has none). The "on" instance
 * talks to the mock server's Workers AI instead (AI_MOCK_URL, src/lib/ai/config.ts). Paths are made
 * absolute so the file can live in .e2e-local/.
 *
 *   node --experimental-strip-types e2e/local/wrangler-config.ts <out.json>
 */
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseJsonc } from "../../scripts/lib/jsonc.ts";

const root = resolve(import.meta.dirname, "../..");
const config = parseJsonc<Record<string, unknown>>(readFileSync(resolve(root, "wrangler.jsonc"), "utf8"));
delete config.$schema;
delete config.ai;
delete config.env;
config.main = resolve(root, String(config.main));
for (const d of (config.d1_databases as { migrations_dir?: string }[]) ?? []) if (d.migrations_dir) d.migrations_dir = resolve(root, d.migrations_dir);
const out = resolve(process.argv[2]);
writeFileSync(`${out}.tmp`, JSON.stringify(config, null, 2));
renameSync(`${out}.tmp`, out);
