-- 0015_sso_session_revocations: single sign-out ends THIS browser's CMS session, not the account's
-- sessions everywhere (SSO audit follow-up, 2026-11-10). Expand-only. Never edit this file after it
-- is merged; add a new migration instead.
--
-- Each CMS session (bknd JWT) carries a random `sid` minted at sign-in. /sso/logout (also auth's
-- front-channel hop, which arrives with that browser's cookie) revokes that sid, so a copy of the
-- cookie is refused while the account's other browsers and devices stay signed in. Rows expire with
-- the session (expires_at = the JWT's exp) and are swept on insert. Not part of src/schema.ts.
-- sso_sign_outs (0012) now only covers sessions issued before sids existed (at most 8 h).
--   sid:         the session id from the JWT
--   expires_at:  epoch seconds after which the session is invalid anyway
create table "sso_session_revocations" (
  "sid" text not null primary key,
  "expires_at" integer not null
);
