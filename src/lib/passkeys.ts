/**
 * Staff passkeys (wiki AUTH-PASSKEYS, "Token claims" and "Staff enforcement points").
 *
 * Auth's access token carries `amr` (how the user signed in: "pwd", "otp", "passkey", "fed"),
 * `auth_time`, and, for staff while enforcement is on, `properties.passkey_deadline` (epoch
 * seconds). The consumer rule:
 *
 *   staff && passkey_deadline set && !amr.includes("passkey"):
 *     now >= deadline → no CMS session; the "Passkey needed" page (not an error)
 *     now <  deadline → a session, with the banner "Add a passkey by <date>"
 *
 * A grace session keeps the deadline in its bknd JWT (`pkd`), so the 8 h session never outlives
 * it: from the deadline on, the next request shows the page (src/index.ts session gate).
 */
import { normalizeRole } from "./roles.ts";

/** Auth roles that count as staff (normalized: lower case, spaces as `_`). Scholar and Member are not staff. */
export const STAFF_AUTH_ROLES: ReadonlySet<string> = new Set(["super_admin", "admin", "moderator", "writer", "content_reviewer", "senior_reviewer"]);

/** Whether any of the token's Auth roles is a staff role. */
export function isAuthStaff(roles: readonly unknown[] | undefined): boolean {
   return !!roles?.some((r) => typeof r === "string" && STAFF_AUTH_ROLES.has(normalizeRole(r)));
}

export interface PasskeyClaims {
   roles: readonly string[];
   /** Top-level `amr`; absent on tokens from before Auth sent it (= no passkey). */
   amr?: readonly string[];
   /** `properties.passkey_deadline` (epoch seconds). */
   passkeyDeadline?: number;
}

export type PasskeyVerdict =
   /** Nothing to enforce: not staff, enforcement off, or signed in with a passkey. */
   | { kind: "ok" }
   /** Staff without a passkey sign-in, inside the grace period: session + banner until `deadline`. */
   | { kind: "grace"; deadline: number }
   /** Staff without a passkey sign-in after the deadline: no session, the "Passkey needed" page. */
   | { kind: "required" };

export function passkeyVerdict(claims: PasskeyClaims, nowSec = Math.floor(Date.now() / 1000)): PasskeyVerdict {
   const deadline = claims.passkeyDeadline;
   if (typeof deadline !== "number" || !Number.isFinite(deadline)) return { kind: "ok" };
   if (!isAuthStaff(claims.roles)) return { kind: "ok" };
   if (claims.amr?.includes("passkey")) return { kind: "ok" };
   return nowSec >= deadline ? { kind: "required" } : { kind: "grace", deadline };
}

/** A grace session (JWT `pkd`) whose deadline has passed: it no longer gives staff access. */
export function sessionPasskeyLapsed(session: { pkd?: unknown }, nowSec = Math.floor(Date.now() / 1000)): boolean {
   return typeof session.pkd === "number" && nowSec >= session.pkd;
}

/** The grace deadline (epoch seconds) a session's banner shows, or null when it shows none. */
export function sessionPasskeyDeadline(session: { pkd?: unknown }): number | null {
   return typeof session.pkd === "number" && Number.isFinite(session.pkd) ? session.pkd : null;
}

/** The CMS URL a passkey sign-in starts from: its own sign-in with `prompt=login`, back to `returnPath`. */
export function passkeySignInPath(returnPath: string, lang?: "en" | "ar"): string {
   return `/sso/login?prompt=login&return=${encodeURIComponent(returnPath)}${lang === "ar" ? "&lang=ar" : ""}`;
}

/**
 * Auth's "Add a passkey" page. It comes back to the CMS's sign-in with `prompt=login`: silent
 * single sign-on keeps the original `amr`, so only a fresh sign-in with the new passkey counts.
 */
export function passkeySetupUrl(issuer: string, publicUrl: string, returnPath: string, lang?: "en" | "ar"): string {
   const url = new URL(`${issuer.replace(/\/+$/, "")}/passkeys/setup`);
   url.searchParams.set("return_to", `${publicUrl.replace(/\/+$/, "")}${passkeySignInPath(returnPath, lang)}`);
   // Auth reads its page language from ?lang= only (English by default)
   if (lang === "ar") url.searchParams.set("lang", "ar");
   return url.toString();
}

/** The "Passkey needed" page for `returnPath` (relative, same origin). */
export function passkeyNeededPath(returnPath: string, lang?: "en" | "ar"): string {
   return `/sso/passkey-needed?return=${encodeURIComponent(returnPath)}${lang === "ar" ? "&lang=ar" : ""}`;
}
