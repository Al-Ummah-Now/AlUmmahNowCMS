/**
 * bknd plugin: content rules that must hold however a row is written (admin UI, data API, picker).
 * - created_at / updated_at on every content entity (CONTENT_ENTITIES).
 * - `published_at` is set on first publish and never cleared (pages, posts).
 * - nav_items.url is a www-relative path ("/…", not "//") or an absolute https URL.
 * - the page slug "home" is reserved (www's home page is not a CMS page).
 * - posts.tags is an array of strings.
 *
 * bknd limitation (0.21.0): a listener's *returned* data is validated with `entity.isValidData`,
 * and JsonField.isValid(undefined) is false, so any return on an entity with a JSON field whose
 * value isn't in the payload is discarded (bknd's own timestamps plugin silently does nothing on
 * posts/curated_videos/site_settings). Workaround: mutate `event.params.data` IN PLACE and return
 * nothing — the mutator then uses that same object (`returned ? params.data : data`).
 */
import { DatabaseEvents, type AppPlugin } from "bknd";
import { CONTENT_ENTITIES } from "../schema.ts";

const CONTENT = new Set<string>(CONTENT_ENTITIES);
const PUBLISHABLE = new Set(["pages", "posts"]);
const WITH_STATUS = new Set(["pages", "posts", "nav_items", "curated_videos"]);

export class ContentRuleError extends Error {
   readonly status = 400;
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

type Row = Record<string, unknown>;

/** Applies the rules to `data` in place. `current` is the stored row for updates. */
export function applyRules(entity: string, data: Row, mode: "create" | "update", current?: Row | null, now = new Date()): void {
   if (entity === "nav_items" && "url" in data && !validNavUrl(data.url)) {
      throw new ContentRuleError('nav_items.url must be a relative "/…" path or an https:// URL');
   }
   if (entity === "pages" && typeof data.slug === "string" && data.slug.trim().toLowerCase() === "home") {
      throw new ContentRuleError('The page slug "home" is reserved');
   }
   if (entity === "posts" && "tags" in data && data.tags != null) {
      const tags = data.tags;
      if (!Array.isArray(tags) || tags.some((t) => typeof t !== "string")) {
         throw new ContentRuleError("posts.tags must be an array of strings");
      }
   }
   // bknd 0.21 does not apply an enum's default_value before its required check.
   if (mode === "create" && WITH_STATUS.has(entity) && (data.status === undefined || data.status === null)) data.status = "draft";
   if (PUBLISHABLE.has(entity)) {
      const status = data.status ?? current?.status ?? (mode === "create" ? "draft" : undefined);
      const alreadyPublished = current?.published_at != null && current.published_at !== "";
      if (status === "published" && !alreadyPublished && !data.published_at) data.published_at = now;
      // Never clear or move published_at once set (it is the public "first published" date).
      if (alreadyPublished && "published_at" in data) delete data.published_at;
   }
   if (CONTENT.has(entity)) {
      if (mode === "create") data.created_at = now;
      else delete data.created_at;
      data.updated_at = now;
   }
}

export function contentRulesPlugin(): AppPlugin {
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
               let current: Row | null = null;
               if (PUBLISHABLE.has(entity.name)) {
                  const { data: row } = await app.em.repo(entity.name).findId(entityId);
                  current = (row ?? null) as Row | null;
               }
               applyRules(entity.name, data, "update", current);
            },
            { mode: "sync", id: "aun-content-update" },
         );
      },
   });
}
