/**
 * cms.alummahnow.net Worker: a Hono wrapper around bknd (code mode) — SPEC §3–§7.
 *
 *   /healthz                 liveness (+ ?deep=1: config and D1)
 *   /api/public/v1/*         public read API (published rows only), CORS for www
 *   /api/preview/v1/*        draft preview for www (one row per signed, expiring token; no CORS)
 *   /preview/:kind/:id       staff: mint a preview token, 303 → www/preview (session required)
 *   /sso/*                   SSO login/callback/logout (PKCE public client)
 *   /admin-assets/*          staff screens' CSS/JS (public, immutable, no data)
 *   /, /pages, /posts, …     staff screens (src/admin; session required, else → /sso/login)
 *   /admin/api/*, /picker/api/*  Worker endpoints the screens need (session, same-origin)
 *   /api/*                   bknd API (guard on; same-origin check on mutations)
 *   /data/*, /media, /bknd   bknd's retired admin UI → redirects to the staff screens
 */
import { Hono } from "hono";
import { getBkndApp, MediaExistsError } from "./app.ts";
import { MEDIA_MAX_BYTES } from "./bknd-config.ts";
import { ALLOWED_UPLOAD, blockedApiPath, contentCollectionPath, isRetiredBkndAdminPath, uploadAllowed, uploadName } from "./lib/paths.ts";
import { ConfigError, runtimeConfig, type Env } from "./env.ts";
import { remoteJwks } from "./lib/oidc.ts";
import { refreshCuratedSnapshots } from "./lib/snapshots.ts";
import { consumeVariants, deleteVariants, sweepVariants, type VariantMessage } from "./lib/variants/jobs.ts";
import { VARIANT_ROOT } from "./lib/variants/plan.ts";
import { withActor } from "./lib/revisions.ts";
import { ACCOUNT_PAGES } from "./lib/pages.ts";
import { adminAssets, adminRoutes, isStaffScreen } from "./admin/routes.tsx";
import { legacyAdminRedirect } from "./admin/legacy.ts";
import { entityUploadTarget, keepNewestMedia } from "./admin/media-cleanup.ts";
import { applyPrivateHeaders, contentSecurityPolicy, nonce, sameOriginOk } from "./lib/security.ts";
import { pickerRoutes } from "./routes/picker.ts";
import { previewApi, previewRoutes } from "./routes/preview.ts";
import { publicApi } from "./routes/public-api.ts";
import { renderStatus, ssoRoutes } from "./routes/sso.ts";
import type { AppEnv, AuthUser, Ctx, Deps } from "./types.ts";

async function multipartAllowed(request: Request): Promise<boolean> {
   const form = await request.clone().formData();
   for (const value of form.values()) {
      if (typeof value === "string") continue;
      const file = value as unknown as File;
      const type = (file.type ?? "").toLowerCase();
      const ext = (file.name ?? "").toLowerCase().split(".").pop() ?? "";
      const exts = ALLOWED_UPLOAD.get(type);
      if (!exts || !exts.includes(ext) || file.size > MEDIA_MAX_BYTES) return false;
   }
   return true;
}

/** A media object or row already uses this name. */
async function mediaExists(env: Env, name: string): Promise<boolean> {
   const [object, row] = await Promise.all([
      env.MEDIA.head(name),
      env.DB.prepare("SELECT 1 AS x FROM media WHERE path = ?1 LIMIT 1").bind(name).first(),
   ]);
   return object !== null || row !== null;
}

function withHeaders(res: Response, csp?: string, ownOrigin?: string): Response {
   const out = new Response(res.body, res);
   applyPrivateHeaders(out.headers, csp, ownOrigin);
   return out;
}

async function sessionUser(c: Ctx, deps: Deps): Promise<AuthUser | undefined> {
   if (!/(?:^|;\s*)auth=/.test(c.req.header("Cookie") ?? "")) return undefined;
   const app = await deps.getApp(c);
   const user = (await app.module.auth.authenticator.resolveAuthFromRequest(c.req.raw)) as AuthUser | undefined;
   return user && (user.role === "admin" || user.role === "editor") ? user : undefined;
}

