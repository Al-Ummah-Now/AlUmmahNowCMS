/**
 * Role mapping (SPEC §3). Auth puts role display names ("Super Admin", "Admin", "Moderator",
 * "Scholar") in the access token's `properties.roles`. They are normalized to snake_case and mapped
 * to a bknd role. Anyone without an allowed role gets the 403 page and nothing is created for them.
 *
 *   super_admin, admin → admin   everything
 *   moderator          → editor  all content, the timeline, featuring; no deletes, no settings
 *   scholar            → writer  their own posts only (docs/SCHOLARS.md)
 */
export type BkndRole = "admin" | "editor" | "writer";

export function normalizeRole(name: string): string {
   return name.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

const MAP: Record<string, BkndRole> = {
   super_admin: "admin",
   admin: "admin",
   moderator: "editor",
   scholar: "writer",
};

const RANK: Record<BkndRole, number> = { writer: 1, editor: 2, admin: 3 };

/** The strongest bknd role granted by the token's roles, or null for no access. */
export function mapRoles(roles: unknown): BkndRole | null {
   if (!Array.isArray(roles)) return null;
   let best: BkndRole | null = null;
   for (const r of roles) {
      if (typeof r !== "string") continue;
      const mapped = MAP[normalizeRole(r)];
      if (mapped && (!best || RANK[mapped] > RANK[best])) best = mapped;
   }
   return best;
}

/** Staff = may edit everything (admin, editor). A writer is not staff. */
export const isStaffRole = (role: unknown): role is "admin" | "editor" => role === "admin" || role === "editor";
/** Any role that may use the CMS at all. */
export const isCmsRole = (role: unknown): role is BkndRole => role === "admin" || role === "editor" || role === "writer";
