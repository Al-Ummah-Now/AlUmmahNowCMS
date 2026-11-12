/**
 * The one rule for the name a user is shown by, everywhere (owner rule 2026-11-12: "display name
 * should be the first and last as a fallback"). A copy of the AlUmmahNow monorepo's
 * packages/shared-types/src/display-name.ts: keep the two identical.
 *
 * Order:
 *   1. display name in `locale` (displayNameLocalized[locale])
 *   2. plain display name
 *   3. first + last name (in `locale` when localized, else the plain ones), whichever of the two exists
 *   4. a display name, or first + last, in another language (an Arabic-only profile still has a name
 *      on an English page)
 *   5. @handle (userName)
 *
 * Empty and whitespace-only values count as missing. It never returns the email: a caller that has
 * nothing else decides on email itself (`resolveDisplayName(profile, locale) || email`). Returns ''
 * when the profile has no name at all.
 */

export interface NameFields {
   displayName?: string | null;
   displayNameLocalized?: Record<string, string | null | undefined> | null;
   firstName?: string | null;
   firstNameLocalized?: Record<string, string | null | undefined> | null;
   lastName?: string | null;
   lastNameLocalized?: Record<string, string | null | undefined> | null;
   /** The handle; shown as @handle */
   userName?: string | null;
   /** Some records store the handle as `handle` */
   handle?: string | null;
}

function clean(value: unknown): string {
   return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function localized(map: NameFields["displayNameLocalized"], locale: string | undefined): string {
   if (!map || typeof map !== "object" || !locale) return "";
   return clean(map[locale]) || clean(map[locale.split("-")[0]]);
}

function fullName(first: string, last: string): string {
   return [first, last].filter(Boolean).join(" ");
}

/** Languages other than `locale` that a localized map holds a value for, in a stable order (en, ar, then the rest). */
function otherLocales(profile: NameFields, locale: string | undefined): string[] {
   const keys = new Set<string>();
   for (const map of [profile.displayNameLocalized, profile.firstNameLocalized, profile.lastNameLocalized]) {
      if (map && typeof map === "object") for (const key of Object.keys(map)) keys.add(key);
   }
   const base = locale?.split("-")[0];
   return [...keys].filter((key) => key !== locale && key !== base).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function rank(key: string): number {
   return key === "en" ? 0 : key === "ar" ? 1 : 2;
}

/**
 * The display name, then first + last, without the @handle fallback. For places that keep the
 * handle in its own field, or that need a person's name (a new scholar profile).
 */
export function resolvePersonalName(profile: NameFields | null | undefined, locale?: string): string {
   if (!profile || typeof profile !== "object") return "";
   const display = localized(profile.displayNameLocalized, locale) || clean(profile.displayName);
   if (display) return display;
   const first = localized(profile.firstNameLocalized, locale) || clean(profile.firstName);
   const last = localized(profile.lastNameLocalized, locale) || clean(profile.lastName);
   const full = fullName(first, last);
   if (full) return full;
   for (const other of otherLocales(profile, locale)) {
      const name =
         localized(profile.displayNameLocalized, other) || fullName(localized(profile.firstNameLocalized, other), localized(profile.lastNameLocalized, other));
      if (name) return name;
   }
   return "";
}

/** The name a user is shown by (see the order above); '' when there is none. Never the email. */
export function resolveDisplayName(profile: NameFields | null | undefined, locale?: string): string {
   const name = resolvePersonalName(profile, locale);
   if (name) return name;
   const handle = clean(profile?.userName) || clean(profile?.handle);
   return handle ? `@${handle.replace(/^@+/, "")}` : "";
}
