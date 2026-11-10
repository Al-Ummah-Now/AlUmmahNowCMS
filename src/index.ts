/**
 * cms.alummahnow.net Worker: a Hono wrapper around bknd (code mode) — SPEC §3–§7.
 *
 *   /healthz                 liveness (+ ?deep=1: config and D1)
 *   /api/public/v1/*         public read API (published rows only), CORS for www
 *   /api/preview/v1/*        draft preview for www (one row per signed, expiring token; no CORS)
 *   /preview/:kind/:id       staff: mint a preview token, 303 → www/preview (session required)
 *   /sso/*                   SSO login/callback/logout (PKCE public client)
 *   /admin-assets/*          staff screens' CSS/JS (public, immutable, no data)
 *   /favicon.*, /icon-*, …   tab and app icons (public, no data)
 *   /, /pages, /posts, …     staff screens (src/admin; session required, else → /sso/login)
 *   /admin/api/*, /picker/api/*  Worker endpoints the screens need (session, same-origin)
 *   /api/*                   bknd API (guard on; same-origin check on mutations)
 *   /data/*, /media, /bknd   bknd's retired admin UI → redirects to the staff screens
 */
import { Hono } from "hono";
import { appIconRoutes } from "./lib/app-icons.ts";
import { getBkndApp, MediaExistsError } from "./app.ts";
import { MEDIA_MAX_BYTES } from "./bknd-config.ts";
import { ALLOWED_UPLOAD, blockedApiPath, contentCollectionPath, deleteTarget, isRetiredBkndAdminPath, uploadAllowed, uploadName } from "./lib/paths.ts";
import { ConfigError, runtimeConfig, trimSlash, type Env } from "./env.ts";
import { remoteJwks } from "./lib/oidc.ts";
import { refreshCuratedSnapshots } from "./lib/snapshots.ts";
import { consumeVariants, sweepVariants, type VariantMessage } from "./lib/variants/jobs.ts";
import { VARIANT_ROOT } from "./lib/variants/plan.ts";
import { withActor } from "./lib/revisions.ts";
import { slugConflictOf } from "./lib/content-rules.ts";
import { runSnapshotQueue } from "./lib/video-snapshots.ts";
import { collectGarbage, consumeFeed, consumeFeedDlq, duePosts, verifyFeed, videoChanged, type FeedMessage } from "./lib/feed/jobs.ts";
import { isFeedDlq, isFeedQueue } from "./lib/feed/queues.ts";
import { pruneJobs } from "./lib/ai/jobs.ts";
import { handleAiQueue, isAiQueue } from "./lib/ai/runner.ts";
import { ACCOUNT_PAGES } from "./lib/pages.ts";
import { adminAssets, adminRoutes, isStaffScreen } from "./admin/routes.tsx";
import { legacyAdminRedirect } from "./admin/legacy.ts";
import { entityUploadTarget, keepNewestMedia, trashForReplace, undoReplace } from "./admin/media-cleanup.ts";
import { handleDelete } from "./admin/trash-api.ts";
import { purgeDue } from "./lib/trash.ts";
import { syncCommunity } from "./lib/scholars/community.ts";
import { errText, log } from "./lib/log.ts";
import { isCmsRole } from "./lib/roles.ts";
import { postAuthor, scopeListUrl, scopeWhere, subOfUser, writerApiVerdict } from "./lib/scholars/ownership.ts";
import { writerScreenAllowed } from "./lib/scholars/access.ts";
import { applyPrivateHeaders, contentSecurityPolicy, nonce, sameOriginOk } from "./lib/security.ts";
import { pickerRoutes } from "./routes/picker.ts";
import { previewApi, previewRoutes } from "./routes/preview.ts";
import { publicApi } from "./routes/public-api.ts";
import { renderStatus, ssoRoutes } from "./routes/sso.ts";
import { endedBySignOut } from "./lib/sign-outs.ts";
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
   if (!user || !isCmsRole(user.role)) return undefined;
   // Single sign-out: a session issued before the account signed out is over (copied cookies too)
   if (await endedBySignOut(c.env.DB, user.id, user.iat)) return undefined;
   return user;
}

