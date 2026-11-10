/**
 * Guard: E2E specs that END sessions never use a shared seed account.
 *
 * Signing out goes through auth's /logout and ends the account's sign-in in EVERY app; revoking
 * tokens, changing a password or role, or terminating sessions does the same. On a shared account
 * (qa-admin and friends, or this suite's ACCOUNTS.admin/moderator/…) that bounces every other suite
 * using the account to the sign-in page mid-test. Such specs must use a dedicated `qa-sso-*`
 * account (ACCOUNTS.sso*, one per spec, used by nothing else).
 *
 * File-level and textual on purpose (simple, no AST): a spec file that mentions a session-ending
 * action anywhere (code or comment) must not mention a shared account anywhere. Run by
 * test/node/e2e-session-accounts.test.ts (`npm test`, CI "Unit and Workers-runtime tests").
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/** Sign out / log out (incl. /sso/logout, auth /logout), token revoke, password or role change, session end. */
export const SESSION_ENDING =
   /\bsign[\s_-]?out|\blog[\s_-]?out|\/logout\b|\brevoke|\b(change|reset|update|set)[\s_-]?password|password\/(change|reset)|\b(change|update|set|remove|revoke)[\s_-]?roles?\b|\bterminat|\bend[\s_-]?sessions?\b|sessions?\/(end|delete|revoke)/i;

/** Shared seeded accounts (all repos' QA seed, this suite's shared E2E accounts) and non-dedicated ACCOUNTS entries. */
export const SHARED_ACCOUNT =
   /qa-(superadmin|admin|moderator|creator|viewer)@|cms-e2e-(admin|moderator|viewer)@|\bACCOUNTS\s*\.\s*(?!sso)\w+|\bACCOUNTS\s*\[/;

export interface Violation {
   file: string;
   action: string;
   account: string;
}

/** The violation in one spec's source, or null when it is fine. */
export function checkSpec(file: string, source: string): Violation | null {
   const action = SESSION_ENDING.exec(source);
   if (!action) return null;
   const account = SHARED_ACCOUNT.exec(source);
   if (!account) return null;
   return { file, action: action[0], account: account[0] };
}

/** Every *.spec.ts under `dir` (recursively). */
export function specFiles(dir: string): string[] {
   return readdirSync(dir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(".spec.ts"))
      .map((f) => join(dir, f));
}

export function checkSpecs(dir: string): Violation[] {
   return specFiles(dir)
      .map((f) => checkSpec(relative(process.cwd(), f), readFileSync(f, "utf8")))
      .filter((v): v is Violation => v !== null);
}
