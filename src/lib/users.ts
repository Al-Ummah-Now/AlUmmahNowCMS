/**
 * bknd `users` is a cache of SSO identities (SPEC §3). One row per auth user, matched by `sso_sub`
 * (or by email, for a row created before the sub was known). The role is overwritten from the
 * token on every sign-in, so a demotion in auth takes effect at the next sign-in.
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
   const existing = await db
      .prepare("SELECT id FROM users WHERE sso_sub = ?1 OR (sso_sub IS NULL AND email = ?2) ORDER BY sso_sub IS NULL LIMIT 1")
      .bind(identity.sub, identity.email)
      .first<{ id: number }>();

   if (existing) {
      // A different row may hold this email (auth account re-created): release the email first.
      await db.batch([
         db.prepare("UPDATE users SET email = NULL WHERE email = ?1 AND id <> ?2").bind(identity.email, existing.id),
         db
            .prepare("UPDATE users SET sso_sub = ?1, email = ?2, role = ?3, strategy = 'sso', strategy_value = NULL WHERE id = ?4")
            .bind(identity.sub, identity.email, role, existing.id),
      ]);
      return { id: existing.id, email: identity.email, role, strategy: "sso" };
   }

   const [, inserted] = await db.batch<{ id: number }>([
      db.prepare("UPDATE users SET email = NULL WHERE email = ?1").bind(identity.email),
      db
         .prepare("INSERT INTO users (sso_sub, email, strategy, role) VALUES (?1, ?2, 'sso', ?3) RETURNING id")
         .bind(identity.sub, identity.email, role),
   ]);
   const id = inserted.results[0]?.id;
   if (typeof id !== "number") throw new Error("user upsert returned no id");
   return { id, email: identity.email, role, strategy: "sso" };
}
