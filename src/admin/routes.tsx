/** @jsxImportSource hono/jsx */
/**
 * Staff screens (docs/ADMIN_UI_SPEC.md §2). Mounted at the root behind the session gate in
 * src/index.ts; every handler renders complete HTML from bknd reads (src/admin/data.ts).
 */
import { Hono } from "hono";
import { subOfUser } from "../lib/scholars/ownership.ts";
import { scholarById, scholarName, scholarOfSub, type Scholar } from "../lib/scholars/profiles.ts";
import { accountName, fetchAccountProfile } from "../lib/account-name.ts";
import { ownedChannels } from "../lib/scholars/videos-internal.ts";
import { errText, log } from "../lib/log.ts";
import { featuringApi, scholarsApi } from "./scholars-api.ts";
import { featuringScreen, parseFeaturingParams, profileScreen, scholarsListScreen } from "./screens/scholars.tsx";
import { writeScreen } from "./screens/write.tsx";
import { tabIconLinks } from "../lib/app-icons.ts";
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
import { libraryApi, listsApi } from "./lists-api.ts";
import { trashApi } from "./trash-api.ts";
import { glossaryApi, translationFlagsApi } from "./translation-flags-api.ts";
import { glossaryScreen } from "./screens/glossary.tsx";
import { trashScreen } from "./screens/trash.tsx";
import { isTrashKind } from "../lib/trash.ts";
import { suggestApi } from "./suggest-api.ts";
import { timelineScreen } from "./screens/timeline.tsx";
import { parseCursor } from "../lib/feed/model.ts";
import { aiRoutes } from "./ai-api.ts";
import { aiSettingsScreen } from "./screens/ai-settings.tsx";
import { aiReady } from "../lib/ai/router.ts";
import { flaggedFailures } from "../lib/ai/jobs.ts";
import { libraryScreen, navigationScreen, siteScreen } from "./screens/site.tsx";
import { libraryVideosScreen } from "./screens/videos-library.tsx";
import { curatedPage } from "../lib/page-entries.ts";
import { Shell, type View } from "./ui/layout.tsx";
import { passkeySetupUrl, sessionPasskeyDeadline } from "../lib/passkeys.ts";

/** Paths the staff screens own (the session gate in src/index.ts uses this). */
export const ADMIN_SCREENS = ["/admin/api", "/pages", "/posts", "/write", "/timeline", "/navigation", "/videos", "/site", "/library", "/people", "/deleted", "/ai-settings", "/scholars", "/featuring", "/glossary"];
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
      user: {
         email: user.email,
         name: ((prefs.lang === "ar" ? user.name_ar : user.name_en) ?? "").trim(),
         role: user.role === "admin" ? "admin" : user.role === "writer" ? "writer" : user.role === "staff_writer" ? "staff_writer" : "editor",
         sub: user.role === "writer" ? await subOfUser(c.env.DB, user.id) : null,
      },
      wwwUrl: cfg.wwwUrl,
      adminWebUrl: adminWeb,
      videosWebUrl: cfg.videosWebUrl,
      issuer: cfg.issuer,
      assets: assetUrls(prefs.theme),
      tabIcons: tabIconLinks(c.env.ENVIRONMENT),
      ai: await aiReady(c.env).catch(() => false),
      passkey: passkeyBanner(user, cfg, url, prefs.lang),
   };
}