export function createWorker(deps: Deps): Hono<AppEnv> {
   const app = new Hono<AppEnv>();

   app.get("/healthz", async (c) => {
      const version = (c.env as Env & { CF_VERSION_METADATA?: { id?: string } }).CF_VERSION_METADATA?.id ?? null;
      const body: Record<string, unknown> = { status: "ok", env: c.env.ENVIRONMENT, version };
      if (c.req.query("deep") === "1") {
         const checks: Record<string, string> = {};
         try {
            runtimeConfig(c.env);
            checks.config = "ok";
         } catch (error) {
            checks.config = (error as Error).message;
         }
         try {
            await c.env.DB.prepare("SELECT 1 FROM pages LIMIT 1").all();
            checks.d1 = "ok";
         } catch {
            checks.d1 = "error";
         }
         body.checks = checks;
         if (Object.values(checks).some((v) => v !== "ok")) body.status = "degraded";
      }
      return c.json(body, body.status === "ok" ? 200 : 503, { "Cache-Control": "no-store" });
   });

   // Public API: no session, no bknd boot, works even before secrets are set.
   app.route("/api/public/v1", publicApi() as unknown as Hono<AppEnv>);
   // Preview API: www server-side with a preview token (src/routes/preview.ts). Never cached.
   app.route("/api/preview/v1", previewApi() as unknown as Hono<AppEnv>);

   // Staff screens' CSS/JS: public, immutable, no data (content-hashed names).
   app.route("/admin-assets", adminAssets() as unknown as Hono<AppEnv>);

   // Everything below needs a valid runtime config (fail closed when a secret is missing).
   app.use("*", async (c, next) => {
      const n = nonce();
      c.set("nonce", n);
      try {
         c.set("cfg", runtimeConfig(c.env));
      } catch (error) {
         if (!(error instanceof ConfigError)) throw error;
         console.error("config error:", error.message);
         return withHeaders(renderStatus(c, "error", 503), contentSecurityPolicy({ nonce: n }));
      }
      await next();
      // Private headers on everything that is not the public API (already returned above).
      const isPicker = c.req.path === "/picker" || c.req.path.startsWith("/picker/") || isStaffScreen(c.req.path);
      const cfg = c.get("cfg");
      const csp = contentSecurityPolicy({
         nonce: n,
         frameSrc: isPicker ? [cfg.videosWebUrl] : undefined,
         // The account chooser reads auth's accounts API from the browser.
         connectSrc: ACCOUNT_PAGES.has(c.req.path) ? [new URL(cfg.issuer).origin] : undefined,
      });
      c.res = withHeaders(c.res, csp, new URL(cfg.publicUrl).origin);
   });

   app.route("/sso", ssoRoutes(deps));

   // bknd's own login/register/logout UI and endpoints → SSO, or gone.
   app.get("/auth/login", (c) => c.redirect(`/sso/login?return=${encodeURIComponent(c.req.query("return") ?? "/")}`, 302));
   app.all("/auth/register", (c) => renderStatus(c, "not_found", 404));
   app.all("/auth/logout", (c) => c.redirect("/sso/logout", 302));
   app.all("/api/auth/logout", (c) => c.redirect("/sso/logout", 302));

   // bknd's old admin URLs → the matching staff screen (bookmarks, links in old messages).
   app.get("*", async (c, next) => {
      const to = isRetiredBkndAdminPath(c.req.path) ? "/" : legacyAdminRedirect(c.req.path);
      return to ? c.redirect(to, 302) : next();
   });

   // Session gate for the staff screens and the picker.
   app.use("*", async (c, next) => {
      const p = c.req.path;
      const gated = isStaffScreen(p) || p === "/picker" || p.startsWith("/picker/") || p.startsWith("/preview/");
      if (!gated) return next();
      const user = await sessionUser(c, deps);
      if (!user) {
         if (p.startsWith("/picker/api/") || p.startsWith("/admin/api/")) return c.json({ error: "unauthorized" }, 401);
         const url = new URL(c.req.url);
         return c.redirect(`/sso/login?return=${encodeURIComponent(url.pathname + url.search)}`, 302);
      }
      c.set("user", user);
      return next();
   });

   app.all("/api/*", async (c, next) => {
      if (blockedApiPath(c.req.method, c.req.path)) return c.json({ error: "not_found" }, 404);
      return next();
   });

   // CSRF: same-origin Origin on every non-GET to bknd's API and the picker API.
   app.use("*", async (c, next) => {
      const p = c.req.path;
      if ((p.startsWith("/api/") || p.startsWith("/picker/api/") || p.startsWith("/admin/api/")) && !sameOriginOk(c.req.raw, c.get("cfg").publicUrl)) {
         return c.json({ error: "forbidden", message: "cross-origin request rejected" }, 403);
      }
      return next();
   });

   app.route("/picker", pickerRoutes(deps));
   app.route("/preview", previewRoutes());
   app.route("/", adminRoutes(deps));

   app.all("/api/*", async (c) => {
      const p = c.req.path;
      if (c.req.method === "POST" && (p.startsWith("/api/media/upload") || p.startsWith("/api/media/entity/"))) {
         const verdict = uploadAllowed(c.req.raw, p);
         if (!verdict.ok) return c.json({ error: "unsupported_media", message: verdict.message }, verdict.status);
         const type = (c.req.header("content-type") ?? "").toLowerCase();
         if (type.startsWith("multipart/form-data") && !(await multipartAllowed(c.req.raw))) {
            return c.json({ error: "unsupported_media", message: "Only JPEG, PNG, WebP and AVIF images up to 10 MB" }, 415);
         }
      }
      // A JSON array is bknd's bulk insert, which skips the mutator events (content rules, history).
      if (c.req.method === "POST" && contentCollectionPath(p) && (await c.req.raw.clone().text()).trimStart().startsWith("[")) {
         return c.json({ error: "bad_request", message: "Create one item per request" }, 400);
      }
      const named = c.req.method === "POST" ? uploadName(p) : null;
      if (named?.startsWith(VARIANT_ROOT)) {
         return c.json({ error: "bad_request", message: `Names starting with "${VARIANT_ROOT}" are reserved` }, 400);
      }
      if (named && (await mediaExists(c.env, named))) {
         // Fast path before the body is read; the create-only R2 put (src/app.ts) is the atomic guarantee.
         return c.json({ error: "conflict", message: new MediaExistsError(named).message }, 409);
      }
      const bknd = await deps.getApp(c);
      // Writes run with the signed-in user as the actor, so content history records who (#8).
      const actor = c.req.method === "GET" || c.req.method === "HEAD" ? undefined : await sessionUser(c, deps);
      const res = await withActor({ id: actor?.id ?? null, email: actor?.email ?? null }, () => bknd.fetch(c.req.raw, c.env, c.executionCtx));
      const target = c.req.method === "POST" && res.ok ? entityUploadTarget(p) : null;
      if (target) await keepNewestMedia(bknd, c.env.MEDIA, target, (path) => deleteVariants(c.env, path));
      if (res.ok && c.req.method === "POST" && (p.startsWith("/api/media/upload") || target)) {
         // Image variants for the new original (CMS-10): queue it now instead of waiting for the cron.
         c.executionCtx.waitUntil(sweepVariants(c.env, 5).catch((e) => console.error("variant enqueue failed", String(e))));
      }
      const deleted = c.req.method === "DELETE" && res.ok ? /^\/api\/media\/file\/(.+)$/.exec(p) : null;
      if (deleted) {
         let path: string | null = null;
         try {
            path = decodeURIComponent(deleted[1]);
         } catch {
            /* not a name bknd accepted either */
         }
         if (path) c.executionCtx.waitUntil(deleteVariants(c.env, path).catch((e) => console.error("variant cleanup failed", String(e))));
      }
      return res;
   });

   app.all("*", (c) => renderStatus(c, "not_found", 404));

   app.onError((err, c) => {
      console.error("unhandled", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/picker/api/") || c.req.path.startsWith("/admin/api/")) {
         return c.json({ error: "internal_error" }, 500);
      }
      return renderStatus(c, "error", 500);
   });

   return app;
}

