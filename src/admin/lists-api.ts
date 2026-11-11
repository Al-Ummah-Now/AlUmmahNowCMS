/**
 * Staff API for www list pages (docs/specs/WWW-PAGES.md). Editors and admins only.
 *
 *   Curated pages (the Timeline screen's client drives these with data-api="/admin/api/lists/:id"):
 *   GET    /admin/api/lists/:id/candidates?q        posts not on the page (Add a post; newest first with no q)
 *   POST   /admin/api/lists/:id/videos              { kind, ref_id, entry_date? }  (Add a video; joins the library)
 *   POST   /admin/api/lists/:id/posts/:postId       { on }  add / remove (soft delete) a post
 *   PATCH  /admin/api/lists/:id/entries/:key        { hidden?, pinned?, entry_date?, title_override? }
 *   DELETE /admin/api/lists/:id/entries/:key        a video entry { reason? } (soft: to the trash)
 *   PUT    /admin/api/lists/:id/pins                { keys }  the pinned order
 *
 *   Filter pages:
 *   GET    /admin/api/lists/preview?locale&kinds&tag  the first 10 items and the total (the page editor)
 *   GET    /admin/api/lists/tags?locale&q             tags in use, most used first (the Tag autocomplete)
 *
 *   The CMS video library (the Videos screen):
 *   POST   /admin/api/library                       { kind, ref_id, locale }  add from the picker
 *   PATCH  /admin/api/library/:id                   { locale }
 *   DELETE /admin/api/library/:id                   { reason? }  soft delete: leaves /videos
 */
import { Hono, type Context } from "hono";
import { TimelineError, type Actor } from "../lib/feed/admin.ts";
import { addToLibrary, LIBRARY_KINDS, LibraryError, removeFromLibrary, setLibraryLocale } from "../lib/library.ts";
import { filterItems, ListError, normalizeFilter, TAG_MAX } from "../lib/lists.ts";
import {
   addPageVideo,
   curatedPage,
   pageCandidates,
   pageCounts,
   removePageVideo,
   reorderPagePins,
   setPageHidden,
   setPagePinned,
   setPagePost,
   setPageVideoFields,
} from "../lib/page-entries.ts";
import { LIVE_SQL } from "../lib/schedule.ts";
import { mainSiteSql } from "../lib/scholars/main-site.ts";
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
const REF = /^[A-Za-z0-9_-]{1,64}$/;

async function body(c: C): Promise<Record<string, unknown> | null> {
   if (!(c.req.header("content-type") ?? "").includes("application/json")) return null;
   const b = (await c.req.json().catch(() => null)) as unknown;
   return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}

function fail(c: C, error: unknown) {
   if (error instanceof TimelineError || error instanceof TrashError || error instanceof LibraryError) return c.json({ error: error.code }, error.status);
   if (error instanceof ListError) return c.json({ error: error.code, message: error.message }, 400);
   console.error("lists api", String(error));
   return c.json({ error: "internal_error" }, 500);
}

/** Looks the item up on the videos site and stores its snapshot (null: not public / not found). */
async function snapshot(c: C, deps: Deps, kind: "video" | "playlist" | "channel", refId: string) {
   const item = await lookupForSnapshot(c.get("cfg").videosApiUrl, kind, refId, deps.fetch);
   if (item) await putSnapshot(c.env.DB, item);
   return item;
}

