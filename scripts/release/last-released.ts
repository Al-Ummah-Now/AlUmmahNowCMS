/**
 * Prints the full commit SHA of the last release deployed to an env (from the Cloudflare
 * deployment history; release.yml deploys with the message "release <40-hex sha>"), or nothing
 * when there is none yet. release.yml runs the migration guard against it, so the guard compares
 * with what production actually runs rather than with HEAD^.
 *
 *   node --experimental-strip-types scripts/release/last-released.ts --env production
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENVS, parseEnv } from "./envs.ts";

export const RELEASE_MESSAGE = /^release ([0-9a-f]{40})\b/;

interface Deployment {
   created_on: string;
   annotations?: Record<string, string | undefined>;
}

export function lastReleasedSha(deploymentsJson: string): string | undefined {
   const deployments = (JSON.parse(deploymentsJson) as Deployment[]).slice().sort((a, b) => b.created_on.localeCompare(a.created_on));
   for (const d of deployments) {
      const match = RELEASE_MESSAGE.exec(d.annotations?.["workers/message"] ?? "");
      if (match) return match[1];
   }
   return undefined;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(new URL(import.meta.url)));
if (isMain) {
   const env = parseEnv(process.argv.slice(2), ["production", "stage"]);
   const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
   const out = execFileSync("npx", ["wrangler", "deployments", "list", "--json", "--name", ENVS[env].worker], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, CI: "true" },
      stdio: ["ignore", "pipe", "pipe"],
   });
   process.stdout.write(lastReleasedSha(out) ?? "");
}