const worker = createWorker({
   fetch: (input, init) => fetch(input, init),
   jwks: remoteJwks,
   getApp: (c) => getBkndApp(c.env, c.executionCtx as ExecutionContext, c.req.raw, c.get("cfg")),
});

export default {
   fetch: (request: Request, env: Env, ctx: ExecutionContext) => worker.fetch(request, env, ctx),
   // Cron (wrangler.jsonc triggers): refresh curated snapshots so www renders without per-item calls.
   scheduled: async (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
      ctx.waitUntil(
         refreshCuratedSnapshots(env.DB, env.VIDEOS_API_URL.replace(/\/+$/, "")).then(
            (r) => console.log(JSON.stringify({ msg: "curated snapshots refreshed", ...r })),
            (error) => console.error("curated snapshot refresh failed", String(error)),
         ),
      );
      // Image variants: backfill originals without variants, resend lost jobs, drop orphans (CMS-10).
      ctx.waitUntil(
         sweepVariants(env).then(
            (r) => console.log(JSON.stringify({ msg: "image variants swept", ...r })),
            (error) => console.error("image variant sweep failed", String(error)),
         ),
      );
   },
   // Image variant jobs (wrangler.jsonc queues.consumers).
   queue: (batch: MessageBatch, env: Env) => consumeVariants(batch as MessageBatch<VariantMessage>, env),
} satisfies ExportedHandler<Env>;
