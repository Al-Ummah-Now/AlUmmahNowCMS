/**
 * Stage-then-promote (docs/PLAN.md "Release mechanics"), modelled on AlUmmahNowAuth:
 * upload the already-built bundle as a new version, give it 0 % traffic, smoke it through the
 * `Cloudflare-Workers-Version-Overrides` header, then move 100 %, smoke again, and roll back
 * automatically if anything fails.
 *
 *   node --experimental-strip-types scripts/release/promote.ts --env stage|production [--message <text>]
 *
 * Expects the build job's bundle at dist/<env>/index.js. Writes release-result.json
 * ({ env, status, worker, previous, candidate }) for the rollback dry run / rollback workflow.
 * The very first release of a Worker (no deployment yet) is a plain deploy with no rollback target.
 */
import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ENVS, parseEnv, type EnvName } from "./envs.ts";
import { runSmoke, type CheckResult } from "./smoke.ts";

export type ReleaseEnv = Extract<EnvName, "stage" | "production">;

/** "Worker Version ID: <uuid>" from `wrangler versions upload`. */
export function parseVersionId(output: string): string {
   const match = output.match(/Worker Version ID:\s*([0-9a-f-]{36})/i);
   if (!match) throw new Error(`could not find the version id in wrangler output:\n${output.slice(-500)}`);
   return match[1];
}

/** The single version serving 100 % (refuses to promote over an unfinished split). */
export function currentVersion(statusJson: string, worker: string): string {
   const status = JSON.parse(statusJson) as { versions?: { version_id: string; percentage: number }[] };
   const versions = status.versions ?? [];
   const full = versions.filter((v) => v.percentage === 100);
   if (versions.length !== 1 || full.length !== 1) {
      const split = versions.map((v) => `${v.version_id}@${v.percentage}%`).join(", ");
      throw new Error(`${worker} has a split deployment (${split}); finish or roll it back before releasing`);
   }
   return full[0].version_id;
}

/** True when wrangler says the Worker has never been deployed. */
export function isNotDeployed(error: unknown): boolean {
   const text = `${(error as { stderr?: string }).stderr ?? ""} ${(error as Error).message ?? ""}`;
   return /not found|does not exist|no deployments|10007/i.test(text);
}

export type Runner = (args: string[]) => string;

export interface PromoteDeps {
   run: Runner;
   smoke: (version?: string) => Promise<CheckResult[]>;
   waitForVersion: (version: string, override: boolean) => Promise<void>;
   log: (line: string) => void;
}

export interface Released {
   worker: string;
   previous: string | null;
   candidate: string;
   firstDeploy: boolean;
}

export class ReleaseError extends Error {
   readonly released: Released | null;
   readonly rolledBack: boolean;
   constructor(message: string, released: Released | null, rolledBack: boolean) {
      super(message);
      this.released = released;
      this.rolledBack = rolledBack;
   }
}

const failures = (results: CheckResult[]) => results.filter((r) => !r.ok).map((r) => `${r.name}: ${r.detail}`);

export async function promote(env: ReleaseEnv, bundle: string, message: string, deps: PromoteDeps): Promise<Released> {
   const { run, log } = deps;
   const info = ENVS[env];
   const cfg = info.envArgs;

   let previous: string | null = null;
   try {
      previous = currentVersion(run(["deployments", "status", "--json", ...cfg]), info.worker);
   } catch (error) {
      if (!isNotDeployed(error)) throw error;
   }

   if (previous === null) {
      log(`${info.worker}: first deployment (nothing to roll back to)`);
      const out = run(["deploy", ...cfg, "--no-bundle", bundle, "--message", message]);
      const candidate = parseVersionId(out.replace(/Current Version ID/i, "Worker Version ID"));
      const released = { worker: info.worker, previous, candidate, firstDeploy: true };
      await deps.waitForVersion(candidate, false);
      const post = failures(await deps.smoke());
      if (post.length) throw new ReleaseError(`first-deploy smoke failed: ${post.join("; ")}`, released, false);
      return released;
   }

   const candidate = parseVersionId(run(["versions", "upload", ...cfg, "--no-bundle", bundle, "--message", message]));
   const released: Released = { worker: info.worker, previous, candidate, firstDeploy: false };
   log(`${info.worker}: uploaded ${candidate} (serving ${previous})`);

   const rollback = (reason: string) => {
      log(`Rolling back: ${reason}`);
      try {
         run(["rollback", previous!, ...cfg, "-y", "--message", `auto-rollback: ${reason}`.slice(0, 100)]);
         log(`${info.worker}: rolled back to ${previous}`);
      } catch (error) {
         throw new ReleaseError(`ROLLBACK FAILED, fix by hand (rollback.yml): ${(error as Error).message}`, released, false);
      }
   };

   // Candidate at 0 %: reachable only through the override header.
   try {
      run(["versions", "deploy", `${candidate}@0%`, `${previous}@100%`, ...cfg, "-y", "--message", `${message} (0%)`]);
      await deps.waitForVersion(candidate, true);
      const pre = failures(await deps.smoke(candidate));
      if (pre.length) throw new Error(`pre-traffic smoke failed: ${pre.join("; ")}`);
      log("Pre-traffic smoke passed on the candidate");
   } catch (error) {
      rollback((error as Error).message);
      throw new ReleaseError((error as Error).message, released, true);
   }

   // 100 % traffic, routes (custom domain), then the smoke a user would see.
   try {
      run(["versions", "deploy", `${candidate}@100%`, ...cfg, "-y", "--message", message]);
      run(["triggers", "deploy", ...cfg]);
      await deps.waitForVersion(candidate, false);
      const post = failures(await deps.smoke());
      if (post.length) throw new Error(`post-promote smoke failed: ${post.join("; ")}`);
      log("Promoted; smoke passed");
   } catch (error) {
      rollback((error as Error).message);
      throw new ReleaseError((error as Error).message, released, true);
   }
   return released;
}

