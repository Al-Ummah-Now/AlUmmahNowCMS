/** @jsxImportSource hono/jsx */
/**
 * Staff screens (docs/ADMIN_UI_SPEC.md §2). Mounted at the root behind the session gate in
 * src/index.ts; every handler renders complete HTML from bknd reads (src/admin/data.ts).
 */
import { Hono } from "hono";
import { faviconSvgPath } from "../lib/app-icons.ts";
import type { Child } from "hono/jsx";
import type { AppEnv, Ctx, Deps } from "../types.ts";
import { assetResponse, assetUrls } from "./assets.ts";
import { Data } from "./data.ts";
import { ADMIN_STRINGS } from "./i18n.ts";
import { resolvePrefs } from "./prefs.ts";
import { overviewScreen } from "./screens/overview.tsx";
import { peopleScreen } from "./screens/people.tsx";
import { contentEditor, contentList, parseListParams, type ContentKind } from "./screens/content.tsx";
import { historyScreen } from "./screens/history.tsx";
import { mediaAltRoute } from "./api.ts";
import { timelineApi } from "./timeline-api.ts";
import { timelineScreen } from "./screens/timeline.tsx";
import { parseCursor } from "../lib/feed/model.ts";
import { aiRoutes } from "./ai-api.ts";
import { aiConfigured } from "../lib/ai/config.ts";
import { flaggedFailures } from "../lib/ai/jobs.ts";
import { libraryScreen, navigationScreen, siteScreen, videosScreen } from "./screens/site.tsx";
import { Shell, type View } from "./ui/layout.tsx";

/** Paths the staff screens own (the session gate in src/index.ts uses this). */
export const ADMIN_SCREENS = ["/admin/api", "/pages", "/posts", "/timeline", "/navigation", "/videos", "/site", "/library", "/people"];
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
      favicon: faviconSvgPath(c.env.ENVIRONMENT),
      ai: aiConfigured(c.env),
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
      const failures = v.user.role === "admin" ? await flaggedFailures(c.env.DB).catch(() => null) : null;
      return render(c, v, v.t.overview.title, await overviewScreen(v, new Data(c, deps), c.env.DB, failures));
   });

   for (const kind of ["pages", "posts"] as ContentKind[]) {
      r.get(`/${kind}`, async (c) => {
         const v = await buildView(c, deps);
         return render(c, v, v.t.entities[kind].many, await contentList(v, new Data(c, deps), kind, parseListParams(new URL(c.req.url))));
      });
      r.get(`/${kind}/new`, async (c) => {
         const v = await buildView(c, deps);
         const locale = c.req.query("locale") === "ar" ? "ar" : c.req.query("locale") === "en" ? "en" : v.prefs.lang;
         return render(c, v, kind === "pages" ? v.t.content.newPage : v.t.content.newPost, await contentEditor(v, new Data(c, deps), kind, null, locale, c.env.DB));
      });
      r.get(`/${kind}/:id{[0-9]+}`, async (c) => {
         const v = await buildView(c, deps);
         const body = await contentEditor(v, new Data(c, deps), kind, Number(c.req.param("id")), v.prefs.lang, c.env.DB);
         if (!body) return render(c, v, v.t.common.notFound, <p class="notice">{v.t.common.notFound}</p>, 404);
         return render(c, v, v.t.entities[kind].one, body);
      });
      r.get(`/${kind}/:id{[0-9]+}/history`, async (c) => {
         const v = await buildView(c, deps);
         const page = Math.min(Math.max(Number.parseInt(c.req.query("page") ?? "1", 10) || 1, 1), 10_000);
         const rev = Number.parseInt(c.req.query("rev") ?? "", 10);
         const body = await historyScreen(v, new Data(c, deps), kind, Number(c.req.param("id")), page, Number.isFinite(rev) ? rev : null);
         if (!body) return render(c, v, v.t.common.notFound, <p class="notice">{v.t.common.notFound}</p>, 404);
         return render(c, v, v.t.history.title, body);
      });
   }

   r.route("/admin/api/timeline", timelineApi(deps));
   r.route("/admin/api/ai", aiRoutes());
   r.route("/admin/api", mediaAltRoute(deps));

   const loc = (v: string | undefined, fallback: "en" | "ar") => (v === "en" || v === "ar" ? v : fallback);

   r.get("/navigation", async (c) => {
      const v = await buildView(c, deps);
      const menu = c.req.query("menu") === "footer" ? "footer" : "header";
      return render(c, v, v.t.menus.title, await navigationScreen(v, new Data(c, deps), menu, loc(c.req.query("locale"), v.prefs.lang)));
   });

   r.get("/videos", async (c) => {
      const v = await buildView(c, deps);
      const placement = c.req.query("placement") === "videos" ? "videos" : "home";
      return render(c, v, v.t.videos.title, await videosScreen(v, new Data(c, deps), placement, c.get("cfg").videosWebUrl, c.req.query("add") === "1"));
   });

   r.get("/timeline", async (c) => {
      const v = await buildView(c, deps);
      const raw = c.req.query("before") ?? null;
      const before = raw && parseCursor(raw) ? raw : null;
      return render(c, v, v.t.timeline.title, await timelineScreen(v, c.env, loc(c.req.query("locale"), v.prefs.lang), before, c.get("cfg").videosWebUrl));
   });

   r.get("/site", async (c) => {
      const v = await buildView(c, deps);
      return render(c, v, v.t.site.title, await siteScreen(v, new Data(c, deps), loc(c.req.query("locale"), v.prefs.lang)));
   });

   r.get("/library", async (c) => {
      const v = await buildView(c, deps);
      return render(c, v, v.t.library.title, await libraryScreen(v, new Data(c, deps)));
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
