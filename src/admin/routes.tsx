/** @jsxImportSource hono/jsx */
/**
 * Staff screens (docs/ADMIN_UI_SPEC.md §2). Mounted at the root behind the session gate in
 * src/index.ts; every handler renders complete HTML from bknd reads (src/admin/data.ts).
 */
import { Hono } from "hono";
import type { Child } from "hono/jsx";
import type { AppEnv, Ctx, Deps } from "../types.ts";
import { assetResponse, assetUrls } from "./assets.ts";
import { Data } from "./data.ts";
import { ADMIN_STRINGS } from "./i18n.ts";
import { resolvePrefs } from "./prefs.ts";
import { overviewScreen } from "./screens/overview.tsx";
import { peopleScreen } from "./screens/people.tsx";
import { Shell, type View } from "./ui/layout.tsx";

/** Paths the staff screens own (the session gate in src/index.ts uses this). */
export const ADMIN_SCREENS = ["/pages", "/posts", "/navigation", "/videos", "/site", "/library", "/people"];
export const isStaffScreen = (p: string) => p === "/" || ADMIN_SCREENS.some((x) => p === x || p.startsWith(`${x}/`));

export async function buildView(c: Ctx, deps: Deps): Promise<View> {
   const prefs = await resolvePrefs(c, deps.fetch);
   const cfg = c.get("cfg");
   const url = new URL(c.req.url);
   const user = c.get("user");
   const adminWeb = (c.env.ADMIN_WEB_URL || "https://admin.alummahnow.net").replace(/\/+$/, "");
   return {
      prefs,
      t: ADMIN_STRINGS[prefs.lang],
      path: url.pathname,
      search: url.searchParams.toString(),
      nonce: c.get("nonce"),
      user: { email: user.email, role: user.role === "admin" ? "admin" : "editor" },
      wwwUrl: cfg.wwwUrl,
      adminWebUrl: adminWeb,
      assets: assetUrls(prefs.theme),
   };
}

export function render(c: Ctx, v: View, title: string, body: Child, status: 200 | 403 | 404 = 200) {
   return c.html(
      "<!doctype html>" +
         (
            <Shell v={v} title={title}>
               {body}
            </Shell>
         ).toString(),
      status,
   );
}

export function adminRoutes(deps: Deps): Hono<AppEnv> {
   const r = new Hono<AppEnv>();

   r.get("/", async (c) => {
      const v = await buildView(c, deps);
      return render(c, v, v.t.overview.title, await overviewScreen(v, new Data(c, deps)));
   });

   r.get("/people", async (c) => {
      const v = await buildView(c, deps);
      if (v.user.role !== "admin") return render(c, v, v.t.common.adminOnly, <p class="notice">{v.t.common.adminOnly}</p>, 403);
      return render(c, v, v.t.people.title, await peopleScreen(v, new Data(c, deps)));
   });

   return r;
}

/** Public, immutable, data-free: CSS and JS for the screens. */
export function adminAssets(): Hono<AppEnv> {
   const r = new Hono<AppEnv>();
   r.get("/*", (c) => assetResponse(c.req.path) ?? c.text("not found", 404));
   return r;
}
