/**
 * Cover replacement (`POST /api/media/entity/:e/:id/:field?overwrite=true`) without a hard delete.
 *
 * bknd 0.21's overwrite inserts the new media row and deletes the old FILE from R2 itself, but
 * leaves the old ROW (the public API reads the first `<entity>.<field>` row, so www would keep
 * pointing at a deleted file). Admin deletes are soft (docs/SOFT_DELETE.md), so the Worker does it
 * instead: before the upload, the rows that would be replaced move to the trash (restorable, file
 * kept), and bknd gets the upload without `overwrite`, so it deletes nothing. If the upload fails
 * they are restored. After a successful upload, any surplus rows (a race) go to the trash too.
 */
import type { App } from "bknd";
import type { Env } from "../env.ts";
import { restore, softDelete, type TrashActor } from "../lib/trash.ts";

const ENTITY_UPLOAD = /^\/api\/media\/entity\/([a-z_]+)\/([^/]+)\/([a-z_]+)$/;
export const REPLACED_REASON = "replaced";

export function entityUploadTarget(path: string): { entity: string; id: string; field: string } | null {
   const m = ENTITY_UPLOAD.exec(path);
   return m ? { entity: m[1], id: decodeURIComponent(m[2]), field: m[3] } : null;
}

type Target = { entity: string; id: string; field: string };

function maxItems(app: App, target: Target): number | undefined {
   const field = app.em.entity(target.entity)?.field(target.field) as { getMaxItems?: () => number | undefined } | undefined;
   return field?.getMaxItems?.();
}

async function slotRows(env: Env, target: Target): Promise<{ id: number }[]> {
   const { results } = await env.DB.prepare("SELECT id FROM media WHERE reference = ?1 AND entity_id = ?2 ORDER BY id DESC LIMIT 100")
      .bind(`${target.entity}.${target.field}`, target.id)
      .all<{ id: number }>();
   return results;
}

/**
 * Makes room for one more file in a limited field: the oldest rows beyond `max - 1` go to the
 * trash. Returns their trash ids (to undo with `undoReplace` when the upload fails).
 */
export async function trashForReplace(app: App, env: Env, target: Target, actor: TrashActor): Promise<number[]> {
   const max = maxItems(app, target);
   if (!max) return [];
   const rows = await slotRows(env, target);
   const out: number[] = [];
   for (const row of rows.slice(max - 1)) out.push(await softDelete(env, "media", Number(row.id), actor, REPLACED_REASON));
   return out;
}

export async function undoReplace(env: Env, trashIds: number[], actor: TrashActor): Promise<void> {
   for (const id of trashIds) await restore(env, id, actor);
}

/** After an upload: rows beyond the field's limit (oldest first) go to the trash. */
export async function keepNewestMedia(app: App, env: Env, target: Target, actor: TrashActor): Promise<number> {
   const max = maxItems(app, target);
   if (!max) return 0;
   const stale = (await slotRows(env, target)).slice(max);
   for (const row of stale) await softDelete(env, "media", Number(row.id), actor, REPLACED_REASON);
   return stale.length;
}
