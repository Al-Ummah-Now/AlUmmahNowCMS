/**
 * Converts existing CMS scholar posts into community posts on each scholar's primary channel, and the
 * CMS rows into hidden references with the SAME slugs (docs/SCHOLARS.md §8, wiki AUN-SCHOLAR-SITES §6.6).
 * The work runs inside the CMS Worker (it holds the internal key for api-videos); this script only
 * mints a one-time token in the env's D1 (wrangler, the same privilege as running a migration), calls
 * POST /api/release/v1/scholar-conversion and deletes the token.
 *
 *   node --experimental-strip-types scripts/ops/convert-scholar-posts.ts --env qa|stage|production            # plan (dry run)
 *   node --experimental-strip-types scripts/ops/convert-scholar-posts.ts --env qa --apply [--limit 25]       # convert, then check
 *   node --experimental-strip-types scripts/ops/convert-scholar-posts.ts --env qa --check                    # compare every converted post
 *   … --apply --allow-production   only with the owner's go-ahead (a data change)
 *
 * --apply converts in batches (25 a call) until nothing is left, then runs the check. Exit code 1 when
 * a conversion failed or the check found a difference. Output: counts and one line per post; never
 * post bodies.
 */
import { execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ENVS, parseEnv } from "../release/envs.ts";

const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");

export function insertTokenSql(hash: string, expiresAt: Date, now = new Date()): string {
   if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("bad token hash");
   return `INSERT INTO system_tokens (token_hash, purpose, expires_at, created_at) VALUES ('${hash}', 'scholar-conversion', '${expiresAt.toISOString()}', '${now.toISOString()}')`;
}
export function deleteTokenSql(hash: string): string {
   if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("bad token hash");
   return `DELETE FROM system_tokens WHERE token_hash = '${hash}'`;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(new URL(import.meta.url)));
if (isMain) {
   const argv = process.argv.slice(2);
   const env = parseEnv(argv);
   const apply = argv.includes("--apply");
   const check = argv.includes("--check");
   const li = argv.indexOf("--limit");
   const limit = li >= 0 ? Number(argv[li + 1]) : 25;
   if (apply && env === "production" && !argv.includes("--allow-production")) {
      process.stderr.write("Refusing to change production without --allow-production (needs the owner's go-ahead).\n");
      process.exit(2);
   }
   const info = ENVS[env];
   const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
   const d1 = (sql: string) =>
      execFileSync("npx", ["wrangler", "d1", "execute", "DB", "--remote", ...info.envArgs, "--command", sql], { cwd: root, encoding: "utf8", env: { ...process.env, CI: "true" }, stdio: ["ignore", "pipe", "pipe"] });
   const token = randomBytes(32).toString("base64url");
   const hash = sha256Hex(token);
   const url = `${info.url}/api/release/v1/scholar-conversion`;
   const call = async (body: Record<string, unknown>) => {
      const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "User-Agent": "al-ummah-now-cms-ops" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`POST ${url}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the Worker's answer, printed as is
      return ((await res.json()) as { data: Record<string, any> }).data;
   };
   const out = (s: string) => process.stdout.write(`${s}\n`);
   d1(insertTokenSql(hash, new Date(Date.now() + 30 * 60_000)));
   let code = 0;
   try {
      const plan = await call({ mode: "plan" });
      out(`${info.worker}: plan ${JSON.stringify(plan.counts)} (already converted: ${plan.already_converted})`);
      for (const i of plan.items) out(`  #${i.id} ${i.locale}/${i.slug} ${i.kind} ${i.status}${i.mirror ? " mirror→in place" : " new"}${i.featured ? " featured" : ""}${i.skip ? ` SKIP:${i.skip}` : ""}`);
      if (apply) {
         let converted = 0;
         let failed = 0;
         for (let round = 0; round < 200; round++) {
            const r = await call({ mode: "apply", limit });
            for (const c of r.converted) out(`  converted #${c.id} → ${c.post_id}${c.upgraded ? " (upgraded in place)" : ""}`);
            for (const f of r.failed) out(`  FAILED #${f.id}: ${f.error}`);
            converted += r.converted.length;
            failed += r.failed.length;
            if (!r.converted.length) break;
         }
         out(`${info.worker}: converted ${converted}, failed ${failed}`);
         if (failed) code = 1;
      }
      if (apply || check) {
         const c = await call({ mode: "check" });
         out(`${info.worker}: check ok ${c.ok}, different ${c.failed}`);
         for (const i of c.items) if (!i.ok) out(`  DIFF #${i.id} (${i.post_id}): ${i.diffs.join("; ")}`);
         if (c.failed) code = 1;
      }
   } catch (error) {
      process.stderr.write(`::error::${(error as Error).message}\n`);
      code = 1;
   } finally {
      try {
         d1(deleteTokenSql(hash));
      } catch (error) {
         process.stderr.write(`could not delete the token (it expires in 30 min): ${(error as Error).message}\n`);
      }
   }
   process.exit(code);
}
