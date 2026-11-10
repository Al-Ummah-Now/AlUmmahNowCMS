export const CMS_URL = (process.env.CMS_URL ?? "https://cms.qa.alummahnow.net").replace(/\/+$/, "");
export const AUTH_URL = (process.env.AUTH_URL ?? "https://auth.qa.alummahnow.net").replace(/\/+$/, "");
export const CMS_CLIENT_ID = process.env.CMS_CLIENT_ID ?? "0e613f49-674b-490a-93e5-97a35d586da1";
export const WWW_URL = process.env.WWW_URL?.replace(/\/+$/, "");
export const SEED_PASSWORD = process.env.QA_SEED_PASSWORD ?? process.env.SEED_PASSWORD ?? "";
export const CALLBACK_URL = `${CMS_URL}/sso/callback`;

export interface Account {
   email: string;
   password: string;
}

// Dedicated CMS E2E accounts by default, on QA and on stage (each env's auth has its own copy;
// QA_SEED_PASSWORD / STAGE_SEED_PASSWORD hold their passwords, roles are granted in that env's
// auth D1). E2E_*_EMAIL point the suite at other accounts that share SEED_PASSWORD.
export const ACCOUNTS = {
   admin: { email: process.env.E2E_ADMIN_EMAIL || "delivered+cms-e2e-admin@resend.dev", password: SEED_PASSWORD },
   moderator: { email: process.env.E2E_MODERATOR_EMAIL || "delivered+cms-e2e-moderator@resend.dev", password: SEED_PASSWORD },
   viewer: { email: process.env.E2E_VIEWER_EMAIL || "delivered+cms-e2e-viewer@resend.dev", password: SEED_PASSWORD },
   // Has the Scholar role and owns a channel on the env's videos site (docs/SCHOLARS.md).
   scholar: { email: process.env.E2E_SCHOLAR_EMAIL || "delivered+cms-e2e-scholar@resend.dev", password: SEED_PASSWORD },
} satisfies Record<string, Account>;

export const hasCredentials = SEED_PASSWORD.length > 0;

/** The env's videos API (community posts of the scholar's channel). */
export const VIDEOS_API_URL = (process.env.VIDEOS_API_URL ?? "https://videos.api.qa.alummahnow.net").replace(/\/+$/, "");
