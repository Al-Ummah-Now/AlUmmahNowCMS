/**
 * Role mapping (SPEC §3). Auth puts role display names ("Super Admin", "Admin", "Moderator") in
 * the access token's `properties.roles`. They are normalized to snake_case and mapped to a bknd
 * role. Anyone without an allowed role gets the 403 page and nothing is created for them.
 */
export type BkndRole = "admin" | "editor";

export function normalizeRole(name: string): string {
   return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

const MAP: Record<string, BkndRole> = {
   super_admin: "admin",
   admin: "admin",
   moderator: "editor",
};

/** The strongest bknd role granted by the token's roles, or null for no access. */
export function mapRoles(roles: unknown): BkndRole | null {
   if (!Array.isArray(roles)) return null;
   let best: BkndRole | null = null;
   for (const r of roles) {
      if (typeof r !== "string") continue;
      const mapped = MAP[normalizeRole(r)];
      if (mapped === "admin") return "admin";
      if (mapped === "editor") best = "editor";
   }
   return best;
}
