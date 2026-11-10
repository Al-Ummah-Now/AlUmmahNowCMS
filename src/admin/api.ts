/**
 * Worker endpoints the staff screens need beyond bknd's API (docs/ADMIN_UI_SPEC.md §0).
 *   PATCH /admin/api/media/:id/alt  { alt }  → media.metadata.alt only (editors may not update media)
 *   POST  /admin/api/media/variants/retry  { path }  → queue an original's image variants again (CMS-10)
 */
import { Hono } from "hono";
import { retryVariants } from "../lib/variants/jobs.ts";
import type { AppEnv, Deps } from "../types.ts";

export const ALT_MAX = 300;

export function mediaAltRoute(deps: Deps): Hono<AppEnv> {
   const r = new Hono<AppEnv>();
   r.patch("/media/:id{[0-9]+}/alt", async (c) => {
      const role = c.get("user")?.role;
      if (role !== "admin" && role !== "editor") return c.json({ error: "forbidden" }, 403);
      if (!(c.req.header("content-type") ?? "").includes("application/json")) return c.json({ error: "bad_request", message: "JSON body required" }, 415);
      const body = (await c.req.json().catch(() => null)) as { alt?: unknown } | null;
      if (!body || typeof body.alt !== "string" || body.alt.length > ALT_MAX) {
         return c.json({ error: "bad_request", message: `alt must be a string of at most ${ALT_MAX} characters` }, 400);
      }
      const alt = body.alt.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
      const app = await deps.getApp(c);
      const id = Number(c.req.param("id"));
      const { data: row } = await app.em.repo("media").findId(id);
      if (!row) return c.json({ error: "not_found" }, 404);
      const raw = (row as { metadata?: unknown }).metadata;
      let meta: Record<string, unknown> = {};
      if (raw && typeof raw === "object") meta = { ...(raw as Record<string, unknown>) };
      else if (typeof raw === "string") {
         try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") meta = parsed;
         } catch {
            /* replace unreadable metadata */
         }
      }
      if (alt) meta.alt = alt;
      else delete meta.alt;
      const mutator = app.em.mutator("media");
      // bknd guards system entities against direct writes; the toggle is bknd's own escape hatch (MediaController uses it).
      const m = mutator as unknown as { __unstable_toggleSystemEntityCreation?: (on: boolean) => void };
      m.__unstable_toggleSystemEntityCreation?.(false);
      try {
         await mutator.updateOne(id, { metadata: meta } as never);
      } finally {
         m.__unstable_toggleSystemEntityCreation?.(true);
      }
      return c.json({ data: { id, alt: alt || null } });
   });
   r.post("/media/variants/retry", async (c) => {
      const role = c.get("user")?.role;
      if (role !== "admin" && role !== "editor") return c.json({ error: "forbidden" }, 403);
      const body = (await c.req.json().catch(() => null)) as { path?: unknown } | null;
      if (!body || typeof body.path !== "string" || !body.path || body.path.length > 512) return c.json({ error: "bad_request", message: "path required" }, 400);
      if (!c.env.VARIANTS) return c.json({ error: "unavailable", message: "image processing is not configured" }, 503);
      if (!(await retryVariants(c.env, body.path))) return c.json({ error: "not_found" }, 404);
      return c.json({ data: { path: body.path, status: "queued" } });
   });
   return r;
}
