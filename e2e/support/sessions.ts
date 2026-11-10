/**
 * One sign-in per account per run (QA auth throttles repeated sign-ins from one IP). The global
 * setup signs the accounts in and stores their CMS session cookies in the OS temp dir — never in
 * e2e-artifacts/, which CI uploads. Specs read them with `sessionCookie()`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ACCOUNTS, hasCredentials, type Account } from "./env.ts";
import { signIn } from "./oauth.ts";

export const SESSIONS_FILE = join(process.env.RUNNER_TEMP || tmpdir(), "cms-e2e-sessions.json");

let cache: Record<string, string> | undefined;

/** The CMS cookie header for `account` (from the global setup, else one sign-in now). */
/** Local runs against `wrangler dev` can pass ready-made CMS cookies instead of signing in. */
function cookieFromEnv(account: Account): string | undefined {
   if (account.email === ACCOUNTS.admin.email) return process.env.E2E_ADMIN_COOKIE || undefined;
   if (account.email === ACCOUNTS.moderator.email) return process.env.E2E_MODERATOR_COOKIE || undefined;
   return undefined;
}

export async function sessionCookie(account: Account): Promise<string> {
   const fromEnv = cookieFromEnv(account);
   if (fromEnv) return fromEnv;
   if (!cache) cache = existsSync(SESSIONS_FILE) ? (JSON.parse(readFileSync(SESSIONS_FILE, "utf8")) as Record<string, string>) : {};
   if (!cache[account.email]) cache[account.email] = await signInPolitely(account);
   return cache[account.email];
}

/** auth throttles sign-ins per email (10/min) and answers 429; wait the window out and try again. */
async function signInPolitely(account: Account): Promise<string> {
   for (let attempt = 1; ; attempt++) {
      try {
         return (await signIn(account)).cookie;
      } catch (error) {
         if (attempt >= 4 || !/status 429/.test(String(error))) throw error;
         await new Promise((r) => setTimeout(r, 65_000));
      }
   }
}

export default async function globalSetup(): Promise<void> {
   if (!hasCredentials || process.env.E2E_ADMIN_COOKIE) return;
   const out: Record<string, string> = {};
   for (const account of [ACCOUNTS.admin, ACCOUNTS.moderator]) out[account.email] = await signInPolitely(account);
   writeFileSync(SESSIONS_FILE, JSON.stringify(out), { mode: 0o600 });
}
