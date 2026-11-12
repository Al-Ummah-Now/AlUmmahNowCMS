/**
 * The account menu's "Al Ummah Now apps" section: the same apps, order and labels in every app
 * (AlUmmahNow docs/design/NAV.md; packages/shared-types/src/app-links.ts there). The CMS knows its
 * own role, which maps from the auth roles (src/lib/roles.ts): admin = super_admin/admin, editor =
 * moderator, writer = scholar. The gates mirror each app's guard (the profile app's catalog).
 */
import type { BkndRole } from "./roles.ts";

export type AppLinkId = "www" | "videos" | "profile" | "admin" | "auth-admin";

export interface AppLinkUrls {
   www: string;
   videos: string;
   /** The videos admin (admin-web). */
   admin: string;
   /** The auth server; the profile app is profile.<host> and the auth admin admin.<host>. */
   issuer: string;
}

const ORDER: { id: AppLinkId; roles: readonly BkndRole[] | null }[] = [
   { id: "www", roles: null },
   { id: "videos", roles: null },
   { id: "profile", roles: null },
   { id: "admin", roles: ["admin", "editor"] },
   { id: "auth-admin", roles: ["admin"] },
];

function sibling(url: string, prefix: string): string {
   try {
      const u = new URL(url);
      return `${u.protocol}//${prefix}.${u.host}`;
   } catch {
      return "";
   }
}

export function appLinks(role: BkndRole, lang: "en" | "ar", urls: AppLinkUrls): { id: AppLinkId; href: string }[] {
   const trim = (u: string) => u.replace(/\/+$/, "");
   const href: Record<AppLinkId, string> = {
      www: urls.www ? `${trim(urls.www)}/${lang}/` : "",
      videos: urls.videos ? `${trim(urls.videos)}/${lang}` : "",
      profile: urls.issuer ? `${sibling(urls.issuer, "profile")}/?lang=${lang}` : "",
      admin: trim(urls.admin),
      "auth-admin": sibling(urls.issuer, "admin"),
   };
   return ORDER.filter((a) => !a.roles || a.roles.includes(role))
      .map((a) => ({ id: a.id, href: href[a.id] }))
      .filter((a) => a.href !== "" && !a.href.startsWith("/"));
}
