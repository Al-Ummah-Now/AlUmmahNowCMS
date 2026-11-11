/**
 * Gives pages and posts whose slug is only digits (the old new-post form left Arabic titles with no
 * slug, so editors typed "1", "2", …) a slug made from the title, by the editor's order
 * (src/lib/slug-suggest.ts): the linked English version's slug, an English title, the Arabic title
 * translated to a short English phrase (--english), else transliteration. Dry run unless --apply.
 *
 *   node --experimental-strip-types scripts/ops/fix-junk-slugs.ts --env qa|stage|production [--english] [--apply]
 *
 * --english calls Workers AI over the REST API with the logged-in wrangler token, with the same prompt
 *   and output check as the editor: one tiny call per Arabic title. A manual operation, never a test.
 *
 * - The new slug is unique in its table and locale (-2, -3, …), the same rule as the editor and API.
 * - www keeps no redirects from old slugs, so the old address stops working: on production, run it
 *   only with the owner's go-ahead.
 * - Each changed post is marked dirty for the home timeline (feed_dirty "p<id>"); the next build, or
 *   the 30-minute verifier, rewrites its card with the new address.
 * Uses the env's D1 through `wrangler d1 execute --remote` (the pipeline's Cloudflare credentials).
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENVS, parseEnv } from "../release/envs.ts";
import { fallbackBase, firstFree, hasArabic, isJunkSlug, slugCandidates, slugify } from "../../src/lib/slug.ts";
import { phraseSlug, SLUG_SCHEMA, SLUG_SYSTEM } from "../../src/lib/slug-suggest.ts";
import { MODEL_ID } from "../../src/lib/ai/prompts.ts";
import { createWorkersAiProvider, type AiBinding } from "../../src/lib/ai/providers/workers-ai.ts";

export interface SlugRow {
   table: "pages" | "posts";
   id: number;
   locale: string;
   slug: string;
   title: string;
   status: string;
   translation_slug: string | null;
}

export interface SlugFix extends SlugRow {
   to: string;
}

/**
 * The new slug for each junk row; `taken` is every slug in use, keyed "<table>:<locale>". `english`
 * holds the English phrase slug for a row id ("<table>:<id>") when one was suggested.
 */
export function planFixes(rows: SlugRow[], taken: Map<string, Set<string>>, english: Map<string, string> = new Map()): SlugFix[] {
   const out: SlugFix[] = [];
   for (const row of rows) {
      if (!isJunkSlug(row.slug)) continue;
      const key = `${row.table}:${row.locale}`;
      const used = taken.get(key) ?? new Set<string>();
      taken.set(key, used);
      const fromTranslation = row.translation_slug && !isJunkSlug(row.translation_slug) ? row.translation_slug : "";
      const base = fromTranslation || english.get(`${row.table}:${row.id}`) || slugify(row.title) || fallbackBase(row.table);
      const to = firstFree(slugCandidates(base, 200), [...used].filter((s) => s !== row.slug));
      if (!to) throw new Error(`no free slug for ${row.table} ${row.id} (${base})`);
      used.add(to);
      out.push({ ...row, to });
   }
   return out;
}

/** Workers AI over the REST API (`accounts/{id}/ai/run/{model}`), shaped as the binding. */
export function restBinding(accountId: string, token: string, fetchImpl: typeof fetch = fetch): AiBinding {
   return {
      async run(model, inputs) {
         const res = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify(inputs),
         });
         const body = (await res.json().catch(() => ({}))) as { result?: unknown; errors?: { code?: number; message?: string }[] };
         if (!res.ok) throw new Error(`AiError: ${body.errors?.[0]?.message ?? res.status} (${body.errors?.[0]?.code ?? res.status})`);
         return body.result;
      },
   };
}

