/**
 * Feed format guard (docs/FEED.md "Format version"): FEED_FORMAT_HISTORY in
 * src/lib/feed/format.ts is append-only, and FEED_FORMAT never goes down.
 *
 *   node --experimental-strip-types scripts/check-feed-format.ts [--base origin/main]
 *
 * With test/node/feed-format.test.ts (history[FEED_FORMAT] == the fingerprint of today's types) this
 * means a change to the stored feed's shape can only pass CI with a FEED_FORMAT bump: editing the
 * current entry instead of appending one fails here.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = "src/lib/feed/format.ts";

export interface FormatFile {
   format: number;
   history: Map<number, string>;
}

export function parseFormatFile(text: string): FormatFile {
   const f = /export const FEED_FORMAT\s*=\s*(\d+)\s*;/.exec(text);
   if (!f) throw new Error(`${FILE}: FEED_FORMAT not found`);
   const block = /FEED_FORMAT_HISTORY[^=]*=\s*\{([\s\S]*?)\};/.exec(text);
   if (!block) throw new Error(`${FILE}: FEED_FORMAT_HISTORY not found`);
   const history = new Map<number, string>();
   for (const m of block[1].matchAll(/^\s*(\d+)\s*:\s*"([0-9a-f]+)"/gm)) history.set(Number(m[1]), m[2]);
   return { format: Number(f[1]), history };
}

/** Problems with going from `base` to `head` (empty: fine). */
export function formatProblems(base: FormatFile | null, head: FormatFile): string[] {
   const out: string[] = [];
   const keys = [...head.history.keys()].sort((a, b) => a - b);
   if (keys.length !== head.format || keys.some((k, i) => k !== i + 1)) out.push(`FEED_FORMAT_HISTORY must have exactly the entries 1..${head.format} (FEED_FORMAT), has ${keys.join(", ") || "none"}`);
   if (!base) return out;
   if (head.format < base.format) out.push(`FEED_FORMAT went down from ${base.format} to ${head.format}; formats only go up`);
   for (const [k, v] of base.history) {
      if (!head.history.has(k)) out.push(`FEED_FORMAT_HISTORY entry ${k} was removed; entries are append-only`);
      else if (head.history.get(k) !== v) out.push(`FEED_FORMAT_HISTORY entry ${k} was edited (${v} → ${head.history.get(k)}); bump FEED_FORMAT and append a new entry instead`);
   }
   return out;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(new URL(import.meta.url)));
if (isMain) {
   const argv = process.argv.slice(2);
   const i = argv.indexOf("--base");
   const baseRef = i >= 0 ? argv[i + 1] : null;
   const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
   const head = parseFormatFile(readFileSync(resolve(root, FILE), "utf8"));
   let base: FormatFile | null = null;
   if (baseRef) {
      try {
         base = parseFormatFile(
            execFileSync("git", ["show", `${baseRef}:${FILE}`], {
               cwd: root,
               encoding: "utf8",
               stdio: ["ignore", "pipe", "pipe"],
            }),
         );
      } catch {
         base = null; // the file is new on this branch
      }
   }
   const problems = formatProblems(base, head);
   for (const p of problems) process.stderr.write(`check-feed-format: ${p}\n`);
   if (problems.length) process.exit(1);
   process.stdout.write(`check-feed-format: OK (FEED_FORMAT ${head.format})\n`);
}
