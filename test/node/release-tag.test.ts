import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseReleaseTag, previousTag } from "../../scripts/release/release-tag.ts";

const ROOT = resolve(import.meta.dirname, "../..");

describe("release tag names", () => {
   it("accepts a dated tag and a later same-day tag", () => {
      expect(parseReleaseTag("v2026.11.08")).toEqual({ tag: "v2026.11.08", date: "2026-11-08", n: 1 });
      expect(parseReleaseTag("v2026.11.08.2")).toEqual({ tag: "v2026.11.08.2", date: "2026-11-08", n: 2 });
      expect(parseReleaseTag("v2028.02.29")?.date).toBe("2028-02-29");
   });

   it("rejects other names, impossible dates and .0/.1/leading zeros", () => {
      for (const bad of ["2026.11.08", "v2026.11.8", "v26.11.08", "v2026.13.01", "v2026.02.30", "v2027.02.29", "v2026.11.08.0", "v2026.11.08.1", "v2026.11.08.02", "v2026.11.08-rc1", "v1.2.3", "v2026.11.08.2.1"]) {
         expect(parseReleaseTag(bad), bad).toBeNull();
      }
   });
});

describe("previous release tag", () => {
   const tags = ["v2026.11.08", "v2026.11.08.2", "v2026.11.08.10", "v2026.10.31", "v1.0.0", "not-a-tag"];

   it("orders by date then sequence numerically", () => {
      expect(previousTag(tags, "v2026.11.08.10")).toBe("v2026.11.08.2");
      expect(previousTag(tags, "v2026.11.08.2")).toBe("v2026.11.08");
      expect(previousTag(tags, "v2026.11.08")).toBe("v2026.10.31");
      expect(previousTag(tags, "v2026.11.09")).toBe("v2026.11.08.10");
   });

   it("is null for the first release or an invalid tag", () => {
      expect(previousTag(tags, "v2026.10.31")).toBeNull();
      expect(previousTag(tags, "oops")).toBeNull();
   });
});

describe("release-tag check (CLI)", () => {
   const script = resolve(ROOT, "scripts/release/release-tag.ts");
   const run = (cwd: string, ...args: string[]) => {
      try {
         const out = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", script, ...args], {
            cwd,
            encoding: "utf8",
            stdio: "pipe",
            env: { ...process.env, GITHUB_OUTPUT: "" },
         });
         return { code: 0, out };
      } catch (e) {
         const err = e as { status: number; stderr: string };
         return { code: err.status, out: err.stderr };
      }
   };

   it("passes a tag on main and refuses a commit that is not on main or a bad name", () => {
      const dir = mkdtempSync(join(tmpdir(), "release-tag-"));
      try {
         const g = (...a: string[]) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
         g("init", "-q", "-b", "main");
         g("config", "user.email", "t@example.com");
         g("config", "user.name", "t");
         writeFileSync(join(dir, "f"), "1");
         g("add", "f");
         g("commit", "-qm", "one");
         const onMain = g("rev-parse", "HEAD");
         g("tag", "v2026.11.01");
         g("checkout", "-qb", "side");
         writeFileSync(join(dir, "f"), "2");
         g("commit", "-qam", "two");
         const offMain = g("rev-parse", "HEAD");
         // The script checks ancestry against origin/main, as in CI's full clone.
         g("update-ref", "refs/remotes/origin/main", onMain);

         const ok = run(dir, "check", "v2026.11.08", onMain);
         expect(ok.code).toBe(0);
         expect(ok.out).toContain("previous release: v2026.11.01");
         const off = run(dir, "check", "v2026.11.08", offMain);
         expect(off.code).toBe(1);
         expect(off.out).toContain("not on main");
         const bad = run(dir, "check", "v1.2.3", onMain);
         expect(bad.code).toBe(1);
         expect(bad.out).toContain("not a release tag");
         expect(run(dir, "check").code).toBe(2);
      } finally {
         rmSync(dir, { recursive: true, force: true });
      }
   });
});

describe("release.yml follows the tag model", () => {
   const wf = readFileSync(resolve(ROOT, ".github/workflows/release.yml"), "utf8");
   const job = (name: string) => {
      const start = wf.indexOf(`\n  ${name}:\n`);
      expect(start, `job ${name}`).toBeGreaterThan(-1);
      const next = wf.slice(start + 1).search(/\n {2}[a-z][\w-]*:\n/);
      return next === -1 ? wf.slice(start) : wf.slice(start, start + 1 + next);
   };

   it("runs on v* tags and by dispatch only (merging to main deploys QA, not production)", () => {
      expect(wf).toMatch(/\non:\n {2}push:\n {4}tags: \['v\*'\]\n {2}workflow_dispatch:\n/);
      expect(wf).not.toContain("workflow_run");
      expect(wf).not.toMatch(/\n {4}branches:/);
   });

   it("resolves the run first: tag -> production, main -> stage only, anything else refused", () => {
      const resolveJob = job("resolve");
      expect(resolveJob).toContain("fetch-depth: 0");
      expect(resolveJob).toContain('if [ "$GITHUB_REF_TYPE" = tag ]');
      expect(resolveJob).toContain('elif [ "$GITHUB_REF" = refs/heads/main ]');
      expect(resolveJob).toContain("exit 1");
      expect(resolveJob).toContain('scripts/release/release-tag.ts check "$GITHUB_REF_NAME" "$GITHUB_SHA"');
      expect(job("build")).toContain("needs: resolve");
   });

   it("promotes production only for a tag that still points at the released commit", () => {
      const prod = job("production");
      expect(prod).toContain("needs: [resolve, stage]");
      expect(prod).toContain("if: needs.resolve.outputs.production == 'true'");
      expect(prod).toContain('git ls-remote origin "refs/tags/$TAG^{}"');
      expect(prod.indexOf("Tag still points at this commit?")).toBeLessThan(prod.indexOf("Migrate production D1"));
      expect(prod).not.toContain("Still the head of main?");
   });

   it("keeps the release message the migration guard reads back", () => {
      expect(wf).toContain('--env production --message "release ${RELEASE_SHA}"');
      expect(wf).toContain("RELEASE_SHA: ${{ github.sha }}");
   });
});
