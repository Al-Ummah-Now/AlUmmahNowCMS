/**
 * After a promote (stage, production) or the QA deploy: make sure the home timeline in KV is in the
 * deployed code's feed FORMAT, rebuilding it if not, and wait until it is (docs/FEED.md "Format
 * version"). Idempotent: when the feed is current it changes nothing.
 *
 *   node --experimental-strip-types scripts/release/feed-format.ts --env qa|stage|production [--timeout 900]
 *
 * 1. Mints a random token and stores only its SHA-256 in the env's D1 (system_tokens, 30 min), with
 *    the pipeline's Cloudflare credentials (`wrangler d1 execute --remote`). Nothing new to configure:
 *    whoever can run the migrations can call this, nobody else.
 * 2. POST {url}/api/release/v1/feed-format: the Worker starts the same full rebuild as the Timeline
 *    screen's button (src/lib/feed/auto-rebuild.ts), logged as "system/release".
 * 3. Polls GET until every head and D1 carry the code's format (the KV head may lag ~60 s), or fails
 *    after --timeout seconds.
 * 4. Deletes the token (always).
 */
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENVS, parseEnv } from "./envs.ts";

export interface FormatState {
   code: number;
   heads: Record<string, number | null>;
   built: number;
   rebuilding: boolean;
   current: boolean;
}

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

/** SQL for the token row. Only hex and an ISO date are interpolated (checked). */
export function insertTokenSql(hash: string, expiresAt: Date, now = new Date()): string {
   if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("bad token hash");
   return `INSERT INTO system_tokens (token_hash, purpose, expires_at, created_at) VALUES ('${hash}', 'feed-format', '${expiresAt.toISOString()}', '${now.toISOString()}')`;
}

export function deleteTokenSql(hash: string): string {
   if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("bad token hash");
   return `DELETE FROM system_tokens WHERE token_hash = '${hash}'`;
}

/** One line for the log. */
export const describe = (s: FormatState) =>
   `code format ${s.code}; stored: ${Object.entries(s.heads)
      .map(([l, f]) => `${l}=${f ?? "none"}`)
      .join(", ")}, last full rebuild ${s.built}${s.rebuilding ? "; rebuilding" : ""}`;

export async function waitCurrent(
   get: () => Promise<FormatState>,
   opts: {
      timeoutMs: number;
      intervalMs?: number;
      sleep?: (ms: number) => Promise<void>;
      log?: (s: string) => void;
      now?: () => number;
   },
): Promise<FormatState> {
   const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
   const now = opts.now ?? Date.now;
   const until = now() + opts.timeoutMs;
   for (;;) {
      const s = await get();
      opts.log?.(describe(s));
      if (s.current) return s;
      if (now() >= until) throw new Error(`feed still not in format ${s.code} after ${Math.round(opts.timeoutMs / 1000)} s (${describe(s)})`);
      await sleep(opts.intervalMs ?? 10_000);
   }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(new URL(import.meta.url)));
if (isMain) {
   const argv = process.argv.slice(2);
   const env = parseEnv(argv);
   const t = argv.indexOf("--timeout");
   const timeoutMs = (t >= 0 ? Number(argv[t + 1]) : 900) * 1000;
   const info = ENVS[env];
   const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
   const d1 = (sql: string) =>
      execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--remote", ...info.envArgs, "--command", sql], {
         cwd: root,
         encoding: "utf8",
         env: { ...process.env, CI: "true" },
         stdio: ["ignore", "pipe", "pipe"],
      });
   const token = randomBytes(32).toString("base64url");
   const hash = sha256Hex(token);
   const url = `${info.url}/api/release/v1/feed-format`;
   const headers = {
      Authorization: `Bearer ${token}`,
      "User-Agent": "al-ummah-now-cms-release",
   };
   const call = async (method: "GET" | "POST"): Promise<Record<string, unknown>> => {
      const res = await fetch(url, { method, headers });
      if (!res.ok) throw new Error(`${method} ${url}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return ((await res.json()) as { data: Record<string, unknown> }).data;
   };
   d1(insertTokenSql(hash, new Date(Date.now() + 30 * 60_000)));
   let code = 0;
   try {
      const started = await call("POST");
      process.stdout.write(`${info.worker}: ${String(started.action)}\n`);
      await waitCurrent(async () => (await call("GET")) as unknown as FormatState, { timeoutMs, log: (s) => process.stdout.write(`  ${s}\n`) });
      process.stdout.write(`${info.worker}: the home timeline is in the current format\n`);
   } catch (error) {
      process.stderr.write(`::error::${(error as Error).message}\n`);
      code = 1;
   } finally {
      try {
         d1(deleteTokenSql(hash));
      } catch (error) {
         process.stderr.write(`could not delete the release token (it expires in 30 min): ${(error as Error).message}\n`);
      }
   }
   process.exit(code);
}
