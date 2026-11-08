/**
 * Release tags decide when production is deployed (monorepo CLAUDE.md "Deploy Rules"; same model
 * as AlUmmahNow #286). A production release is a tag `vYYYY.MM.DD` (or `vYYYY.MM.DD.N`, N >= 2, for
 * a later release the same day) on a commit that is on `main`.
 *
 *   node --experimental-strip-types scripts/release/release-tag.ts check <tag> <sha>
 *   # exits non-zero unless <tag> is valid and <sha> is on origin/main; writes previous=<tag> to $GITHUB_OUTPUT
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

const TAG = /^v(\d{4})\.(\d{2})\.(\d{2})(?:\.(\d+))?$/;

export interface ReleaseTag {
   tag: string;
   date: string;
   /** 1 for the day's first release, then 2, 3, ... */
   n: number;
}

/** Parses a release tag, or returns null when the name is not one (bad format, impossible date, `.0`/`.1`). */
export function parseReleaseTag(tag: string): ReleaseTag | null {
   const m = TAG.exec(tag);
   if (!m) return null;
   const [, y, mo, d, nRaw] = m;
   const date = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
   if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
   if (nRaw !== undefined && (Number(nRaw) < 2 || nRaw.startsWith("0"))) return null;
   return { tag, date: `${y}-${mo}-${d}`, n: nRaw === undefined ? 1 : Number(nRaw) };
}

export const tagError = (tag: string) =>
   `"${tag}" is not a release tag. Use vYYYY.MM.DD (a real date), or vYYYY.MM.DD.N with N >= 2 for a later release that day.`;

/** The release tag just before `current`, by date then sequence; null for the first release. */
export function previousTag(tags: readonly string[], current: string): string | null {
   const cur = parseReleaseTag(current);
   if (!cur) return null;
   const key = (t: ReleaseTag) => `${t.date}#${String(t.n).padStart(6, "0")}`;
   return (
      tags
         .map(parseReleaseTag)
         .filter((t): t is ReleaseTag => t !== null && key(t) < key(cur))
         .sort((a, b) => (key(a) < key(b) ? -1 : 1))
         .at(-1)?.tag ?? null
   );
}

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();

function isOnMain(sha: string): boolean {
   try {
      git("merge-base", "--is-ancestor", sha, "origin/main");
      return true;
   } catch {
      return false;
   }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
   const [cmd, tag, sha] = process.argv.slice(2);
   if (cmd !== "check" || !tag || !sha) {
      process.stderr.write("usage: release-tag.ts check <tag> <sha>\n");
      process.exit(2);
   }
   if (!parseReleaseTag(tag)) {
      process.stderr.write(`::error::${tagError(tag)}\n`);
      process.exit(1);
   }
   if (!isOnMain(sha)) {
      process.stderr.write(
         `::error::${tag} points at ${sha.slice(0, 7)}, which is not on main. Production is released only from main: merge first, then tag a commit on main.\n`,
      );
      process.exit(1);
   }
   const prev = previousTag(git("tag", "--list", "v*").split("\n").filter(Boolean), tag);
   process.stdout.write(`${tag} (${sha.slice(0, 7)}) is on main; previous release: ${prev ?? "none"}\n`);
   if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `previous=${prev ?? ""}\n`);
}