/**
 * Polls /healthz until the given version answers `steady` times in a row. One answer is not
 * enough: Cloudflare rolls a deployment (and an override target) out across the edge gradually,
 * so the request right after the first match can still reach the old version (2026-11-10: www's
 * production pre-traffic smoke got the old version one request after the wait passed).
 */
export async function waitForVersion(
   env: EnvName,
   version: string,
   override: boolean,
   timeoutMs = 120_000,
   steady = 3,
   doFetch: typeof fetch = fetch,
   pauseMs = 3000,
): Promise<void> {
   const info = ENVS[env];
   const headers: Record<string, string> = { "User-Agent": "al-ummah-now-cms-release" };
   if (override) headers["Cloudflare-Workers-Version-Overrides"] = `${info.worker}="${version}"`;
   const deadline = Date.now() + timeoutMs;
   let last = "no response";
   let inARow = 0;
   while (Date.now() < deadline) {
      try {
         const res = await doFetch(`${info.url}/healthz`, { headers });
         const body = (await res.json()) as { version?: string | null };
         if (body.version === version) {
            if (++inARow >= steady) return;
            await new Promise((r) => setTimeout(r, Math.min(pauseMs, 1000)));
            continue;
         }
         last = `version ${body.version}`;
      } catch (error) {
         last = (error as Error).message;
      }
      inARow = 0;
      await new Promise((r) => setTimeout(r, pauseMs));
   }
   throw new Error(`${info.worker} did not serve ${version} within ${timeoutMs / 1000}s (last: ${last})`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
   const argv = process.argv.slice(2);
   const env = parseEnv(argv, ["stage", "production"]) as ReleaseEnv;
   const message = argv.includes("--message") ? argv[argv.indexOf("--message") + 1] : `release ${process.env.GITHUB_SHA?.slice(0, 7) ?? "local"}`;
   const root = resolve(new URL("../..", import.meta.url).pathname);
   const bundle = join(root, "dist", env, "index.js");
   if (!existsSync(bundle)) {
      process.stderr.write(`missing ${bundle}: run the build job (wrangler deploy --dry-run --outdir dist/${env})\n`);
      process.exit(2);
   }
   const run: Runner = (args) =>
      execFileSync("npx", ["wrangler", ...args], {
         cwd: root,
         encoding: "utf8",
         env: { ...process.env, CI: "true" },
         stdio: ["ignore", "pipe", "pipe"],
         maxBuffer: 32 * 1024 * 1024,
      });
   const log = (line: string) => process.stdout.write(`${line}\n`);
   const writeResult = (result: object) => writeFileSync(join(root, "release-result.json"), JSON.stringify(result, null, 2));
   try {
      const released = await promote(env, bundle, message, {
         run,
         smoke: (version) => runSmoke({ env, version }),
         waitForVersion: (version, override) => waitForVersion(env, version, override),
         log,
      });
      writeResult({ env, status: "promoted", ...released });
   } catch (error) {
      const released = error instanceof ReleaseError ? error.released : null;
      writeResult({ env, status: error instanceof ReleaseError && error.rolledBack ? "rolled-back" : "failed", error: (error as Error).message, ...released });
      process.stderr.write(`Release failed: ${(error as Error).message}\n`);
      process.exit(1);
   }
}
