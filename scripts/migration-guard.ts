/**
 * Migration guard (SPEC §4, §8): migrations are expand-only and append-only.
 *
 *   node --experimental-strip-types scripts/migration-guard.ts [--base origin/main]
 *
 * Fails when
 *   - any migration contains a destructive statement (DROP …, RENAME, ALTER TABLE … DROP),
 *     or a DELETE/UPDATE without being explicitly allowed (data rewrites are not expand-only);
 *   - a migration that exists on the base ref was modified, deleted or renamed;
 *   - a new migration sorts before the latest one on the base ref (wrangler applies by name and
 *     would skip it where the later one already ran), or its name is not NNNN_snake_case.sql.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const MIGRATIONS_DIR = "migrations";
export const NAME = /^\d{4}_[a-z0-9_]+\.sql$/;

/** Removes SQL comments and string literals so keywords inside them don't count. */
export function stripSql(sql: string): string {
   return sql
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\n]*/g, " ")
      .replace(/'(?:[^']|'')*'/g, "''");
}

const RULES: { re: RegExp; why: string }[] = [
   { re: /\bdrop\s+(table|index|view|trigger|column)\b/i, why: "DROP is not expand-only" },
   { re: /\balter\s+table\s+[^;]*?\bdrop\b/i, why: "ALTER TABLE … DROP is not expand-only" },
   { re: /\brename\b/i, why: "RENAME is not expand-only (add a new column/table instead)" },
   { re: /\bdelete\s+from\b/i, why: "DELETE rewrites data; not allowed in a migration" },
   { re: /\bupdate\s+[\w"`[\]]+\s+set\b/i, why: "UPDATE rewrites data; not allowed in a migration" },
   { re: /\breplace\s+into\b/i, why: "REPLACE INTO deletes rows; not allowed" },
];

/** Destructive statements in one migration file. */
export function destructiveStatements(file: string, sql: string): string[] {
   const clean = stripSql(sql);
   const errors: string[] = [];
   for (const stmt of clean.split(";")) {
      const s = stmt.trim();
      if (!s) continue;
      for (const rule of RULES) {
         if (rule.re.test(s)) errors.push(`${file}: ${rule.why}: ${s.replace(/\s+/g, " ").slice(0, 120)}`);
      }
   }
   return errors;
}

export interface MigrationFile {
   name: string;
   content: string;
}

/**
 * @param head  migration files now (working tree)
 * @param base  migration files on the base ref (already merged; may have run somewhere)
 */
export function checkMigrations(head: MigrationFile[], base: MigrationFile[]): string[] {
   const errors: string[] = [];
   const headByName = new Map(head.map((f) => [f.name, f]));
   const latestBase = base.map((f) => f.name).sort().at(-1);
   for (const b of base) {
      const h = headByName.get(b.name);
      if (!h) errors.push(`${MIGRATIONS_DIR}/${b.name}: merged migration deleted or renamed. Never remove one.`);
      else if (h.content !== b.content) errors.push(`${MIGRATIONS_DIR}/${b.name}: merged migration modified. Add a new migration instead.`);
   }
   const baseNames = new Set(base.map((f) => f.name));
   for (const h of head) {
      if (!NAME.test(h.name)) errors.push(`${MIGRATIONS_DIR}/${h.name}: name must look like 0002_add_things.sql`);
      if (!baseNames.has(h.name) && latestBase && h.name <= latestBase) {
         errors.push(`${MIGRATIONS_DIR}/${h.name}: sorts before the latest merged migration (${latestBase}); it may never run.`);
      }
      errors.push(...destructiveStatements(`${MIGRATIONS_DIR}/${h.name}`, h.content));
   }
   const prefixes = head.map((f) => f.name.slice(0, 4));
   for (const p of new Set(prefixes)) {
      if (prefixes.filter((x) => x === p).length > 1) errors.push(`${MIGRATIONS_DIR}: two migrations share the number ${p}`);
   }
   return errors;
}

function readHead(root: string): MigrationFile[] {
   return readdirSync(join(root, MIGRATIONS_DIR))
      .filter((n) => n.endsWith(".sql"))
      .map((name) => ({ name, content: readFileSync(join(root, MIGRATIONS_DIR, name), "utf8") }));
}

function readBase(root: string, ref: string): MigrationFile[] {
   const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
   // An unknown base ref is an error, never "no migrations" (that would skip the append-only rules).
   try {
      git("rev-parse", "--verify", "--quiet", `${ref}^{tree}`);
   } catch {
      throw new Error(`unknown base ref: ${ref}`);
   }
   let names: string[];
   try {
      names = git("ls-tree", "--name-only", `${ref}:${MIGRATIONS_DIR}`).split("\n").filter((n) => n.endsWith(".sql"));
   } catch {
      return []; // the base has no migrations directory yet
   }
   return names.map((name) => ({ name, content: git("show", `${ref}:${MIGRATIONS_DIR}/${name}`) }));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
   const argv = process.argv.slice(2);
   const base = argv.includes("--base") ? argv[argv.indexOf("--base") + 1] : "origin/main";
   const root = resolve(new URL("..", import.meta.url).pathname);
   const errors = checkMigrations(readHead(root), readBase(root, base));
   if (errors.length) {
      process.stderr.write(`Migration guard failed (base ${base}):\n${errors.map((e) => `  - ${e}`).join("\n")}\n`);
      process.exit(1);
   }
   process.stdout.write(`Migration guard passed (base ${base}).\n`);
}
