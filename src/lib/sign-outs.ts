/**
 * Single sign-out for CMS sessions (migrations 0012, 0015).
 *
 * A CMS session is a signed bknd JWT: clearing the cookie on sign-out does not make a copy of it
 * invalid. Each session carries a random `sid` (minted at /sso/callback). /sso/logout (also the
 * front-channel hop of auth's single sign-out) revokes THAT sid, so a copy of this browser's cookie
 * is refused while the account's other browsers and devices stay signed in. Nothing is bound to the
 * User-Agent or the device, so browser updates and view switches never sign anyone out.
 *
 * Sessions issued before sids existed fall back to the account-wide sign-out time (0012); they
 * expire within SESSION_TTL_SECONDS of the deploy.
 */

/** A new session id for the CMS JWT. */
export function newSessionId(): string {
   const bytes = crypto.getRandomValues(new Uint8Array(16));
   return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Revokes one session (its sid) until `expiresAt` (epoch seconds), and sweeps expired rows. */
export async function revokeSession(db: D1Database, sid: string, expiresAt: number, nowSec = Math.floor(Date.now() / 1000)): Promise<void> {
   await db.batch([
      db.prepare("DELETE FROM sso_session_revocations WHERE expires_at < ?1").bind(nowSec),
      db
         .prepare("INSERT INTO sso_session_revocations (sid, expires_at) VALUES (?1, ?2) ON CONFLICT(sid) DO NOTHING")
         .bind(sid, Math.max(expiresAt, nowSec)),
   ]);
}

/** Whether this session was ended by a sign-out: its sid is revoked, or (no sid) the account signed out after it was issued. */
export async function sessionEnded(db: D1Database, session: { id: number | string; iat?: number; sid?: unknown }): Promise<boolean> {
   if (typeof session.sid === "string" && session.sid) {
      const row = await db.prepare("SELECT 1 AS x FROM sso_session_revocations WHERE sid = ?1").bind(session.sid).first();
      return row !== null;
   }
   return endedBySignOut(db, session.id, session.iat);
}

/** Records that `userId` signed out at `nowSec` (epoch seconds). */
export async function recordSignOut(db: D1Database, userId: number | string, nowSec = Math.floor(Date.now() / 1000)): Promise<void> {
   await db
      .prepare(
         `INSERT INTO sso_sign_outs (user_id, signed_out_at) VALUES (?1, ?2)
          ON CONFLICT(user_id) DO UPDATE SET signed_out_at = max(signed_out_at, excluded.signed_out_at)`,
      )
      .bind(Number(userId), nowSec)
      .run();
}

/**
 * Whether a session issued at `issuedAt` (JWT iat, epoch seconds) was ended by a later sign-out.
 * A session without iat cannot be proven newer than a sign-out, so it is ended once one exists.
 * A session issued in the same second as the sign-out is ended too (it may be the copied one); a
 * new sign-in needs the password again after single sign-out, so it is always a later second.
 */
export async function endedBySignOut(db: D1Database, userId: number | string, issuedAt: number | undefined): Promise<boolean> {
   const row = await db.prepare("SELECT signed_out_at FROM sso_sign_outs WHERE user_id = ?1").bind(Number(userId)).first<{ signed_out_at: number }>();
   if (!row) return false;
   if (typeof issuedAt !== "number") return true;
   return issuedAt <= row.signed_out_at;
}
