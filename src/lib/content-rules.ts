/**
 * bknd plugin: content rules that must hold however a row is written (admin UI, data API, picker).
 * - created_at / updated_at on every content entity (CONTENT_ENTITIES).
 * - `published_at` is set on first publish and never cleared once it has passed (pages, posts).
 *   A scheduled row (status published, `publish_at` ahead) gets `published_at = publish_at`, moved
 *   with the schedule and cleared on unschedule until it goes live (src/lib/schedule.ts).
 * - `publish_at` is a valid date or NULL, and a draft never carries one.
 * - nav_items.url is a www-relative path ("/…", not "//") or an absolute https URL.
 * - the page slug "home" is reserved (www's home page is not a CMS page).
 * - posts.tags is an array of strings.
 * - curated_videos.locale is never NULL (NULL means "all"; stored as 'all').
 * - pages.blocks is a valid block list (src/lib/blocks.ts), stored normalized; when blocks are
 *   written, pages.body is derived from them (the v1 contract's markdown fallback).
 * - posts.kind is "article" (default) or "cards"; posts.slides is a valid slide list, and a card
 *   post's body is derived from its slides.
 * - optimistic lock: an update that carries `updated_at` only applies if the row still has that
 *   `updated_at`; otherwise it fails with 409 (two editors saving the same row: the second, stale
 *   save no longer silently overwrites the first). Updates without `updated_at` are unchanged.
 *
 * bknd limitation (0.21.0): a listener's *returned* data is validated with `entity.isValidData`,
 * and JsonField.isValid(undefined) is false, so any return on an entity with a JSON field whose
 * value isn't in the payload is discarded (bknd's own timestamps plugin silently does nothing on
 * posts/curated_videos/site_settings). Workaround: mutate `event.params.data` IN PLACE and return
 * nothing — the mutator then uses that same object (`returned ? params.data : data`).
 */
import { DatabaseEvents, Exception, type AppPlugin } from "bknd";
import { CONTENT_ENTITIES } from "../schema.ts";
import { timeOf } from "./schedule.ts";
import { BlockError, blocksToMarkdown, normalizeBlocks, normalizeSlides, slidesToMarkdown } from "./blocks.ts";

const CONTENT = new Set<string>(CONTENT_ENTITIES);
const PUBLISHABLE = new Set(["pages", "posts"]);
const WITH_STATUS = new Set(["pages", "posts", "nav_items", "curated_videos"]);

/** 400: a content rule refused the write (bknd serializes an Exception with its code, not as a 500). */
export class ContentRuleError extends Exception {
   constructor(message: string) {
      super(message, 400);
      this.name = "ContentRuleError";
   }
}

/** 409: the row changed since the editor loaded it (bknd serializes an Exception with its code). */
export class StaleWriteError extends Exception {
   constructor() {
      super("This item was changed by someone else after you opened it. Reload it, then apply your changes again.", 409);
      this.name = "StaleWriteError";
   }
}

/** The stored forms the client's `updated_at` may match (as sent, and as bknd's ISO string). */
export function versionCandidates(expected: unknown): string[] | null {
   if (expected === null || expected === undefined || expected === "") return null;
   const out = new Set<string>();
   if (typeof expected === "string") out.add(expected);
   const d = expected instanceof Date ? expected : typeof expected === "string" || typeof expected === "number" ? new Date(expected) : null;
   if (d && !Number.isNaN(d.getTime())) out.add(d.toISOString());
   if (out.size === 0) throw new ContentRuleError("updated_at must be the value the item was loaded with");
   return [...out];
}

/**
 * The new `updated_at` for a locked save: now, but always later than the version it replaces.
 * The Workers clock does not advance inside a request (and two saves can share a millisecond), so
 * without this a save could write back the very value the next stale save is compared against.
 */
export function nextVersion(expected: unknown, now = new Date()): Date {
   const prev = expected === null || expected === undefined || expected === "" ? NaN : new Date(expected as string | number).getTime();
   return Number.isNaN(prev) || now.getTime() > prev ? now : new Date(prev + 1);
}

