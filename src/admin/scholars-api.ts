/**
 * Scholar profiles and featuring (docs/SCHOLARS.md). Staff session, same-origin (src/index.ts).
 *
 *   GET    /admin/api/scholars/me                 the writer's own profile + the channels they own
 *   PUT    /admin/api/scholars/me                 { name_en, name_ar, bio_en, bio_ar, slug, avatar_media_id, channel_ids, updated_at }
 *   GET    /admin/api/scholars/:id                staff: a profile + its scholar's channels
 *   PUT    /admin/api/scholars/:id                staff: the same edit
 *   DELETE /admin/api/scholars/:id    { reason? } admin: soft delete (restorable for 30 days)
 *   POST   /admin/api/featuring/posts/:id  { on }  staff: feature / unfeature a scholar article (+ translations)
 *   POST   /admin/api/featuring/community/retry  staff: retry community posts that gave up
 *
 * Featuring a video is the timeline's own "Add video" (/admin/api/timeline/videos) and removing it
 * DELETE /admin/api/timeline/entries/:key: one place decides what is on the home timeline.
 */
import { Hono, type Context } from "hono";
import { errText, log } from "../lib/log.ts";
import { requeueScholarPosts, retryDeadLinks } from "../lib/scholars/community.ts";
import { FeatureError, setFeatured } from "../lib/scholars/featuring.ts";
import { subOfUser } from "../lib/scholars/ownership.ts";
import { ScholarError, scholarById, scholarOfSub, updateScholar, validateScholarInput, type Scholar } from "../lib/scholars/profiles.ts";
import { ownedChannels, type OwnedChannel } from "../lib/scholars/videos-internal.ts";
import { softDelete, TrashError } from "../lib/trash.ts";
import type { AppEnv, Deps } from "../types.ts";

type C = Context<AppEnv>;
const isStaff = (c: C) => c.get("user")?.role === "admin" || c.get("user")?.role === "editor";

async function body(c: C): Promise<Record<string, unknown> | null> {
   if (!(c.req.header("content-type") ?? "").includes("application/json")) return null;
   const b = (await c.req.json().catch(() => null)) as unknown;
   return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}

function fail(c: C, error: unknown) {
   if (error instanceof ScholarError || error instanceof FeatureError || error instanceof TrashError) return c.json({ error: error.code }, error.status);
   log.error("scholars api failed", { path: c.req.path, error: errText(error) });
   return c.json({ error: "internal_error" }, 500);
}

/** The channels a scholar owns; null when the videos API can't say right now. */
async function channelsOf(c: C, deps: Deps, sub: string): Promise<OwnedChannel[] | null> {
   try {
      return await ownedChannels(c.env, sub, deps.fetch);
   } catch (error) {
      log.warn("scholar channels unavailable", { error: errText(error) });
      return null;
   }
}

async function save(c: C, deps: Deps, scholar: Scholar) {
   const b = await body(c);
   if (!b) return c.json({ error: "bad_request" }, 400);
   try {
      const owned = b.channel_ids !== undefined ? await channelsOf(c, deps, scholar.sso_sub) : [];
      const fields = validateScholarInput(b, owned === null ? null : owned.map((ch) => ch.id));
      // The avatar must be an image in the library (picked or uploaded in the media dialog).
      if (typeof fields.avatar_media_id === "number") {
         const m = await c.env.DB.prepare("SELECT 1 AS x FROM media WHERE id = ?1 AND mime_type LIKE 'image/%'").bind(fields.avatar_media_id).first();
         if (!m) throw new ScholarError(400, "bad_avatar");
      }
      if (!Object.keys(fields).length) return c.json({ error: "nothing_to_change" }, 400);
      const saved = await updateScholar(c.env.DB, scholar.id, fields, b.updated_at, c.get("user").email);
      // A different first channel: every article moves its community post to the new channel.
      if (fields.channel_ids !== undefined && saved.channel_ids[0] !== scholar.channel_ids[0]) await requeueScholarPosts(c.env, saved.sso_sub);
      return c.json({ data: saved });
   } catch (error) {
      return fail(c, error);
   }
}

export function scholarsApi(deps: Deps): Hono<AppEnv> {
   const r = new Hono<AppEnv>();

   r.get("/me", async (c) => {
      const sub = await subOfUser(c.env.DB, c.get("user").id);
      const scholar = await scholarOfSub(c.env.DB, sub);
      if (!scholar) return c.json({ error: "not_found" }, 404);
      return c.json({ data: scholar, channels: await channelsOf(c, deps, scholar.sso_sub) });
   });

   r.put("/me", async (c) => {
      const sub = await subOfUser(c.env.DB, c.get("user").id);
      const scholar = await scholarOfSub(c.env.DB, sub);
      if (!scholar) return c.json({ error: "not_found" }, 404);
      return save(c, deps, scholar);
   });

   r.use("/:id{[0-9]+}", async (c, next) => (isStaff(c) ? next() : c.json({ error: "forbidden" }, 403)));

   r.get("/:id{[0-9]+}", async (c) => {
      const scholar = await scholarById(c.env.DB, Number(c.req.param("id")));
      if (!scholar) return c.json({ error: "not_found" }, 404);
      return c.json({ data: scholar, channels: await channelsOf(c, deps, scholar.sso_sub) });
   });

   r.put("/:id{[0-9]+}", async (c) => {
      const scholar = await scholarById(c.env.DB, Number(c.req.param("id")));
      if (!scholar) return c.json({ error: "not_found" }, 404);
      return save(c, deps, scholar);
   });

   r.delete("/:id{[0-9]+}", async (c) => {
      const user = c.get("user");
      if (user.role !== "admin") return c.json({ error: "forbidden" }, 403);
      const b = await body(c);
      try {
         const trashId = await softDelete(c.env, "scholars", Number(c.req.param("id")), { id: user.id, email: user.email }, b?.reason);
         return c.json({ data: { trash_id: trashId, deleted: "soft" } });
      } catch (error) {
         return fail(c, error);
      }
   });

   return r;
}

export function featuringApi(): Hono<AppEnv> {
   const r = new Hono<AppEnv>();
   r.use("*", async (c, next) => (isStaff(c) ? next() : c.json({ error: "forbidden" }, 403)));

   r.post("/posts/:id{[0-9]+}", async (c) => {
      const b = await body(c);
      if (typeof b?.on !== "boolean") return c.json({ error: "bad_request" }, 400);
      const user = c.get("user");
      try {
         const ids = await setFeatured(c.env, Number(c.req.param("id")), b.on, { id: user.id, email: user.email });
         return c.json({ data: { on: b.on, changed: ids } });
      } catch (error) {
         return fail(c, error);
      }
   });

   r.post("/community/retry", async (c) => c.json({ data: { requeued: await retryDeadLinks(c.env.DB) } }));

   return r;
}
