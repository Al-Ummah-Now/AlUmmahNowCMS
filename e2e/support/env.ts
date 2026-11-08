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

// Seeded accounts by default; E2E_*_EMAIL point the suite at other accounts (e.g. dedicated,
// short-lived test users) that share SEED_PASSWORD.
export const ACCOUNTS = {
   admin: { email: process.env.E2E_ADMIN_EMAIL || "qa-admin@delivered.resend.dev", password: SEED_PASSWORD },
   moderator: { email: process.env.E2E_MODERATOR_EMAIL || "qa-moderator@delivered.resend.dev", password: SEED_PASSWORD },
   viewer: { email: process.env.E2E_VIEWER_EMAIL || "qa-viewer@delivered.resend.dev", password: SEED_PASSWORD },
} satisfies Record<string, Account>;

export const hasCredentials = SEED_PASSWORD.length > 0;
