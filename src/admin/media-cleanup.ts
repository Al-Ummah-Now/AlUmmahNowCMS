/**
 * bknd 0.21 limitation (found building the cover editor): `POST /api/media/entity/:e/:id/:field?overwrite=true`
 * inserts the new media row and deletes the old file from R2, but leaves the old media ROW. The
 * public API reads the first `<entity>.<field>` row, so www would keep pointing at a deleted file.
 * After a successful single-file upload the Worker keeps only the newest row (and its file).
 */
import type { App } from "bknd";

const ENTITY_UPLOAD = /^\/api\/media\/entity\/([a-z_]+)\/([^/]+)\/([a-z_]+)$/;

export function entityUploadTarget(path: string): { entity: string; id: string; field: string } | null {
   const m = ENTITY_UPLOAD.exec(path);
   return m ? { entity: m[1], id: decodeURIComponent(m[2]), field: m[3] } : null;
}

export async function keepNewestMedia(
   app: App,
   bucket: R2Bucket,
   target: { entity: string; id: string; field: string },
   onDeleted?: (path: string) => Promise<void>,
): Promise<number> {
   const field = app.em.entity(target.entity)?.field(target.field) as { getMaxItems?: () => number | undefined } | undefined;
   const max = field?.getMaxItems?.();
   if (!max) return 0;
   const { data } = await app.em.repo("media").findMany({
      where: { reference: `${target.entity}.${target.field}`, entity_id: target.id },
      sort: { by: "id", dir: "desc" },
      select: ["id", "path"],
      limit: 100,
   });
   const stale = (data as { id: number; path: string }[]).slice(max);
   if (!stale.length) return 0;
   const mutator = app.em.mutator("media") as unknown as {
      __unstable_toggleSystemEntityCreation?: (on: boolean) => void;
      deleteOne: (id: number) => Promise<unknown>;
   };
   mutator.__unstable_toggleSystemEntityCreation?.(false);
   try {
      for (const row of stale) {
         await bucket.delete(row.path);
         await mutator.deleteOne(row.id);
         await onDeleted?.(row.path);
      }
   } finally {
      mutator.__unstable_toggleSystemEntityCreation?.(true);
   }
   return stale.length;
}
