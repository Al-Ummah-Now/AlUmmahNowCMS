/**
 * Worker endpoints the staff screens need beyond bknd's API (docs/ADMIN_UI_SPEC.md §0).
 *   PATCH /admin/api/media/:id/alt  { alt }  → media.metadata.alt only (editors may not update media)
 *   POST  /admin/api/media/variants/retry  { path }  → queue an original's image variants again (CMS-10)
 *   POST  /admin/api/revisions/:id/restore  { updated_at }  → a page/post back to that revision (#8)
 */
import { Hono } from "hono";
import { retryVariants } from "../lib/variants/jobs.ts";
import { getRevision, RESTORABLE, withActor } from "../lib/revisions.ts";
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

   /**
    * Restore = an ordinary update of the restorable fields (RESTORABLE), carrying the editor's
    * `updated_at`: the same optimistic lock as a save (409 if someone saved since), the same content
    * rules, and the revisions plugin records it as a restore. Errors are codes, never raw messages.
    */
   r.post("/revisions/:id{[0-9]+}/restore", async (c) => {
      const user = c.get("user");
      if (user?.role !== "admin" && user?.role !== "editor") return c.json({ error: "forbidden" }, 403);
      if (!(c.req.header("content-type") ?? "").includes("application/json")) return c.json({ error: "bad_request" }, 415);
      const body = (await c.req.json().catch(() => null)) as { updated_at?: unknown } | null;
      if (!body || typeof body.updated_at !== "string" || !body.updated_at) return c.json({ error: "bad_request" }, 400);
      const rev = await getRevision(c.env.DB, Number(c.req.param("id")));
      if (!rev) return c.json({ error: "not_found" }, 404);
      const data: Record<string, unknown> = { updated_at: body.updated_at };
      for (const k of RESTORABLE[rev.entity]) {
         if (!(k in rev.snapshot)) continue;
         let v = rev.snapshot[k];
         if (k === "tags" && typeof v === "string") {
            try {
               v = JSON.parse(v);
            } catch {
               v = [];
            }
         }
         if (k === "show_in_sitemap") v = v === null || v === undefined ? true : v === true || v === 1 || v === "1" || v === "true";
         data[k] = v;
      }
      const app = await deps.getApp(c);
      const { data: current } = await app.em.repo(rev.entity).findId(rev.entity_id);
      if (!current) return c.json({ error: "not_found" }, 404);
      try {
         const res = await withActor({ id: user.id, email: user.email, restoredFrom: rev.id }, () => app.em.mutator(rev.entity).updateOne(rev.entity_id, data as never));
         const row = res.data as { id: number; updated_at?: unknown };
         return c.json({ data: { id: row.id, updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : (row.updated_at ?? null) } });
      } catch (error) {
         const name = error instanceof Error ? error.name : "";
         const text = String(error);
         if (name === "StaleWriteError") return c.json({ error: "conflict" }, 409);
         if (/UNIQUE/i.test(text)) return c.json({ error: "slug_taken" }, 409);
         if (name === "ContentRuleError") return c.json({ error: "invalid" }, 400);
         console.error("restore failed", rev.id, text);
         return c.json({ error: "internal_error" }, 500);
      }
   });
   return r;
}
