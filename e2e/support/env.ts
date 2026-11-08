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

export const ACCOUNTS = {
   admin: { email: "qa-admin@delivered.resend.dev", password: SEED_PASSWORD },
   moderator: { email: "qa-moderator@delivered.resend.dev", password: SEED_PASSWORD },
   viewer: { email: "qa-viewer@delivered.resend.dev", password: SEED_PASSWORD },
} satisfies Record<string, Account>;

export const hasCredentials = SEED_PASSWORD.length > 0;