export function listsApi(deps: Deps): Hono<AppEnv> {
   const r = new Hono<AppEnv>();
   r.use("*", async (c, next) => (staff(c) ? next() : c.json({ error: "forbidden" }, 403)));

   /* Filter pages */

   r.get("/preview", async (c) => {
      const l = loc(c.req.query("locale"));
      if (!l) return c.json({ error: "bad_request" }, 400);
      try {
         const f = normalizeFilter({ kinds: (c.req.query("kinds") ?? "").split(",").filter(Boolean), tag: c.req.query("tag") ?? null });
         const res = await filterItems(c.env, l, f, 1, 10);
         const items = res.items.map((i) => ({
            key: i.key,
            kind: i.type === "post" ? ((i.post as { kind?: string })?.kind === "cards" ? "cards" : "article") : (i.video?.kind ?? "video"),
            title: i.type === "post" ? String(i.post?.title ?? "") : String(i.video?.title_override || (i.video?.snapshot as { title?: string } | null)?.title || i.video?.ref_id),
            date: i.date,
         }));
         return c.json({ data: { items, total: res.total } });
      } catch (error) {
         return fail(c, error);
      }
   });

   r.get("/tags", async (c) => {
      const l = loc(c.req.query("locale"));
      if (!l) return c.json({ error: "bad_request" }, 400);
      const q = (c.req.query("q") ?? "").trim().toLowerCase().slice(0, TAG_MAX);
      const { results } = await c.env.DB.prepare(
         `SELECT j.value AS tag, count(*) AS n FROM posts p, json_each(CASE WHEN json_valid(p.tags) THEN p.tags ELSE '[]' END) j
          WHERE p.locale = ?1 AND ${LIVE_SQL.replace(/\b(status|publish_at)\b/g, "p.$1")} AND ${mainSiteSql("p")} AND typeof(j.value) = 'text'
            AND (?2 = '' OR lower(j.value) LIKE '%' || ?2 || '%')
          GROUP BY j.value ORDER BY n DESC, j.value LIMIT 20`,
      )
         .bind(l, q)
         .all<{ tag: string; n: number }>();
      return c.json({ data: { items: results.map((x) => ({ tag: x.tag, count: Number(x.n) })) } });
   });

   /* Curated pages */

   const page = async (c: C) => curatedPage(c.env, Number(c.req.param("id")));

   r.get("/:id{[0-9]+}/candidates", async (c) => {
      try {
         const p = await page(c);
         const q = (c.req.query("q") ?? "").trim().slice(0, 100);
         const [items, counts] = await Promise.all([pageCandidates(c.env, p, q), pageCounts(c.env, p)]);
         return c.json({ items, ...counts });
      } catch (error) {
         return fail(c, error);
      }
   });

   r.post("/:id{[0-9]+}/videos", async (c) => {
      const b = await body(c);
      const kind = b?.kind;
      const refId = typeof b?.ref_id === "string" ? b.ref_id : "";
      if ((kind !== "video" && kind !== "playlist" && kind !== "channel") || !REF.test(refId)) return c.json({ error: "bad_request" }, 400);
      try {
         const p = await page(c);
         let item;
         try {
            item = await snapshot(c, deps, kind, refId);
         } catch (error) {
            console.warn("list video lookup failed", String(error));
            return c.json({ error: "upstream_error" }, 502);
         }
         if (!item) return c.json({ error: "not_found" }, 404);
         const res = await addPageVideo(c.env, p, { kind, ref_id: item.id, entry_date: typeof b?.entry_date === "string" ? b.entry_date : null }, actorOf(c));
         return c.json({ data: res }, res.existing ? 200 : 201);
      } catch (error) {
         return fail(c, error);
      }
   });

   r.post("/:id{[0-9]+}/posts/:postId{[0-9]+}", async (c) => {
      const b = await body(c);
      if (typeof b?.on !== "boolean") return c.json({ error: "bad_request" }, 400);
      try {
         await setPagePost(c.env, await page(c), Number(c.req.param("postId")), b.on, actorOf(c));
         return c.json({ data: { on: b.on } });
      } catch (error) {
         return fail(c, error);
      }
   });

   r.patch("/:id{[0-9]+}/entries/:key{[pv][0-9]+}", async (c) => {
      const b = await body(c);
      if (!b) return c.json({ error: "bad_request" }, 400);
      const key = c.req.param("key");
      try {
         const p = await page(c);
         if (typeof b.hidden === "boolean") await setPageHidden(c.env, p, key, b.hidden, actorOf(c));
         if (typeof b.pinned === "boolean") await setPagePinned(c.env, p, key, b.pinned, actorOf(c));
         const fields: { entry_date?: string; title_override?: string | null } = {};
         if (typeof b.entry_date === "string") fields.entry_date = b.entry_date;
         if (b.title_override === null || typeof b.title_override === "string") fields.title_override = b.title_override as string | null;
         if (Object.keys(fields).length) await setPageVideoFields(c.env, p, key, fields, actorOf(c));
         return c.json({ data: { key } });
      } catch (error) {
         return fail(c, error);
      }
   });

   r.delete("/:id{[0-9]+}/entries/:key{v[0-9]+}", async (c) => {
      try {
         const b = await body(c);
         await removePageVideo(c.env, await page(c), c.req.param("key"), actorOf(c), b?.reason);
         return c.json({ data: { removed: c.req.param("key") } });
      } catch (error) {
         return fail(c, error);
      }
   });

   r.put("/:id{[0-9]+}/pins", async (c) => {
      const b = await body(c);
      const keys = Array.isArray(b?.keys) ? (b!.keys as unknown[]).filter((k): k is string => typeof k === "string" && /^[pv]\d{1,12}$/.test(k)) : null;
      if (!keys || keys.length !== (b!.keys as unknown[]).length || keys.length > 100) return c.json({ error: "bad_request" }, 400);
      try {
         await reorderPagePins(c.env, await page(c), keys, actorOf(c));
         return c.json({ data: { keys } });
      } catch (error) {
         return fail(c, error);
      }
   });

   return r;
}

export function libraryApi(deps: Deps): Hono<AppEnv> {
   const r = new Hono<AppEnv>();
   r.use("*", async (c, next) => (staff(c) ? next() : c.json({ error: "forbidden" }, 403)));

   r.post("/", async (c) => {
      const b = await body(c);
      const kind = b?.kind as "video" | "playlist" | "channel";
      const refId = typeof b?.ref_id === "string" ? b.ref_id : "";
      const locale = typeof b?.locale === "string" ? b.locale : "all";
      if (!(LIBRARY_KINDS as readonly unknown[]).includes(kind) || !REF.test(refId)) return c.json({ error: "bad_request" }, 400);
      try {
         let item;
         try {
            item = await snapshot(c, deps, kind, refId);
         } catch (error) {
            console.warn("library video lookup failed", String(error));
            return c.json({ error: "upstream_error" }, 502);
         }
         if (!item) return c.json({ error: "not_found" }, 404);
         const res = await addToLibrary(c.env, { kind, ref_id: item.id, locale }, "library", actorOf(c));
         return c.json({ data: res }, res.added ? 201 : 200);
      } catch (error) {
         return fail(c, error);
      }
   });

   r.patch("/:id{[0-9]+}", async (c) => {
      const b = await body(c);
      if (typeof b?.locale !== "string") return c.json({ error: "bad_request" }, 400);
      try {
         await setLibraryLocale(c.env, Number(c.req.param("id")), b.locale);
         return c.json({ data: { locale: b.locale } });
      } catch (error) {
         return fail(c, error);
      }
   });

   r.delete("/:id{[0-9]+}", async (c) => {
      try {
         const b = await body(c);
         const trashId = await removeFromLibrary(c.env, Number(c.req.param("id")), actorOf(c), b?.reason);
         return c.json({ data: { trash_id: trashId } });
      } catch (error) {
         return fail(c, error);
      }
   });

   return r;
}
