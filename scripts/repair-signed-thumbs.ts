/**
 * Rewrites signed (expiring) video thumbnail URLs already stored by the CMS into the videos web
 * app's stable `<VIDEOS_WEB_URL>/thumb/<videoId>.jpg` (src/lib/stable-thumb.ts, the same helper the
 * Worker now uses when it writes and serves snapshots). Dry run unless --apply.
 *
 *   node --experimental-strip-types scripts/repair-signed-thumbs.ts --env qa|stage|production [--apply [--allow-production]]
 *
 * What it touches, per env:
 * - D1 `video_snapshots.snapshot`, `curated_videos.snapshot`, `trash.data`: each row whose text
 *   carries a signed URL. Every write is a compare-and-set on the text that was read
 *   (`WHERE … AND <column> = ?old`), so a snapshot refresh that ran meanwhile is never overwritten.
 * - KV FEED (www's home timeline): every value with a signed URL. The value is read again just
 *   before the write and skipped when it changed (a timeline build got there first).
 *
 * Talks to Cloudflare's REST API with the `wrangler login` OAuth token (refreshed through
 * `npx wrangler whoami` on a 401). The token is never printed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENVS, parseEnv, type EnvName } from "./release/envs.ts";
import { stableDeep } from "../src/lib/stable-thumb.ts";

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "0e4b6e7f9faf280c3c9bf95995edc64f";
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}`;
const KV_CONCURRENCY = 8;

/** VIDEOS_WEB_URL per env (wrangler.jsonc). */
export const VIDEOS_WEB: Record<EnvName, string> = {
   production: "https://videos.alummahnow.net",
   stage: "https://videos.stage.alummahnow.net",
   qa: "https://videos.qa.alummahnow.net",
};

/** The D1 columns that hold copies of video snapshots, and the key a compare-and-set needs. */
export const TABLES = [
   { table: "video_snapshots", column: "snapshot", key: ["kind", "ref_id"] },
   { table: "curated_videos", column: "snapshot", key: ["id"] },
   { table: "trash", column: "data", key: ["id"] },
] as const;

/** Cheap pre-filter in SQL; the exact check is isSignedUrl in the helper. */
const CANDIDATE = (col: string) => `(${col} LIKE '%bcdn_token=%' OR (${col} LIKE '%token=%' AND ${col} LIKE '%expires=%') OR ${col} LIKE '%/priv/%')`;

/** The stored text with its signed URLs rewritten, or null when there is nothing to change. */
export function repairText(webUrl: string, text: string): { next: string; changed: number; dropped: number } | null {
   let parsed: unknown;
   try {
      parsed = JSON.parse(text);
   } catch {
      return null;
   }
   const { value, changed, dropped } = stableDeep(webUrl, parsed);
   return changed ? { next: JSON.stringify(value), changed, dropped } : null;
}

/* Cloudflare REST with the wrangler OAuth token */

const WRANGLER_CONFIG = join(homedir(), "Library", "Preferences", ".wrangler", "config", "default.toml");
let token: string | null = null;

function readToken(): string {
   const text = readFileSync(WRANGLER_CONFIG, "utf8");
   const m = /^oauth_token\s*=\s*"([^"]+)"/m.exec(text);
   if (!m) throw new Error("no wrangler OAuth token: run `npx wrangler login`");
   return m[1];
}

function refreshToken(): void {
   // whoami refreshes an expired OAuth token in place.
   execFileSync("npx", ["wrangler", "whoami"], { stdio: ["ignore", "ignore", "ignore"] });
   token = readToken();
}

async function cf(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
   token ??= readToken();
   const used = token;
   const res = await fetch(`${API}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), authorization: `Bearer ${used}` } });
   if (res.status === 401 && !retried) {
      // Parallel requests: only the first to see the expired token refreshes it.
      if (token === used) refreshToken();
      return cf(path, init, true);
   }
   return res;
}

async function d1(dbId: string, sql: string, params: unknown[] = []): Promise<{ results: Record<string, unknown>[]; changes: number }> {
   const res = await cf(`/d1/database/${dbId}/query`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql, params }) });
   const body = (await res.json().catch(() => ({}))) as { success?: boolean; result?: { results?: Record<string, unknown>[]; meta?: { changes?: number } }[]; errors?: { message?: string }[] };
   if (!res.ok || !body.success) throw new Error(`D1 query failed (${res.status}): ${body.errors?.[0]?.message ?? "unknown error"}`);
   const r = body.result?.[0];
   return { results: r?.results ?? [], changes: Number(r?.meta?.changes ?? 0) };
}

const kvPath = (ns: string, key: string) => `/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`;

async function kvKeys(ns: string): Promise<{ name: string; expiration?: number; metadata?: unknown }[]> {
   const out: { name: string; expiration?: number; metadata?: unknown }[] = [];
   let cursor = "";
   do {
      const res = await cf(`/storage/kv/namespaces/${ns}/keys?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      const body = (await res.json()) as { success?: boolean; result?: { name: string; expiration?: number; metadata?: unknown }[]; result_info?: { cursor?: string }; errors?: { message?: string }[] };
      if (!res.ok || !body.success) throw new Error(`KV list failed (${res.status}): ${body.errors?.[0]?.message ?? "unknown error"}`);
      out.push(...(body.result ?? []));
      cursor = body.result_info?.cursor ?? "";
   } while (cursor);
   return out;
}

