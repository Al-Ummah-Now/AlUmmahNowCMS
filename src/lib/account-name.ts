/**
 * An auth account's name, from its public profile on the videos platform
 * (`GET {VIDEOS_API_URL}/api/profiles/:id`, the profile id is the auth user id = the SSO `sub`).
 * The CMS stores no names of its own for users: the session carries the names resolved here at
 * sign-in (src/routes/sso.ts), and a scholar's profile starts from them.
 *
 * Names follow the one platform rule (src/lib/display-name.ts). The API's public `displayName` is
 * already the resolved name once api-videos ships it; the localized fields still win for the page
 * language. Never throws: a slow or failing videos API means "no name" (callers fall back to email).
 */
import { resolveDisplayName, type NameFields } from "./display-name.ts";

const TIMEOUT_MS = 3000;

export type AccountProfile = NameFields & { resolvedDisplayName?: string | null };

const NAME_KEYS = ["displayName", "displayNameLocalized", "firstName", "firstNameLocalized", "lastName", "lastNameLocalized", "resolvedDisplayName"] as const;

/** The name fields of an account's public profile; null when it has none or the API is unavailable. */
export async function fetchAccountProfile(videosApiUrl: string, sub: string, fetchImpl: typeof fetch = fetch): Promise<AccountProfile | null> {
   if (!videosApiUrl || !sub) return null;
   try {
      const res = await fetchImpl(`${videosApiUrl.replace(/\/+$/, "")}/api/profiles/${encodeURIComponent(sub)}`, {
         headers: { accept: "application/json" },
         signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as { result?: { profile?: unknown }; profile?: unknown } | null;
      const p = body?.result?.profile ?? body?.profile;
      if (!p || typeof p !== "object") return null;
      const out: Record<string, unknown> = {};
      for (const k of NAME_KEYS) if (k in p) out[k] = (p as Record<string, unknown>)[k];
      return out as AccountProfile;
   } catch {
      return null;
   }
}

/**
 * The name the account is shown by in `locale` ('' when none; never the email, never a handle:
 * handles belong to channels). The API's `resolvedDisplayName` only when the fields give nothing.
 */
export function accountName(profile: AccountProfile | null | undefined, locale: string): string {
   if (!profile) return "";
   const r = resolveDisplayName(profile, locale);
   if (r) return r;
   return typeof profile.resolvedDisplayName === "string" ? profile.resolvedDisplayName.replace(/\s+/g, " ").trim() : "";
}
