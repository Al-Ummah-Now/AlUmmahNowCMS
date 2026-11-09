/** bknd's admin used to live at the root; its old URLs now redirect to the staff screens. */
const SCREENS: Record<string, string> = {
   pages: "/pages",
   posts: "/posts",
   nav_items: "/navigation",
   curated_videos: "/videos",
   site_settings: "/site",
   media: "/library",
   users: "/people",
};

export function legacyAdminRedirect(path: string): string | undefined {
   const m = /^\/data\/entity\/([a-z_]+)(?:\/(create|edit\/(\d+)))?\/?$/.exec(path);
   if (m) {
      const base = SCREENS[m[1]];
      if (!base) return "/";
      if (m[2] === "create") return base === "/pages" || base === "/posts" ? `${base}/new` : base;
      if (m[3]) return base === "/pages" || base === "/posts" ? `${base}/${m[3]}` : base;
      return base;
   }
   if (path === "/data" || path.startsWith("/data/")) return "/";
   if (path === "/media" || path.startsWith("/media/")) return "/library";
   if (path === "/auth/users" || path.startsWith("/auth/users/")) return "/people";
   if (["/settings", "/flows", "/tools"].some((x) => path === x || path.startsWith(`${x}/`))) return "/";
   return undefined;
}
