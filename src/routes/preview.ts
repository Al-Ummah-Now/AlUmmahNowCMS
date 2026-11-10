/**
 * Draft preview on www (docs/PUBLIC_API.md "Preview API"):
 *
 *   GET /preview/:kind/:id          staff (session gate + role): mint a token for this one row,
 *                                   303 → {WWW_URL}/preview?token=…  (the editor's "Preview on site")
 *   GET /api/preview/v1/:kind/:id   www, server-side: `Authorization: Bearer <token>` → the row as
 *                                   the public Page/Post shape, whatever its status. Never cached.
 *
 * The public API (/api/public/v1) is untouched: it still serves published rows only.
 */
import { Hono, type Context } from "hono";
import { ConfigError, runtimeConfig, type Env } from "../env.ts";
import { bearer, isPreviewKind, mintPreviewToken, verifyPreviewToken, type PreviewKind } from "../lib/preview.ts";
import type { AppEnv } from "../types.ts";
import { pageOf, postOf, toIso } from "./public-api.ts";
import { renderStatus } from "./sso.ts";

type Row = Record<string, unknown>;

const PRIVATE_JSON = {
   "Cache-Control": "private, no-store",
   "X-Robots-Tag": "noindex, nofollow",
   "X-Content-Type-Options": "nosniff",
   "Referrer-Policy": "no-referrer",
};

function fail(c: Context<{ Bindings: Env }>, status: 401 | 404 | 503, error: string) {
   return c.json({ error }, status, PRIVATE_JSON);
}

const rowOf = (env: Env, kind: PreviewKind, id: number) => env.DB.prepare(`SELECT * FROM ${kind} WHERE id = ?1 LIMIT 1`).bind(id).first<Row>();

/** Mounted at /api/preview/v1, before the runtime-config middleware (like the public API). */
export function previewApi(): Hono<{ Bindings: Env }> {
   const api = new Hono<{ Bindings: Env }>();

   api.get("/:kind/:id{[0-9]{1,15}}", async (c) => {
      const kind = c.req.param("kind");
      if (!isPreviewKind(kind)) return fail(c, 404, "not_found");
      let secret: string;
      try {
         secret = runtimeConfig(c.env).jwtSecret;
      } catch (error) {
         if (!(error instanceof ConfigError)) throw error;
         return fail(c, 503, "unavailable");
      }
      const verdict = await verifyPreviewToken(secret, bearer(c.req.header("Authorization")));
      if (!verdict.ok) return fail(c, 401, verdict.reason === "expired" ? "expired_token" : "invalid_token");
      const id = Number(c.req.param("id"));
      // Bound to one row: a token for another row (or kind) is no token at all.
      if (verdict.claims.k !== kind || verdict.claims.id !== id) return fail(c, 401, "invalid_token");
      const row = await rowOf(c.env, kind, id);
      if (!row) return fail(c, 404, "not_found");
      const publicUrl = c.env.PUBLIC_URL.replace(/\/+$/, "");
      return c.json(
         {
            kind: kind === "pages" ? "page" : "post",
            id,
            status: row.status === "published" ? "published" : "draft",
            expires_at: toIso(verdict.claims.exp * 1000),
            edit_url: `${publicUrl}/${kind}/${id}`,
            content: kind === "pages" ? await pageOf(c.env, row) : await postOf(c.env, row),
         },
         200,
         PRIVATE_JSON,
      );
   });

   api.all("*", (c) => fail(c, 404, "not_found"));
   api.onError((err, c) => {
      console.error("preview api error", err instanceof Error ? err.message : String(err));
      return c.json({ error: "internal_error" }, 500, PRIVATE_JSON);
   });
   return api;
}

/** Mounted at /preview behind the staff session gate (src/index.ts). */
export function previewRoutes(): Hono<AppEnv> {
   const r = new Hono<AppEnv>();
   r.get("/:kind/:id{[0-9]{1,15}}", async (c) => {
      const kind = c.req.param("kind");
      const role = c.get("user")?.role;
      if (role !== "admin" && role !== "editor") return renderStatus(c, "no_access", 403);
      if (!isPreviewKind(kind)) return renderStatus(c, "not_found", 404);
      const id = Number(c.req.param("id"));
      const row = await c.env.DB.prepare(`SELECT id FROM ${kind} WHERE id = ?1 LIMIT 1`).bind(id).first();
      if (!row) return renderStatus(c, "not_found", 404);
      const cfg = c.get("cfg");
      const { token } = await mintPreviewToken(cfg.jwtSecret, kind, id);
      return new Response(null, {
         status: 303,
         headers: { Location: `${cfg.wwwUrl}/preview?token=${encodeURIComponent(token)}`, "Referrer-Policy": "no-referrer" },
      });
   });
   r.all("*", (c) => renderStatus(c, "not_found", 404));
   return r;
}
