/**
 * The Timeline screen's endpoints (staff session, same-origin; src/index.ts gates /admin/api/*).
 *
 *   GET    /admin/api/timeline/candidates?locale&q   posts not on the timeline (Add post), with the
 *                                                     locale's published / switched-off post counts
 *   POST   /admin/api/timeline/videos                { kind, ref_id, locale, entry_date? }  (Add video)
 *   POST   /admin/api/timeline/posts/:id             { on }  a post on / off the timeline
 *   PATCH  /admin/api/timeline/entries/:key          { hidden?, pinned?, entry_date?, title_override?, locale? }
 *   DELETE /admin/api/timeline/entries/:key          a video entry { reason? } (soft: to the trash, docs/SOFT_DELETE.md)
 *   PUT    /admin/api/timeline/pins                  { locale, keys }  the pinned order
 *   GET    /admin/api/timeline/status                the KV build's state
 *   POST   /admin/api/timeline/retry                 requeue a build that failed (DLQ flag)
 *   POST   /admin/api/timeline/rebuild               admin: rebuild every bucket (manual repair; a format change
 *                                                     rebuilds on its own, src/lib/feed/auto-rebuild.ts)
 *
 * Every write is logged with who and when (timeline_changes) and queues a coalesced KV build.
 */
import { Hono, type Context } from "hono";
import { feedStatus, requestFullRebuild, retryFeed } from "../lib/feed/jobs.ts";
import { addVideo, logRebuild, offTimeline, postCounts, removeVideo, reorderPins, setHidden, setPinned, setPostOnTimeline, setVideoFields, TimelineError, type Actor } from "../lib/feed/admin.ts";
import { withActor } from "../lib/revisions.ts";
import { TrashError } from "../lib/trash.ts";
import { lookupForSnapshot, putSnapshot } from "../lib/video-snapshots.ts";
import type { AppEnv, Deps } from "../types.ts";

type C = Context<AppEnv>;
const staff = (c: C) => {
   const role = c.get("user")?.role;
   return role === "admin" || role === "editor";
};
const actorOf = (c: C): Actor => ({ id: c.get("user")?.id ?? null, email: c.get("user")?.email ?? null });
const loc = (v: unknown): "en" | "ar" | null => (v === "en" || v === "ar" ? v : null);

async function body(c: C): Promise<Record<string, unknown> | null> {
   if (!(c.req.header("content-type") ?? "").includes("application/json")) return null;
   const b = (await c.req.json().catch(() => null)) as unknown;
   return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}

function fail(c: C, error: unknown) {
   if (error instanceof TimelineError || error instanceof TrashError) return c.json({ error: error.code }, error.status);
   console.error("timeline api", String(error));
   return c.json({ error: "internal_error" }, 500);
}

export function timelineApi(deps: Deps): Hono<AppEnv> {
   const r = new Hono<AppEnv>();
   r.use("*", async (c, next) => (staff(c) ? next() : c.json({ error: "forbidden" }, 403)));

   r.get("/candidates", async (c) => {
      const l = loc(c.req.query("locale"));
      if (!l) return c.json({ error: "bad_request" }, 400);
      const q = (c.req.query("q") ?? "").trim().slice(0, 100);
      const [items, counts] = await Promise.all([offTimeline(c.env, l, q), postCounts(c.env, l)]);
      return c.json({ items, ...counts });
   });

   r.post("/videos", async (c) => {
      const b = await body(c);
      const kind = b?.kind;
      const refId = typeof b?.ref_id === "string" ? b.ref_id : "";
      const locale = typeof b?.locale === "string" ? b.locale : "all";
      if ((kind !== "video" && kind !== "playlist" && kind !== "channel") || !/^[A-Za-z0-9_-]{1,64}$/.test(refId)) return c.json({ error: "bad_request" }, 400);
      let item;
      try {
         item = await lookupForSnapshot(c.get("cfg").videosApiUrl, kind, refId, deps.fetch);
      } catch (error) {
         console.warn("timeline video lookup failed", String(error));
         return c.json({ error: "upstream_error" }, 502);
      }
      if (!item) return c.json({ error: "not_found" }, 404);
      await putSnapshot(c.env.DB, item);
      try {
         const res = await addVideo(c.env, { kind, ref_id: item.id, locale, entry_date: typeof b?.entry_date === "string" ? b.entry_date : null }, actorOf(c));
         return c.json({ data: res }, res.existing ? 200 : 201);
      } catch (error) {
         return fail(c, error);
      }
   });

   r.post("/posts/:id{[0-9]+}", async (c) => {
      const b = await body(c);
      if (typeof b?.on !== "boolean") return c.json({ error: "bad_request" }, 400);
      const user = c.get("user");
      const app = await deps.getApp(c);
      try {
         await setPostOnTimeline(c.env, Number(c.req.param("id")), b.on, actorOf(c), async (id, on) => {
            await withActor({ id: user.id, email: user.email }, () => app.em.mutator("posts").updateOne(id, { show_on_timeline: on } as never));
         });
         return c.json({ data: { on: b.on } });
      } catch (error) {
         return fail(c, error);
      }
   });

   r.patch("/entries/:key{[pv][0-9]+}", async (c) => {
      const b = await body(c);
      if (!b) return c.json({ error: "bad_request" }, 400);
      const key = c.req.param("key");
      try {
         if (typeof b.hidden === "boolean") await setHidden(c.env, key, b.hidden, actorOf(c));
         if (typeof b.pinned === "boolean") await setPinned(c.env, key, b.pinned, actorOf(c));
         const fields: { entry_date?: string; title_override?: string | null; locale?: string } = {};
         if (typeof b.entry_date === "string") fields.entry_date = b.entry_date;
         if (b.title_override === null || typeof b.title_override === "string") fields.title_override = b.title_override as string | null;
         if (typeof b.locale === "string") fields.locale = b.locale;
         if (Object.keys(fields).length) await setVideoFields(c.env, key, fields, actorOf(c));
         return c.json({ data: { key } });
      } catch (error) {
         return fail(c, error);
      }
   });

   r.delete("/entries/:key{v[0-9]+}", async (c) => {
      try {
         const b = await body(c);
         await removeVideo(c.env, c.req.param("key"), actorOf(c), b?.reason);
         return c.json({ data: { removed: c.req.param("key") } });
      } catch (error) {
         return fail(c, error);
      }
   });

   r.put("/pins", async (c) => {
      const b = await body(c);
      const l = loc(b?.locale);
      const keys = Array.isArray(b?.keys) ? (b!.keys as unknown[]).filter((k): k is string => typeof k === "string" && /^[pv]\d{1,12}$/.test(k)) : null;
      if (!l || !keys || keys.length !== (b!.keys as unknown[]).length || keys.length > 100) return c.json({ error: "bad_request" }, 400);
      try {
         await reorderPins(c.env, l, keys, actorOf(c));
         return c.json({ data: { keys } });
      } catch (error) {
         return fail(c, error);
      }
   });

   r.get("/status", async (c) => c.json({ data: await feedStatus(c.env.DB) }));

   r.post("/retry", async (c) => c.json({ data: { queued: await retryFeed(c.env) } }));

   r.post("/rebuild", async (c) => {
      if (c.get("user")?.role !== "admin") return c.json({ error: "forbidden" }, 403);
      await requestFullRebuild(c.env, "full rebuild (Timeline screen)");
      await logRebuild(c.env, actorOf(c), { reason: "manual" });
      return c.json({ data: await feedStatus(c.env.DB) }, 202);
   });

   return r;
}
