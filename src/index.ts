/**
 * cms.alummahnow.net Worker: a Hono wrapper around bknd (code mode) — SPEC §3–§7.
 *
 *   /healthz                 liveness (+ ?deep=1: config and D1)
 *   /api/public/v1/*         public read API (published rows only), CORS for www
 *   /sso/*                   SSO login/callback/logout (PKCE public client)
 *   /picker, /picker/api/*   video picker (session required)
 *   /, /data/*, /media/*, …  bknd admin UI (session required, else → /sso/login)
 *   /api/*                   bknd API (guard on; same-origin check on mutations)
 */
import { Hono } from "hono";
import { getBkndApp } from "./app.ts";
import { MEDIA_MAX_BYTES } from "./bknd-config.ts";
import { ALLOWED_UPLOAD, blockedApiPath, isAdminUiPath, uploadAllowed } from "./lib/paths.ts";
import { ConfigError, runtimeConfig, type Env } from "./env.ts";
import { remoteJwks } from "./lib/oidc.ts";
import { applyPrivateHeaders, contentSecurityPolicy, nonce, sameOriginOk } from "./lib/security.ts";
import { pickerRoutes } from "./routes/picker.ts";
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

const PICKER_LINK = `<a href="/picker" style="position:fixed;inset-block-end:1rem;inset-inline-end:1rem;z-index:2147483647;background:#0b5394;color:#fff;padding:.6rem 1rem;border-radius:.5rem;font:600 14px/1.2 system-ui,sans-serif;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.25)">Video picker · منتقي الفيديو</a>`;

/** Adds the per-response CSP nonce to bknd's inline bootstrap script and a fixed "Video picker" link. */
function decorateAdminHtml(res: Response, n: string): Response {
   return new HTMLRewriter()
      .on("script", {
         element(el) {
            el.setAttribute("nonce", n);
         },
      })
      .on("body", {
         element(el) {
            el.append(PICKER_LINK, { html: true });
         },
      })
      .transform(res);
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
      const isPicker = c.req.path === "/picker" || c.req.path.startsWith("/picker/");
      const csp = contentSecurityPolicy({ nonce: n, frameSrc: isPicker ? [c.get("cfg").videosWebUrl] : undefined });
      c.res = withHeaders(c.res, csp, new URL(c.get("cfg").publicUrl).origin);
   });

   app.route("/sso", ssoRoutes(deps));

   // bknd's own login/register/logout UI and endpoints → SSO, or gone.
   app.get("/auth/login", (c) => c.redirect(`/sso/login?return=${encodeURIComponent(c.req.query("return") ?? "/")}`, 302));
   app.all("/auth/register", (c) => renderStatus(c, "not_found", 404));
   app.all("/auth/logout", (c) => c.redirect("/sso/logout", 302));
   app.all("/api/auth/logout", (c) => c.redirect("/sso/logout", 302));

   // Session gate for the admin UI and the picker.
   app.use("*", async (c, next) => {
      const p = c.req.path;
      const gated = isAdminUiPath(p) || p === "/picker" || p.startsWith("/picker/");
      if (!gated) return next();
      const user = await sessionUser(c, deps);
      if (!user) {
         if (p.startsWith("/picker/api/")) return c.json({ error: "unauthorized" }, 401);
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
      if ((p.startsWith("/api/") || p.startsWith("/picker/api/")) && !sameOriginOk(c.req.raw, c.get("cfg").publicUrl)) {
         return c.json({ error: "forbidden", message: "cross-origin request rejected" }, 403);
      }
      return next();
   });

   app.route("/picker", pickerRoutes(deps));

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
      const bknd = await deps.getApp(c);
      return bknd.fetch(c.req.raw, c.env, c.executionCtx);
   });

   app.get("*", async (c) => {
      if (!isAdminUiPath(c.req.path)) return renderStatus(c, "not_found", 404);
      const bknd = await deps.getApp(c);
      const res = await bknd.fetch(c.req.raw, c.env, c.executionCtx);
      const type = res.headers.get("content-type") ?? "";
      return type.includes("text/html") ? decorateAdminHtml(res, c.get("nonce")) : res;
   });

   app.all("*", (c) => renderStatus(c, "not_found", 404));

   app.onError((err, c) => {
      console.error("unhandled", err instanceof Error ? `${err.name}: ${err.message}` : String(err));
      if (c.req.path.startsWith("/api/") || c.req.path.startsWith("/picker/api/")) {
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
} satisfies ExportedHandler<Env>;
