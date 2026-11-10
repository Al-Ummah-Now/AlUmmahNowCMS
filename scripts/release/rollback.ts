/**
 * One-command rollback. Puts the CMS Worker back on the version it served before its latest
 * deployment (or on --to <version-id>), then runs the smoke. Code only: migrations are
 * expand-only and are never undone.
 *
 *   node --experimental-strip-types scripts/release/rollback.ts --env production [--to <id>] [--dry-run]
 *   node --experimental-strip-types scripts/release/rollback.ts --env production --from-result release-result.json --dry-run
 *
 * The target is resolved here (not left to wrangler), so a dry run names exactly the version a
 * real rollback would deploy.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENVS, parseEnv, type EnvName } from "./envs.ts";
import { runSmoke } from "./smoke.ts";

export interface RollbackArgs {
   env: EnvName;
   to?: string;
   fromResult?: string;
   reason: string;
   dryRun: boolean;
}

export function parseRollbackArgs(argv: string[]): RollbackArgs {
   const value = (flag: string) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
   const env = parseEnv(argv, ["production", "stage"]);
   const to = value("--to");
   if (to !== undefined && !/^[0-9a-f-]{36}$/i.test(to)) throw new Error("--to must be a version id (uuid)");
   return { env, to, fromResult: value("--from-result"), reason: value("--reason") ?? "manual rollback", dryRun: argv.includes("--dry-run") };
}

interface Deployment {
   created_on: string;
   versions: { version_id: string; percentage: number }[];
}

const mainVersion = (d: Deployment) => [...d.versions].sort((a, b) => b.percentage - a.percentage)[0]?.version_id;

/**
 * From `wrangler deployments list --json`: the version serving now and the one to roll back to,
 * i.e. the main version of the most recent earlier deployment that served something else.
 */
export function rollbackTarget(deploymentsJson: string, worker: string, to?: string): { current: string; target: string } {
   const deployments = (JSON.parse(deploymentsJson) as Deployment[]).slice().sort((a, b) => a.created_on.localeCompare(b.created_on));
   const latest = deployments.at(-1);
   if (!latest) throw new Error(`${worker} has no deployments`);
   if (latest.versions.length !== 1 && !to) {
      const split = latest.versions.map((v) => `${v.version_id}@${v.percentage}%`).join(", ");
      throw new Error(`${worker} is mid-promote (${split}); pick the version with --to`);
   }
   const current = mainVersion(latest)!;
   if (to) return { current, target: to };
   for (let i = deployments.length - 2; i >= 0; i--) {
      const v = mainVersion(deployments[i]);
      if (v && v !== current) return { current, target: v };
   }
   throw new Error(`${worker} has no earlier version to roll back to`);
}

/** The `previous` version recorded by promote.ts, when the result belongs to this env. */
export function targetFromResult(resultJson: string, env: EnvName): string | undefined {
   const r = JSON.parse(resultJson) as { env?: string; previous?: string | null };
   if (r.env !== env) throw new Error(`release-result.json is for ${r.env}, not ${env}`);
   return r.previous ?? undefined;
}

export function rollbackArgv(env: EnvName, target: string, reason: string): string[] {
   return ["rollback", target, "--name", ENVS[env].worker, "-y", "--message", reason.slice(0, 100)];
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(new URL(import.meta.url)));
if (isMain) {
   const args = parseRollbackArgs(process.argv.slice(2));
   const info = ENVS[args.env];
   const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
   const wrangler = (argv: string[]) =>
      execFileSync("npx", ["wrangler", ...argv], { cwd: root, encoding: "utf8", env: { ...process.env, CI: "true" }, stdio: ["ignore", "pipe", "pipe"] });
   try {
      const pinned = args.to ?? (args.fromResult ? targetFromResult(readFileSync(args.fromResult, "utf8"), args.env) : undefined);
      const { current, target } = rollbackTarget(wrangler(["deployments", "list", "--json", "--name", info.worker]), info.worker, pinned);
      const argv = rollbackArgv(args.env, target, args.reason);
      if (args.dryRun) {
         process.stdout.write(`${info.worker}: DRY RUN, would roll back ${current} -> ${target}\n  wrangler ${argv.join(" ")}\nNo traffic moved.\n`);
         process.exit(0);
      }
      wrangler(argv);
      process.stdout.write(`${info.worker}: ${current} -> ${target}\n`);
   } catch (error) {
      process.stderr.write(`${info.worker}: ROLLBACK FAILED: ${(error as { stderr?: string }).stderr ?? (error as Error).message}\n`);
      process.exit(1);
   }
   await new Promise((r) => setTimeout(r, 15000));
   const results = await runSmoke({ env: args.env });
   for (const r of results) process.stdout.write(`${r.ok ? "PASS" : "FAIL"}  ${r.name}: ${r.detail}\n`);
   if (results.some((r) => !r.ok)) process.exit(1);
}