export async function claimVersion(db: D1Database, table: string, id: number | string, expected: unknown, now: Date): Promise<void> {
   if (!CONTENT.has(table)) throw new Error(`no optimistic lock for ${table}`);
   const candidates = versionCandidates(expected);
   const match = candidates ? `updated_at IN (${candidates.map((_, i) => `?${i + 3}`).join(", ")})` : "updated_at IS NULL";
   const claimed = await db
      .prepare(`UPDATE "${table}" SET updated_at = ?1 WHERE id = ?2 AND ${match} RETURNING id`)
      .bind(now.toISOString(), Number(id), ...(candidates ?? []))
      .first();
   if (claimed) return;
   const exists = await db.prepare(`SELECT id FROM "${table}" WHERE id = ?1`).bind(Number(id)).first();
   if (exists) throw new StaleWriteError();
   // No such row: let bknd answer as it does for any missing id.
}

export function validNavUrl(url: unknown): boolean {
   if (typeof url !== "string" || url.length === 0 || url.length > 2048) return false;
   if (url.startsWith("/")) return !url.startsWith("//") && !/[\\\s]/.test(url);
   try {
      return new URL(url).protocol === "https:";
   } catch {
      return false;
   }
}

/** Absolute https URL (social links, thumbnails). */
export function validHttpsUrl(url: unknown): boolean {
   if (typeof url !== "string" || url.length === 0 || url.length > 2048) return false;
   try {
      return new URL(url).protocol === "https:";
   } catch {
      return false;
   }
}

export const REF_ID = /^[A-Za-z0-9_-]{1,128}$/;

type Row = Record<string, unknown>;

