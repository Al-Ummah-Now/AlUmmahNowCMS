/**
 * bknd plugin: every insert, update (publish, unpublish, edit, schedule, restore — CMS #7/#8, the
 * "Show on home timeline" toggle) and delete of a post marks it dirty for the home timeline build
 * (src/lib/feed/jobs.ts). markDirty never throws: the save itself is already committed.
 */
import { DatabaseEvents, type AppPlugin } from "bknd";
import type { Env } from "../../env.ts";
import { markDirty } from "./jobs.ts";

export function feedPlugin(env?: Env): AppPlugin {
   return (app) => ({
      name: "aun-feed",
      onBuilt: async () => {
         if (!env?.DB) return;
         const touch = async (event: { params: unknown }, why: string) => {
            const { entity, data } = event.params as { entity: { name: string }; data: unknown };
            if (entity.name !== "posts") return;
            const rows = Array.isArray(data) ? data : [data];
            const ids = rows.map((r) => Number((r as { id?: unknown } | null)?.id)).filter((n) => Number.isInteger(n) && n > 0);
            await markDirty(env, ids.map((id) => `p${id}`), why);
         };
         app.emgr.onEvent(DatabaseEvents.MutatorInsertAfter, (e) => touch(e, "post created"), { mode: "sync", id: "aun-feed-insert" });
         app.emgr.onEvent(DatabaseEvents.MutatorUpdateAfter, (e) => touch(e, "post updated"), { mode: "sync", id: "aun-feed-update" });
         app.emgr.onEvent(DatabaseEvents.MutatorDeleteAfter, (e) => touch(e, "post deleted"), { mode: "sync", id: "aun-feed-delete" });
      },
   });
}