/** The grace banner for a staff session signed in without a passkey (src/lib/passkeys.ts). */
function passkeyBanner(user: { pkd?: unknown }, cfg: { issuer: string; publicUrl: string }, url: URL, lang: "en" | "ar"): View["passkey"] {
   const deadline = sessionPasskeyDeadline(user);
   if (deadline === null) return null;
   return { deadline, setupUrl: passkeySetupUrl(cfg.issuer, cfg.publicUrl, url.pathname + url.search, lang) };
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
      // A scholar's home is "Write in Studio" (docs/SCHOLARS.md §7, SS18).
      if (c.get("user")?.role === "writer") return c.redirect("/write", 302);
      // A staff writer's home is the posts list (Al Ummah Now's own posts)
      if (c.get("user")?.role === "staff_writer") return c.redirect("/posts", 302);
      const v = await buildView(c, deps);
      const failures = v.user.role === "admin" ? await flaggedFailures(c.env.DB).catch(() => null) : null;
      return render(c, v, v.t.overview.title, await overviewScreen(v, new Data(c, deps), c.env.DB, failures));
   });

   r.get("/write", async (c) => {
      const v = await buildView(c, deps);
      if (v.user.role !== "writer") return c.redirect("/posts", 302);
      return render(c, v, v.t.write.title, await writeScreen(v, c.env.DB));
   });
   // Scholars write in Studio: their old post screens lead to /write.
   r.use("/posts/*", async (c, next) => (c.get("user")?.role === "writer" ? c.redirect("/write", 302) : next()));
   r.use("/posts", async (c, next) => (c.get("user")?.role === "writer" ? c.redirect("/write", 302) : next()));

   for (const kind of ["pages", "posts"] as ContentKind[]) {
      r.get(`/${kind}`, async (c) => {
         const v = await buildView(c, deps);
         return render(c, v, v.t.entities[kind].many, await contentList(v, new Data(c, deps), kind, parseListParams(new URL(c.req.url)), c.env.DB));
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
   r.route("/admin/api/lists", listsApi(deps));
   r.route("/admin/api/library", libraryApi(deps));
   r.route("/admin/api/scholars", scholarsApi(deps));
   r.route("/admin/api/featuring", featuringApi());
   r.route("/admin/api/suggest", suggestApi(deps));
   r.route("/admin/api/ai", aiRoutes(deps));
   r.route("/admin/api/trash", trashApi());
   r.route("/admin/api/translation-flags", translationFlagsApi(deps));
   r.route("/admin/api/glossary", glossaryApi());
   r.route("/admin/api", mediaAltRoute(deps));

   const loc = (v: string | undefined, fallback: "en" | "ar") => (v === "en" || v === "ar" ? v : fallback);

   r.get("/navigation", async (c) => {
      const v = await buildView(c, deps);
      const menu = c.req.query("menu") === "footer" ? "footer" : "header";
      return render(c, v, v.t.menus.title, await navigationScreen(v, new Data(c, deps), menu, loc(c.req.query("locale"), v.prefs.lang)));
   });

   // The CMS video library (docs/specs/WWW-PAGES.md): replaces the old curated home / videos-page lists.
   r.get("/videos", async (c) => {
      const v = await buildView(c, deps);
      const kind = c.req.query("kind");
      const page = Math.min(Math.max(Number.parseInt(c.req.query("page") ?? "1", 10) || 1, 1), 10_000);
      return render(
         c,
         v,
         v.t.library2.title,
         await libraryVideosScreen(v, c.env, { q: (c.req.query("q") ?? "").slice(0, 100), kind: kind === "video" || kind === "playlist" || kind === "channel" ? kind : null, page }, c.get("cfg").videosWebUrl),
      );
   });

   // A curated page's list: the Timeline screen, scoped to the page.
   r.get("/pages/:id{[0-9]+}/list", async (c) => {
      const v = await buildView(c, deps);
      const page = await curatedPage(c.env, Number(c.req.param("id"))).catch(() => null);
      if (!page || v.user.role === "writer") return render(c, v, v.t.common.notFound, <p class="notice">{v.t.common.notFound}</p>, 404);
      return render(c, v, v.t.timeline.listTitle(page.title), await timelineScreen(v, c.env, page.locale, null, c.get("cfg").videosWebUrl, page));
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

   r.get("/deleted", async (c) => {
      const v = await buildView(c, deps);
      if (v.user.role !== "admin") return render(c, v, v.t.common.adminOnly, <p class="notice">{v.t.common.adminOnly}</p>, 403);
      const kind = c.req.query("kind");
      const page = Math.min(Math.max(Number.parseInt(c.req.query("page") ?? "1", 10) || 1, 1), 10_000);
      return render(c, v, v.t.trash.title, await trashScreen(v, c.env.DB, isTrashKind(kind) ? kind : null, page));
   });

   r.get("/glossary", async (c) => {
      const v = await buildView(c, deps);
      if (v.user.role === "writer") return render(c, v, v.t.common.notFound, <p class="notice">{v.t.common.notFound}</p>, 404);
      const deleted = c.req.query("deleted") === "1" && v.user.role === "admin";
      return render(c, v, v.t.glossary.title, await glossaryScreen(v, c.env.DB, (c.req.query("q") ?? "").trim().slice(0, 100), deleted));
   });

   r.get("/ai-settings", async (c) => {
      const v = await buildView(c, deps);
      if (v.user.role !== "admin") return render(c, v, v.t.common.adminOnly, <p class="notice">{v.t.common.adminOnly}</p>, 403);
      return render(c, v, v.t.aiSettings.title, await aiSettingsScreen(v, c.env));
   });

   // Scholars (docs/SCHOLARS.md): a writer's own profile; staff list and edit every profile.
   const profile = async (c: Ctx, scholar: Scholar | null, endpoint: string) => {
      const v = await buildView(c, deps);
      if (!scholar) return render(c, v, v.t.common.notFound, <p class="notice">{v.t.scholars.noProfile}</p>, 404);
      const needsName = !scholar.name_en?.trim() || !scholar.name_ar?.trim();
      const [channels, avatar, account] = await Promise.all([
         ownedChannels(c.env, scholar.sso_sub, deps.fetch).catch((error) => {
            log.warn("scholar channels unavailable", { error: errText(error) });
            return null;
         }),
         scholar.avatar_media_id ? c.env.DB.prepare("SELECT path FROM media WHERE id = ?1").bind(scholar.avatar_media_id).first<{ path: string | null }>() : Promise.resolve(null),
         needsName ? fetchAccountProfile(c.get("cfg").videosApiUrl, scholar.sso_sub, deps.fetch) : Promise.resolve(null),
      ]);
      return render(c, v, v.user.role === "writer" ? v.t.scholars.myProfile : scholarName(scholar, v.prefs.lang), profileScreen(v, {
            scholar,
            channels,
            avatarPath: avatar?.path ?? null,
            endpoint,
            publicUrl: c.get("cfg").publicUrl,
            accountNames: { en: accountName(account, "en"), ar: accountName(account, "ar") },
         }));
   };
   r.get("/scholars/me", async (c) => {
      const sub = await subOfUser(c.env.DB, c.get("user").id);
      return profile(c, await scholarOfSub(c.env.DB, sub), "/admin/api/scholars/me");
   });
   r.get("/scholars", async (c) => {
      const v = await buildView(c, deps);
      const q = (c.req.query("q") ?? "").trim().slice(0, 100);
      const page = Math.min(Math.max(Number.parseInt(c.req.query("page") ?? "1", 10) || 1, 1), 10_000);
      return render(c, v, v.t.scholars.title, await scholarsListScreen(v, c.env.DB, q, page));
   });
   r.get("/scholars/:id{[0-9]+}", async (c) => profile(c, await scholarById(c.env.DB, Number(c.req.param("id"))), `/admin/api/scholars/${c.req.param("id")}`));
   r.get("/featuring", async (c) => {
      const v = await buildView(c, deps);
      return render(c, v, v.t.featuring.title, await featuringScreen(v, c.env, parseFeaturingParams(new URL(c.req.url)), c.get("cfg").videosApiUrl, deps.fetch));
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
