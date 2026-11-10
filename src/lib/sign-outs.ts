/**
 * Single sign-out for CMS sessions (migration 0012).
 *
 * A CMS session is a signed bknd JWT: clearing the cookie on sign-out does not make a copy of it
 * invalid. /sso/logout (also the front-channel hop of auth's single sign-out) records the time the
 * account signed out, and the session gate refuses any session issued before it.
 */

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
