/**
 * Soft delete endpoints (docs/SOFT_DELETE.md). Admins only.
 *
 *   DELETE /api/data/entity/:entity/:id  { reason? }   bknd's route, answered here: row → trash
 *   DELETE /api/media/file/:name         { reason? }   bknd's route, answered here: media row → trash
 *   DELETE /api/data/entity/:entity                    bknd's bulk delete: refused (405)
 *   GET    /admin/api/trash?kind=&page=                Recently deleted (JSON)
 *   POST   /admin/api/trash/:id/restore                put it back (and republish it)
 *   POST   /admin/api/trash/:id/purge  { confirm }     "Delete permanently now": queued for the cleanup
 *
 * The delete routes keep bknd's paths so every existing caller (staff screens, scripts) is soft
 * without a change. Nothing here hard-deletes: only the cleanup does (src/lib/trash.ts purgeDue).
 */
import { Hono, type Context } from "hono";
import { DATA_DELETABLE, type DeleteTarget } from "../lib/paths.ts";
import { errText, log } from "../lib/log.ts";
import { isTrashKind, listTrash, requestPurge, restore, softDelete, softDeleteMedia, TrashError, type TrashActor } from "../lib/trash.ts";
import type { AppEnv, AuthUser } from "../types.ts";

/** What the type-to-confirm dialog sends with a purge request. */
export const PURGE_CONFIRM = "purge";
export const TRASH_PAGE_SIZE = 50;

const actorOf = (u: AuthUser): TrashActor => ({ id: u.id ?? null, email: u.email ?? null });

function fail(c: Context<AppEnv>, error: unknown) {
   if (error instanceof TrashError) return c.json({ error: error.code }, error.status);
   log.error("trash api failed", { path: c.req.path, error: errText(error) });
   return c.json({ error: "internal_error" }, 500);
}

async function reasonOf(req: Request): Promise<unknown> {
   if ((req.headers.get("content-type") ?? "").includes("application/json")) {
      const body = (await req.clone().json().catch(() => null)) as { reason?: unknown } | null;
      if (body && typeof body === "object") return body.reason;
   }
   return new URL(req.url).searchParams.get("reason");
}

/** bknd's delete routes, answered with a soft delete. `user` is the signed-in staff member, if any. */
export async function handleDelete(c: Context<AppEnv>, user: AuthUser | undefined, target: DeleteTarget): Promise<Response> {
   if (!user) return c.json({ error: "unauthorized" }, 401);
   // A writer deletes their own posts (the wrapper already checked ownership, src/index.ts); restoring
   // them is an admin's job on Recently deleted, as for everything else.
   const writerOwnPost = user.role === "writer" && target.type === "row" && target.entity === "posts";
   if (user.role !== "admin" && !writerOwnPost) return c.json({ error: "forbidden" }, 403);
   if (target.type === "bulk") return c.json({ error: "method_not_allowed", message: "Delete one item at a time" }, 405);
   const reason = await reasonOf(c.req.raw);
   try {
      if (target.type === "file") {
         if (!target.path) return c.json({ error: "not_found" }, 404);
         const trashId = await softDeleteMedia(c.env, target.path, actorOf(user), reason);
         return c.json({ data: { path: target.path, trash_id: trashId, deleted: "soft" } });
      }
      if (!(DATA_DELETABLE as readonly string[]).includes(target.entity)) return c.json({ error: "method_not_allowed", message: "This item can't be deleted" }, 405);
      const id = Number(target.id);
      if (!Number.isInteger(id) || id <= 0 || !isTrashKind(target.entity)) return c.json({ error: "not_found" }, 404);
      const trashId = await softDelete(c.env, target.entity, id, actorOf(user), reason);
      return c.json({ data: { id, trash_id: trashId, deleted: "soft" } });
   } catch (error) {
      return fail(c, error);
   }
}

export function trashApi(): Hono<AppEnv> {
   const r = new Hono<AppEnv>();
   r.use("*", async (c, next) => (c.get("user")?.role === "admin" ? next() : c.json({ error: "forbidden" }, 403)));

   r.get("/", async (c) => {
      const kind = c.req.query("kind");
      const page = Math.min(Math.max(Number.parseInt(c.req.query("page") ?? "1", 10) || 1, 1), 10_000);
      const res = await listTrash(c.env.DB, { kind: isTrashKind(kind) ? kind : null, limit: TRASH_PAGE_SIZE, offset: (page - 1) * TRASH_PAGE_SIZE });
      return c.json({ data: res.items, meta: { total: res.total, page } });
   });

   r.post("/:id{[0-9]+}/restore", async (c) => {
      try {
         return c.json({ data: await restore(c.env, Number(c.req.param("id")), actorOf(c.get("user"))) });
      } catch (error) {
         return fail(c, error);
      }
   });

   r.post("/:id{[0-9]+}/purge", async (c) => {
      const body = (await c.req.json().catch(() => null)) as { confirm?: unknown } | null;
      if (body?.confirm !== PURGE_CONFIRM) return c.json({ error: "confirmation_required" }, 400);
      try {
         const t = await requestPurge(c.env, Number(c.req.param("id")), actorOf(c.get("user")));
         return c.json({ data: { id: t.id, purge_requested_at: t.purge_requested_at } }, 202);
      } catch (error) {
         return fail(c, error);
      }
   });

   return r;
}
