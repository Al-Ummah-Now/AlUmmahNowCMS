/**
 * Video picker (SPEC §5): an SSO-gated page plus a server-side proxy to the public videos API.
 * Picking creates a `curated_videos` row (draft or published) with a snapshot taken server-side.
 */
import { Hono } from "hono";
import { applyRules, ContentRuleError } from "../lib/content-rules.ts";
import { embedUrl } from "../lib/embeds.ts";
import { snapshotOf } from "../lib/snapshots.ts";
import { lookupItem, searchVideos, VIDEO_KINDS, type VideoKind } from "../lib/videos.ts";
import type { AppEnv, Deps } from "../types.ts";

const CURATED_COLS = "id, kind, ref_id, placement, locale, title_override, sort, status, snapshot, created_at, updated_at";
type StoredRow = Record<string, unknown> & { snapshot: string | null };

/** The row as bknd's data API returns it (snapshot as JSON, not text). */
function hydrate(r: StoredRow): Record<string, unknown> {
   let snapshot: unknown = null;
   try {
      snapshot = r.snapshot ? JSON.parse(r.snapshot) : null;
   } catch {
      /* keep null */
   }
   return { ...r, snapshot };
}

const PLACEMENTS = ["home", "videos"];
const LOCALES = ["en", "ar", "all"];
const STATUSES = ["draft", "published"];

export function pickerRoutes(deps: Deps): Hono<AppEnv> {
   const picker = new Hono<AppEnv>();

   // The picker now lives inside the edit screens (docs/ADMIN_UI_SPEC.md A20); old links land on Videos.
   picker.get("/", (c) => c.redirect("/videos", 302));

   picker.get("/api/search", async (c) => {
      const cfg = c.get("cfg");
      const kind = (c.req.query("kind") ?? "video") as VideoKind;
      const q = (c.req.query("q") ?? "").trim();
      if (!VIDEO_KINDS.includes(kind)) return c.json({ error: "bad_request", message: "kind must be video, playlist or channel" }, 400);
      if (q.length < 2 || q.length > 100) return c.json({ error: "bad_request", message: "q must be 2–100 characters" }, 400);
      try {
         const items = await searchVideos(cfg.videosApiUrl, kind, q, deps.fetch);
         return c.json({
            items: items.map((it) => ({ ...it, embed_url: embedUrl(cfg.videosWebUrl, it.kind, it.id) })),
         });
      } catch (error) {
         console.warn("picker search failed", (error as Error).message);
         return c.json({ error: "upstream_error" }, 502);
      }
   });

   picker.post("/api/items", async (c) => {
      const cfg = c.get("cfg");
      if (!(c.req.header("content-type") ?? "").includes("application/json")) {
         return c.json({ error: "bad_request", message: "JSON body required" }, 415);
      }
      const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!b) return c.json({ error: "bad_request" }, 400);
      const kind = b.kind as VideoKind;
      const refId = typeof b.ref_id === "string" ? b.ref_id : "";
      const placement = String(b.placement ?? "");
      const locale = String(b.locale ?? "all");
      const status = String(b.status ?? "draft");
      const sort = Number(b.sort ?? 0);
      const titleOverride = typeof b.title_override === "string" && b.title_override.trim() ? b.title_override.trim().slice(0, 200) : null;
      if (
         !VIDEO_KINDS.includes(kind) ||
         !refId ||
         !PLACEMENTS.includes(placement) ||
         !LOCALES.includes(locale) ||
         !STATUSES.includes(status) ||
         !Number.isInteger(sort) ||
         sort < 0 ||
         sort > 100_000
      ) {
         return c.json({ error: "bad_request" }, 400);
      }
      let item;
      try {
         item = await lookupItem(cfg.videosApiUrl, kind, refId, deps.fetch);
      } catch (error) {
         console.warn("picker lookup failed", (error as Error).message);
         return c.json({ error: "upstream_error" }, 502);
      }
      if (!item) return c.json({ error: "not_found", message: "not found or not public" }, 404);

      const row: Record<string, unknown> = {
         kind,
         ref_id: item.id,
         placement,
         locale,
         sort,
         status,
         title_override: titleOverride,
         snapshot: snapshotOf(item, new Date()),
      };
      try {
         applyRules("curated_videos", row, "create");
      } catch (error) {
         if (error instanceof ContentRuleError) return c.json({ error: "bad_request", message: error.message }, 400);
         throw error;
      }
      // Idempotent: a double-click (or two editors) adding the same video to the same placement and
      // locale creates one row. The unique index (migrations/0002) makes this atomic across isolates.
      const inserted = await c.env.DB.prepare(
         `INSERT INTO curated_videos (kind, ref_id, placement, locale, title_override, sort, status, snapshot, created_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
          ON CONFLICT (kind, ref_id, placement, locale) DO NOTHING
          RETURNING ${CURATED_COLS}`,
      )
         .bind(row.kind, row.ref_id, row.placement, row.locale, row.title_override, row.sort, row.status, JSON.stringify(row.snapshot), (row.created_at as Date).toISOString())
         .first<StoredRow>();
      if (inserted) return c.json({ data: hydrate(inserted) }, 201);
      const existing = await c.env.DB.prepare(`SELECT ${CURATED_COLS} FROM curated_videos WHERE kind = ?1 AND ref_id = ?2 AND placement = ?3 AND locale = ?4`)
         .bind(row.kind, row.ref_id, row.placement, row.locale)
         .first<StoredRow>();
      return c.json({ data: existing ? hydrate(existing) : null, existing: true }, 200);
   });

   // Change the video of an existing row (spec §0): same lookup and server-side snapshot as POST.
   picker.put("/api/items/:id{[0-9]+}", async (c) => {
      const cfg = c.get("cfg");
      if (!(c.req.header("content-type") ?? "").includes("application/json")) {
         return c.json({ error: "bad_request", message: "JSON body required" }, 415);
      }
      const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
      const kind = b?.kind as VideoKind;
      const refId = typeof b?.ref_id === "string" ? b.ref_id : "";
      if (!VIDEO_KINDS.includes(kind) || !refId) return c.json({ error: "bad_request" }, 400);
      const id = Number(c.req.param("id"));
      const app = await deps.getApp(c);
      const { data: current } = await app.em.repo("curated_videos").findId(id);
      if (!current) return c.json({ error: "not_found" }, 404);
      let item;
      try {
         item = await lookupItem(cfg.videosApiUrl, kind, refId, deps.fetch);
      } catch (error) {
         console.warn("picker lookup failed", (error as Error).message);
         return c.json({ error: "upstream_error" }, 502);
      }
      if (!item) return c.json({ error: "not_found", message: "not found or not public" }, 404);
      const cur = current as Record<string, unknown>;
      const clash = await c.env.DB.prepare("SELECT id FROM curated_videos WHERE kind = ?1 AND ref_id = ?2 AND placement = ?3 AND locale = ?4 AND id <> ?5")
         .bind(kind, item.id, cur.placement, cur.locale ?? "all", id)
         .first<{ id: number }>();
      if (clash) return c.json({ error: "conflict", message: "This video is already in this placement and language", id: clash.id }, 409);
      try {
         const { data } = await app.em.mutator("curated_videos").updateOne(id, {
            kind,
            ref_id: item.id,
            snapshot: { title: item.title, thumbnail_url: item.thumbnail_url, channel_name: item.channel_name },
         } as never);
         return c.json({ data }, 200);
      } catch (error) {
         if (error instanceof ContentRuleError) return c.json({ error: "bad_request", message: error.message }, 400);
         throw error;
      }
   });

   return picker;
}
