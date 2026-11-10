-- 0012_sso_sign_outs: single sign-out ends every CMS session of the account, including a copy of
-- the session cookie taken before it (SSO audit 2026-11-10). Expand-only. Never edit this file
-- after it is merged; add a new migration instead.
--
-- The CMS session is a signed bknd JWT (8 h) that clearing the cookie does not invalidate.
-- /sso/logout records when the account signed out; the session gate refuses a session issued
-- (JWT iat) before that time. Not part of src/schema.ts (bknd does not manage it).
--   user_id:        users.id
--   signed_out_at:  epoch seconds of the latest sign-out
create table "sso_sign_outs" (
  "user_id" integer not null primary key,
  "signed_out_at" integer not null
);