/** The English phrase slug for an Arabic title (the editor's prompt and check), or null. */
export async function englishSlug(ai: AiBinding, title: string): Promise<string | null> {
   const out = await createWorkersAiProvider(ai, { timeoutMs: 30_000 }).complete({
      model: MODEL_ID,
      system: SLUG_SYSTEM,
      messages: [{ role: "user", content: `<title>\n${title}\n</title>` }],
      schema: SLUG_SCHEMA as unknown as Record<string, unknown>,
      reasoning: "none",
      maxTokens: 120,
   });
   return out.ok ? phraseSlug(out.json) : null;
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

export function fixSql(fixes: SlugFix[], now = new Date().toISOString()): string {
   return fixes
      .flatMap((f) => [
         // Guarded on the old slug: a row someone renamed meanwhile is left alone.
         `UPDATE ${f.table} SET slug = ${q(f.to)}, updated_at = ${q(now)} WHERE id = ${f.id} AND slug = ${q(f.slug)};`,
         ...(f.table === "posts" ? [`INSERT INTO feed_dirty (item, created_at) VALUES ('p${f.id}', ${q(now)});`] : []),
      ])
      .join("\n");
}

/** The Cloudflare account of every env (wrangler.jsonc has none: wrangler picks it from the login). */
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? "0e4b6e7f9faf280c3c9bf95995edc64f";

function wranglerToken(): string {
   const token = execFileSync("npx", ["wrangler", "auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .split("\n")
      .map((l) => l.trim())
      .find((l) => /^[A-Za-z0-9._-]{20,}$/.test(l));
   if (!token) throw new Error("no wrangler token: run `npx wrangler login`");
   return token;
}

/** Sends the feed queue one build message ({ kind: "build" }, src/lib/feed/jobs.ts FeedMessage). */
async function wakeFeed(queueName: string, token: string): Promise<void> {
   const api = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/queues`;
   const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
   const list = (await (await fetch(`${api}?per_page=100`, { headers })).json()) as { result?: { queue_id: string; queue_name: string }[] };
   const q = list.result?.find((r) => r.queue_name === queueName);
   if (!q) throw new Error(`queue ${queueName} not found`);
   const res = await fetch(`${api}/${q.queue_id}/messages`, { method: "POST", headers, body: JSON.stringify({ body: { kind: "build", reason: "slug fix" }, content_type: "json" }) });
   if (!res.ok) throw new Error(`queue send failed: ${res.status} ${await res.text()}`);
}

function d1(envArgs: string[], sql: string): Record<string, unknown>[] {
   const out = execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--remote", "--json", ...envArgs, "--command", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
   return (JSON.parse(out) as { results: Record<string, unknown>[] }[]).flatMap((r) => r.results);
}

async function main() {
   const env = parseEnv(process.argv);
   const apply = process.argv.includes("--apply");
   const { envArgs } = ENVS[env];
   const rows: SlugRow[] = [];
   const taken = new Map<string, Set<string>>();
   for (const table of ["pages", "posts"] as const) {
      const all = d1(
         envArgs,
         `SELECT t.id, t.locale, t.slug, t.title, t.status,
                 (SELECT o.slug FROM ${table} o WHERE o.translation_key = t.translation_key AND o.locale <> t.locale ORDER BY o.id LIMIT 1) AS translation_slug
            FROM ${table} t`,
      );
      for (const r of all) {
         const row: SlugRow = { table, id: Number(r.id), locale: String(r.locale), slug: String(r.slug), title: String(r.title ?? ""), status: String(r.status), translation_slug: (r.translation_slug as string | null) ?? null };
         const key = `${table}:${row.locale}`;
         if (!taken.has(key)) taken.set(key, new Set());
         taken.get(key)!.add(row.slug);
         if (isJunkSlug(row.slug)) rows.push(row);
      }
   }
   const english = new Map<string, string>();
   if (process.argv.includes("--english")) {
      const ai = restBinding(ACCOUNT_ID, wranglerToken());
      for (const r of rows) {
         if (!hasArabic(r.title) || (r.translation_slug && !isJunkSlug(r.translation_slug))) continue;
         const slug = await englishSlug(ai, r.title);
         console.log(`  english for ${r.table} ${r.id}: ${slug ?? "(none: transliteration)"}`);
         if (slug) english.set(`${r.table}:${r.id}`, slug);
      }
   }
   const fixes = planFixes(rows, taken, english);
   console.log(`${env}: ${fixes.length} junk slug(s)`);
   for (const f of fixes) console.log(`  ${f.table} ${f.id} [${f.locale}, ${f.status}] /${f.slug} → /${f.to}  «${f.title}»`);
   if (!fixes.length || !apply) {
      if (fixes.length) console.log("dry run: pass --apply to change them");
      return;
   }
   d1(envArgs, fixSql(fixes));
   console.log(`applied ${fixes.length}`);
   if (fixes.some((f) => f.table === "posts")) {
      // Wake the timeline builder now (what markDirty does in the Worker); the 30-minute verifier
      // would otherwise pick the dirty rows up on its own.
      await wakeFeed(ENVS[env].feed.queue, wranglerToken());
      console.log(`home timeline build queued on ${ENVS[env].feed.queue}`);
   }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
   main().catch((e) => {
      console.error(String(e instanceof Error ? e.message : e));
      process.exit(1);
   });
}
