/**
 * bknd `users` is a cache of SSO identities (SPEC §3). One row per auth user, matched by `sso_sub`
 * (or by email, for a row created before the sub was known). The role is overwritten from the
 * token on every sign-in, so a demotion in auth takes effect at the next sign-in.
 *
 * Concurrency: many isolates can run `/sso/callback` for the same `sub` at once (two tabs, a
 * silent re-auth crossing a normal sign-in). There is no read-then-write: the whole upsert is one
 * `db.batch` (one D1 transaction) whose last statement is `INSERT … ON CONFLICT(sso_sub) DO UPDATE`,
 * so every caller succeeds and there is exactly one row per `sub`.
 */
import type { BkndRole } from "./roles.ts";

export interface SessionUser {
   id: number;
   email: string;
   role: BkndRole;
   strategy: "sso";
}

export async function upsertSsoUser(
   db: D1Database,
   identity: { sub: string; email: string },
   role: BkndRole,
): Promise<SessionUser> {
   const results = await db.batch<{ id: number }>([
      // 1. A legacy row created before the sub was known (sso_sub NULL, same email) becomes this
      //    user's row, unless a row for this sub already exists.
      db
         .prepare(
            `UPDATE users SET sso_sub = ?1
             WHERE id = (SELECT id FROM users WHERE sso_sub IS NULL AND email = ?2 ORDER BY id LIMIT 1)
               AND NOT EXISTS (SELECT 1 FROM users WHERE sso_sub = ?1)`,
         )
         .bind(identity.sub, identity.email),
      // 2. Another row may hold this email (auth account re-created): release it.
      db.prepare("UPDATE users SET email = NULL WHERE email = ?2 AND sso_sub IS NOT ?1").bind(identity.sub, identity.email),
      // 3. The upsert itself: one statement, atomic on the unique sso_sub index.
      db
         .prepare(
            `INSERT INTO users (sso_sub, email, strategy, role) VALUES (?1, ?2, 'sso', ?3)
             ON CONFLICT(sso_sub) DO UPDATE SET email = excluded.email, role = excluded.role, strategy = 'sso', strategy_value = NULL
             RETURNING id`,
         )
         .bind(identity.sub, identity.email, role),
   ]);
   const id = results[2]?.results[0]?.id;
   if (typeof id !== "number") throw new Error("user upsert returned no id");
   return { id, email: identity.email, role, strategy: "sso" };
}
