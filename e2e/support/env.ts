export const CMS_URL = (process.env.CMS_URL ?? "https://cms.qa.alummahnow.net").replace(/\/+$/, "");
export const AUTH_URL = (process.env.AUTH_URL ?? "https://auth.qa.alummahnow.net").replace(/\/+$/, "");
export const CMS_CLIENT_ID = process.env.CMS_CLIENT_ID ?? "0e613f49-674b-490a-93e5-97a35d586da1";
export const WWW_URL = process.env.WWW_URL?.replace(/\/+$/, "");
export const SEED_PASSWORD = process.env.QA_SEED_PASSWORD ?? process.env.SEED_PASSWORD ?? "";
export const CALLBACK_URL = `${CMS_URL}/sso/callback`;

/** The seed accounts' email domain: stage's auth only sends mail to its E2E sink domain. */
export const SEED_EMAIL_DOMAIN =
   process.env.SEED_EMAIL_DOMAIN || (new URL(AUTH_URL).hostname.includes(".stage.") ? "e2e.alummahnow.net" : "delivered.resend.dev");

export interface Account {
   email: string;
   password: string;
}

/** Stage's auth: only seed-managed accounts are used there (see ACCOUNTS). */
export const ON_STAGE = new URL(AUTH_URL).hostname.includes(".stage.");

// QA: the dedicated CMS E2E accounts (delivered+cms-e2e-*), as before. Stage: ONLY the accounts
// AlUmmahNow's seed manages (seed-qa.yml, target stage) on the code sink domain: it creates them,
// grants their roles and resets their password when STAGE_SEED_PASSWORD is rotated, so every
// repo's copy of the secret keeps working. QA_SEED_PASSWORD / STAGE_SEED_PASSWORD hold the
// passwords. E2E_*_EMAIL point the suite at other accounts that share SEED_PASSWORD.
const defaultAccount = (cmsE2e: string, seed: string) =>
   ON_STAGE ? `${seed}@${SEED_EMAIL_DOMAIN}` : `delivered+cms-e2e-${cmsE2e}@resend.dev`;

export const ACCOUNTS = {
   // Auth Admin -> CMS admin
   admin: { email: process.env.E2E_ADMIN_EMAIL || defaultAccount("admin", "qa-admin"), password: SEED_PASSWORD },
   // Auth Moderator -> CMS editor
   moderator: { email: process.env.E2E_MODERATOR_EMAIL || defaultAccount("moderator", "qa-moderator"), password: SEED_PASSWORD },
   // No CMS role -> the CMS's "no access" page
   viewer: { email: process.env.E2E_VIEWER_EMAIL || defaultAccount("viewer", "qa-viewer"), password: SEED_PASSWORD },
   // Has the Scholar role and owns a channel on the env's videos site (docs/SCHOLARS.md): the seeded QA creator.
   scholar: { email: process.env.E2E_SCHOLAR_EMAIL || `qa-creator@${SEED_EMAIL_DOMAIN}`, password: SEED_PASSWORD },
   // DEDICATED to e2e/sso-journey.spec.ts and used by nothing else: that spec ends with single
   // sign-out, which ends every session of the account in every app. On a shared account it
   // bounced the rest of the suite (and other repos' suites) to auth's sign-in page mid-test.
   // Seeded by AlUmmahNow's seed-qa workflow (seed-config.ts `ssoCms`, auth role_admin) as
   // qa-sso-cms@ the env's seed domain. test/node/e2e-session-accounts.test.ts enforces that
   // session-ending specs use only qa-sso-* accounts (ACCOUNTS.sso*).
   ssoCms: { email: process.env.E2E_SSO_CMS_EMAIL || `qa-sso-cms@${SEED_EMAIL_DOMAIN}`, password: SEED_PASSWORD },
} satisfies Record<string, Account>;

export const hasCredentials = SEED_PASSWORD.length > 0;

/** The env's videos API (community posts of the scholar's channel). */
export const VIDEOS_API_URL = (process.env.VIDEOS_API_URL ?? "https://videos.api.qa.alummahnow.net").replace(/\/+$/, "");
