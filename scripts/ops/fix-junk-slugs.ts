/**
 * Gives pages and posts whose slug is only digits (the old new-post form left Arabic titles with no
 * slug, so editors typed "1", "2", …) a slug made from the title (src/lib/slug.ts). Dry run unless
 * --apply.
 *
 *   node --experimental-strip-types scripts/ops/fix-junk-slugs.ts --env qa|stage|production [--apply]
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
import { fallbackBase, firstFree, isJunkSlug, slugCandidates, slugify } from "../../src/lib/slug.ts";

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

/** The new slug for each junk row; `taken` is every slug in use, keyed "<table>:<locale>". */
export function planFixes(rows: SlugRow[], taken: Map<string, Set<string>>): SlugFix[] {
   const out: SlugFix[] = [];
   for (const row of rows) {
      if (!isJunkSlug(row.slug)) continue;
      const key = `${row.table}:${row.locale}`;
      const used = taken.get(key) ?? new Set<string>();
      taken.set(key, used);
      const fromTranslation = row.translation_slug && !isJunkSlug(row.translation_slug) ? row.translation_slug : "";
      const base = fromTranslation || slugify(row.title) || fallbackBase(row.table);
      const to = firstFree(slugCandidates(base, 200), [...used].filter((s) => s !== row.slug));
      if (!to) throw new Error(`no free slug for ${row.table} ${row.id} (${base})`);
      used.add(to);
      out.push({ ...row, to });
   }
   return out;
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
   const fixes = planFixes(rows, taken);
   console.log(`${env}: ${fixes.length} junk slug(s)`);
   for (const f of fixes) console.log(`  ${f.table} ${f.id} [${f.locale}, ${f.status}] /${f.slug} → /${f.to}  «${f.title}»`);
   if (!fixes.length || !apply) {
      if (fixes.length) console.log("dry run: pass --apply to change them");
      return;
   }
   d1(envArgs, fixSql(fixes));
   console.log(`applied ${fixes.length}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
   main().catch((e) => {
      console.error(String(e instanceof Error ? e.message : e));
      process.exit(1);
   });
}