/** Applies the rules to `data` in place. `current` is the stored row for updates. */
export function applyRules(entity: string, data: Row, mode: "create" | "update", current?: Row | null, now = new Date()): void {
   if (entity === "nav_items" && "url" in data && !validNavUrl(data.url)) {
      throw new ContentRuleError('nav_items.url must be a relative "/…" path or an https:// URL');
   }
   if (entity === "pages" && typeof data.slug === "string" && data.slug.trim().toLowerCase() === "home") {
      throw new ContentRuleError('The page slug "home" is reserved');
   }
   if (entity === "pages" && "blocks" in data) {
      let blocks;
      try {
         blocks = normalizeBlocks(data.blocks);
      } catch (error) {
         if (error instanceof BlockError) throw new ContentRuleError(error.message);
         throw error;
      }
      data.blocks = blocks;
      data.body = blocksToMarkdown(blocks);
   }
   if (entity === "posts") {
      if (mode === "create" && (data.kind === undefined || data.kind === null)) data.kind = "article";
      if ("kind" in data && data.kind !== null && data.kind !== "article" && data.kind !== "cards") throw new ContentRuleError('posts.kind must be "article" or "cards"');
      if ("slides" in data) {
         let slides;
         try {
            slides = normalizeSlides(data.slides);
         } catch (error) {
            if (error instanceof BlockError) throw new ContentRuleError(error.message.replace(/^Block /, "Slide "));
            throw error;
         }
         data.slides = slides;
         const kind = data.kind ?? current?.kind;
         if (kind === "cards") data.body = slidesToMarkdown(slides);
      }
   }
   if (entity === "posts" && "tags" in data && data.tags != null) {
      const tags = data.tags;
      if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string")) {
         throw new ContentRuleError("posts.tags must be an array of strings");
      }
   }
   // bknd 0.21 does not apply an enum's default_value before its required check.
   if (mode === "create" && WITH_STATUS.has(entity) && (data.status === undefined || data.status === null)) data.status = "draft";
   if (entity === "site_settings" && "social" in data && data.social != null) {
      const social = data.social;
      const ok = Array.isArray(social) && social.every((x) => !!x && typeof x === "object" && typeof (x as Row).kind === "string" && validHttpsUrl((x as Row).url));
      if (!ok) throw new ContentRuleError("site_settings.social must be a list of { kind, url } with https:// URLs");
   }
   if (entity === "curated_videos") {
      // NULL means "all" everywhere; store it as 'all' so the unique (kind, ref_id, placement, locale)
      // index (migrations/0002) also covers it (SQLite treats NULLs as distinct).
      if (mode === "create" ? data.locale == null : "locale" in data && data.locale == null) data.locale = "all";
      if ("ref_id" in data && (typeof data.ref_id !== "string" || !REF_ID.test(data.ref_id))) {
         throw new ContentRuleError("curated_videos.ref_id must be a videos-platform id");
      }
      if ("snapshot" in data && data.snapshot != null) {
         const snap = data.snapshot as Row;
         const thumb = snap?.thumbnail_url;
         if (typeof snap !== "object" || typeof snap.title !== "string" || (thumb != null && !validHttpsUrl(thumb))) {
            throw new ContentRuleError("curated_videos.snapshot must be { title, thumbnail_url (https or null), channel_name }");
         }
      }
   }
   if (PUBLISHABLE.has(entity)) {
      if ("publish_at" in data) {
         if (data.publish_at === null || data.publish_at === "") data.publish_at = null;
         else {
            const at = timeOf(data.publish_at);
            if (at === null) throw new ContentRuleError("publish_at must be a date and time");
            data.publish_at = new Date(at);
         }
      }
      const status = data.status ?? current?.status ?? (mode === "create" ? "draft" : undefined);
      const firstPublished = timeOf(current?.published_at);
      // Went live = has a first-publish date that has passed. A scheduled row's date is still ahead.
      const wentLive = firstPublished !== null && firstPublished <= now.getTime();
      if (status === "published") {
         // The first-publish date is the go-live time: now, or the schedule (moved with it until then).
         if (!wentLive && !data.published_at) {
            const at = timeOf("publish_at" in data ? data.publish_at : current?.publish_at);
            data.published_at = at !== null ? new Date(at) : now;
         }
      } else if (status === "draft" && "status" in data) {
         // Unpublish / unschedule: no schedule on a draft, and a go-live that never came is forgotten.
         data.publish_at = null;
         if (firstPublished !== null && !wentLive) data.published_at = null;
      }
      // Never clear or move published_at once it has passed (it is the public "first published" date).
      if (wentLive && "published_at" in data) delete data.published_at;
   }
   if (CONTENT.has(entity)) {
      if (mode === "create") data.created_at = now;
      else delete data.created_at;
      data.updated_at = now;
   }
}

/** @param db the D1 binding, for the optimistic-lock compare-and-set (without it, no lock). */
export function contentRulesPlugin(db?: D1Database): AppPlugin {
   return (app) => ({
      name: "aun-content-rules",
      onBuilt: async () => {
         app.emgr.onEvent(
            DatabaseEvents.MutatorInsertBefore,
            (event) => {
               const { entity, data } = event.params as { entity: { name: string }; data: Row };
               applyRules(entity.name, data, "create");
            },
            { mode: "sync", id: "aun-content-insert" },
         );
         app.emgr.onEvent(
            DatabaseEvents.MutatorUpdateBefore,
            async (event) => {
               const { entity, entityId, data } = event.params as { entity: { name: string }; entityId: number | string; data: Row };
               const locked = !!db && CONTENT.has(entity.name) && "updated_at" in data;
               const expected = data.updated_at;
               let current: Row | null = null;
               if (PUBLISHABLE.has(entity.name)) {
                  const { data: row } = await app.em.repo(entity.name).findId(entityId);
                  current = (row ?? null) as Row | null;
               }
               const now = locked ? nextVersion(expected) : new Date();
               applyRules(entity.name, data, "update", current, now);
               if (locked) {
                  // Validate before claiming, so an invalid save does not move updated_at.
                  await (app.em.mutator(entity.name) as unknown as { getValidatedData(d: Row, m: "update"): Promise<unknown> }).getValidatedData({ ...data }, "update");
                  await claimVersion(db!, entity.name, entityId, expected, now);
               }
            },
            { mode: "sync", id: "aun-content-update" },
         );
      },
   });
}