async function kvGet(ns: string, key: string): Promise<string | null> {
   const res = await cf(kvPath(ns, key));
   if (res.status === 404) return null;
   if (!res.ok) throw new Error(`KV get ${key} failed (${res.status})`);
   return res.text();
}

async function kvPut(ns: string, key: string, value: string, expiration?: number): Promise<void> {
   const res = await cf(`${kvPath(ns, key)}${expiration ? `?expiration=${expiration}` : ""}`, { method: "PUT", headers: { "content-type": "text/plain" }, body: value });
   if (!res.ok) throw new Error(`KV put ${key} failed (${res.status})`);
}

/* The run */

interface Count {
   scanned: number;
   affected: number;
   urls: number;
   dropped: number;
   written: number;
   skipped: number;
}
const zero = (): Count => ({ scanned: 0, affected: 0, urls: 0, dropped: 0, written: 0, skipped: 0 });

async function repairTable(dbId: string, webUrl: string, t: (typeof TABLES)[number], apply: boolean): Promise<Count> {
   const c = zero();
   const total = await d1(dbId, `SELECT COUNT(*) AS n FROM ${t.table}`);
   c.scanned = Number(total.results[0]?.n ?? 0);
   const cols = [...t.key, t.column].join(", ");
   let last = 0;
   for (;;) {
      // Paged by rowid so a large table is read in bounded pieces.
      const page = await d1(dbId, `SELECT rowid AS _rowid, ${cols} FROM ${t.table} WHERE rowid > ?1 AND ${CANDIDATE(t.column)} ORDER BY rowid LIMIT 200`, [last]);
      if (!page.results.length) break;
      for (const row of page.results) {
         last = Number(row._rowid);
         const old = row[t.column];
         if (typeof old !== "string") continue;
         const fix = repairText(webUrl, old);
         if (!fix) continue;
         c.affected++;
         c.urls += fix.changed;
         c.dropped += fix.dropped;
         if (!apply) continue;
         const where = t.key.map((k, i) => `${k} = ?${i + 2}`).join(" AND ");
         const res = await d1(dbId, `UPDATE ${t.table} SET ${t.column} = ?1 WHERE ${where} AND ${t.column} = ?${t.key.length + 2}`, [fix.next, ...t.key.map((k) => row[k]), old]);
         if (res.changes > 0) c.written++;
         else c.skipped++;
      }
   }
   return c;
}

async function repairKv(ns: string, webUrl: string, apply: boolean): Promise<Count> {
   const c = zero();
   const keys = await kvKeys(ns);
   c.scanned = keys.length;
   process.stderr.write(`  KV FEED: ${keys.length} keys to read\n`);
   let next = 0;
   const one = async (k: (typeof keys)[number]) => {
      const old = await kvGet(ns, k.name);
      if (old === null) return;
      const fix = repairText(webUrl, old);
      if (!fix) return;
      c.affected++;
      c.urls += fix.changed;
      c.dropped += fix.dropped;
      if (!apply) return;
      if (k.metadata !== undefined && k.metadata !== null) {
         // A plain PUT would drop the key's metadata; the feed never sets any, so leave such a key alone.
         c.skipped++;
         return;
      }
      // Read again just before writing: a timeline build that rewrote the key meanwhile wins.
      if ((await kvGet(ns, k.name)) !== old) {
         c.skipped++;
         return;
      }
      await kvPut(ns, k.name, fix.next, k.expiration);
      c.written++;
   };
   // A few reads at a time (one key's write is still read-compare-write on its own).
   await Promise.all(
      Array.from({ length: Math.min(KV_CONCURRENCY, keys.length) }, async () => {
         while (next < keys.length) await one(keys[next++]);
      }),
   );
   return c;
}

function line(name: string, c: Count, apply: boolean): string {
   const base = `  ${name.padEnd(26)} scanned ${c.scanned}, with signed URLs ${c.affected}, URLs ${c.urls} (→ /thumb ${c.urls - c.dropped}, → null ${c.dropped})`;
   return apply ? `${base}; written ${c.written}, skipped ${c.skipped}` : base;
}

async function main() {
   const argv = process.argv;
   const env = parseEnv(argv);
   const apply = argv.includes("--apply");
   if (apply && env === "production" && !argv.includes("--allow-production")) throw new Error("--apply on production also needs --allow-production");
   const info = ENVS[env];
   const webUrl = VIDEOS_WEB[env];
   console.log(`${env}: ${apply ? "APPLY" : "dry run"} (signed thumbnails → ${webUrl}/thumb/<id>.jpg)`);
   for (const t of TABLES) console.log(line(`D1 ${t.table}.${t.column}`, await repairTable(info.d1.id, webUrl, t, apply), apply));
   console.log(line("KV FEED", await repairKv(info.feed.kvId, webUrl, apply), apply));
   if (!apply) console.log("dry run: pass --apply to write");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
   main().catch((e) => {
      console.error(String(e instanceof Error ? e.message : e));
      process.exit(1);
   });
}