/**
 * A writer's bknd API call, scoped to their own posts (src/lib/scholars/ownership.ts). Returns the
 * request to forward, or a response that ends it (403 for anything a writer may not use, 404 for a
 * post that is not theirs, so other scholars' post ids are not even confirmed).
 */
async function scopeWriterRequest(c: Ctx, user: AuthUser): Promise<Request | Response> {
   const verdict = writerApiVerdict(c.req.method, c.req.path);
   if (verdict.kind === "allow" || verdict.kind === "create-post") return c.req.raw;
   if (verdict.kind === "deny") return c.json({ error: "forbidden" }, 403);
   const sub = await subOfUser(c.env.DB, user.id);
   if (!sub) return c.json({ error: "forbidden" }, 403);
   if (verdict.kind === "scope-list") return new Request(scopeListUrl(new URL(c.req.url), sub), c.req.raw);
   if (verdict.kind === "scope-count") {
      const text = c.req.method === "POST" ? await c.req.raw.clone().text() : "";
      let where: Record<string, unknown> = {};
      try {
         const parsed = text ? (JSON.parse(text) as unknown) : {};
         if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) where = parsed as Record<string, unknown>;
      } catch {
         where = {};
      }
      const headers = new Headers(c.req.raw.headers);
      headers.set("content-type", "application/json");
      headers.delete("content-length");
      return new Request(c.req.url, { method: "POST", headers, body: JSON.stringify(scopeWhere(where, sub)) });
   }
   const owner = await postAuthor(c.env.DB, verdict.id);
   if (owner !== sub) return c.json({ error: "not_found" }, 404);
   return c.req.raw;
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
   // Tab and app icons (src/lib/app-icons.ts): public, no data, served before any session check.
   app.route("/", appIconRoutes() as unknown as Hono<AppEnv>);

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
      if (user.role === "writer" && !writerScreenAllowed(c.req.method, p)) {
         if (p.startsWith("/picker/api/") || p.startsWith("/admin/api/")) return c.json({ error: "forbidden" }, 403);
         if (p === "/scholars") return c.redirect("/scholars/me", 302);
         return renderStatus(c, "no_access", 403);
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
      const signedIn = await sessionUser(c, deps);
      // A writer (auth "Scholar") reaches only their own posts and media (docs/SCHOLARS.md §2).
      let writerRequest: Request | null = null;
      if (signedIn?.role === "writer") {
         const scoped = await scopeWriterRequest(c, signedIn);
         if (scoped instanceof Response) return scoped;
         writerRequest = scoped;
      }
      // Every bknd delete route is a soft delete (docs/SOFT_DELETE.md): answered here, never by bknd.
      const del = deleteTarget(c.req.method, p);
      if (del) return handleDelete(c, signedIn, del);
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
      const actor = c.req.method === "GET" || c.req.method === "HEAD" ? undefined : signedIn;
      const who = { id: actor?.id ?? null, email: actor?.email ?? null, role: actor?.role };
      const write = c.req.method === "POST" || c.req.method === "PATCH" || c.req.method === "PUT";
      const sent = write && p.startsWith("/api/data/entity/") ? await c.req.raw.clone().text() : null;
      const target = c.req.method === "POST" ? entityUploadTarget(p) : null;
      let request = writerRequest ?? c.req.raw;
      let replaced: number[] = [];
      if (target && new URL(c.req.url).searchParams.get("overwrite") === "true" && actor) {
         // Replace = the old file goes to the trash (soft), and bknd gets a plain upload (no hard delete).
         replaced = await trashForReplace(bknd, c.env, target, who);
         const url = new URL(c.req.url);
         url.searchParams.delete("overwrite");
         request = new Request(url, c.req.raw);
      }
      const res = await withActor(who, () => bknd.fetch(request, c.env, c.executionCtx));
      if (replaced.length && !res.ok) await undoReplace(c.env, replaced, who);
      if (res.status === 500 && sent !== null) {
         // A (slug, locale) clash that raced past the content rules reaches D1's UNIQUE index as a 500 (#50).
         const conflict = await slugConflictOf(c.env.DB, c.req.method, p, sent).catch(() => null);
         if (conflict) return c.json({ error: conflict.message, type: conflict.name }, 409);
      }
      if (target && res.ok) await keepNewestMedia(bknd, c.env, target, who);
      if (res.ok && write && p.startsWith("/api/data/entity/posts")) {
         // A scholar post's community post follows at once (the minute cron retries a failure).
         c.executionCtx.waitUntil(syncCommunity(c.env, { fetch: deps.fetch }).catch((e) => log.warn("community sync after save failed", { error: errText(e) })));
      }
      if (res.ok && c.req.method === "POST" && (p.startsWith("/api/media/upload") || target)) {
         // Image variants for the new original (CMS-10): queue it now instead of waiting for the cron.
         c.executionCtx.waitUntil(sweepVariants(c.env, 5).catch((e) => console.error("variant enqueue failed", String(e))));
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
   // Cron (wrangler.jsonc triggers). Every minute: scheduled posts going live onto the home timeline.
   // Every 30 minutes: snapshot refreshes, image variants, the feed verifier and its garbage, the
   // soft-delete cleanup (purges admin-deleted items after 30 days, or at once when an admin asked).
   scheduled: async (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
      if (event.cron === "* * * * *") {
         ctx.waitUntil(duePosts(env).catch((error) => console.error("feed due check failed", String(error))));
         // Scholar articles ↔ their channel's community posts: due syncs and retries (docs/SCHOLARS.md §4).
         ctx.waitUntil(syncCommunity(env).catch((error) => log.error("community sync failed", { error: errText(error) })));
         return;
      }
      ctx.waitUntil(
         refreshCuratedSnapshots(env.DB, trimSlash(env.VIDEOS_API_URL)).then(
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
      // Block and timeline video snapshots: a retrying queue in D1; dead-lettered rows are flagged on
      // the Overview. A snapshot that changed marks the timeline items showing it dirty.
      ctx.waitUntil(
         runSnapshotQueue(env.DB, trimSlash(env.VIDEOS_API_URL), fetch, { onChange: (kind, ref) => videoChanged(env, kind, ref) }).then(
            (r) => console.log(JSON.stringify({ msg: "block video snapshots", ...r })),
            (error) => console.error("block video snapshot queue failed", String(error)),
         ),
      );
      // Home timeline safety net: repair only the KV buckets that drifted from D1; drop old keys.
      ctx.waitUntil(
         verifyFeed(env)
            .then((r) => console.log(JSON.stringify({ msg: "feed verified", ...r })))
            .then(() => collectGarbage(env))
            .catch((error) => console.error("feed verify failed", String(error))),
      );
      // Soft-deleted items: purge those deleted 30+ days ago or queued by an admin (docs/SOFT_DELETE.md).
      // The only hard delete there is; bounded per run, failures retried on the next run.
      ctx.waitUntil(purgeDue(env).catch((error) => log.error("trash purge failed", { error: errText(error) })));
      // AI job rows hold draft text: 30-day retention (docs/AI_ASSIST_SPEC.md §3).
      ctx.waitUntil(pruneJobs(env.DB, Date.now()).catch((error) => console.error("ai job prune failed", String(error))));
   },
   // One queue() for every consumer in wrangler.jsonc: home timeline builds and their DLQ, AI assist
   // jobs and their DLQ (docs/AI_ASSIST_SPEC.md §3), otherwise image variant jobs (CMS-10).
   queue: (batch: MessageBatch, env: Env) =>
      isFeedQueue(batch.queue)
         ? consumeFeed(batch as MessageBatch<FeedMessage>, env)
         : isFeedDlq(batch.queue)
           ? consumeFeedDlq(batch, env)
           : isAiQueue(batch.queue)
             ? handleAiQueue(batch as MessageBatch<{ jobId: string }>, env)
             : consumeVariants(batch as MessageBatch<VariantMessage>, env),
} satisfies ExportedHandler<Env>;
