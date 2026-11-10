/**
 * Scholar posts belong to their author (docs/SCHOLARS.md §2). A writer (auth "Scholar") may read,
 * create, edit, publish, unpublish and delete only posts whose `author_sub` is their own auth user id.
 *
 * Two layers, so neither alone has to be perfect:
 *   1. The Worker wrapper (src/index.ts) scopes a writer's bknd API calls: lists and counts of posts
 *      get `author_sub = <sub>` added to their filter, one-row reads and writes of a post they don't
 *      own answer 404, and everything that is not posts or media is refused.
 *   2. The content rules (src/lib/content-rules.ts) run on every insert and update, however the row
 *      is written: Worker-owned fields (PROTECTED) are stripped from every data API write, a writer's
 *      new post gets their `author_sub`, and an update by a writer of someone else's post is refused.
 */
import { Exception } from "bknd";
import { currentActor } from "../revisions.ts";

/** Set by the Worker only (featuring, the community sync, ownership). Never from a data API write. */
export const PROTECTED_POST_FIELDS = ["author_sub", "featured_at", "featured_by", "community_post_id"] as const;

/** 404 for a writer touching a post that is not theirs (bknd serializes an Exception with its code). */
export class NotOwnerError extends Exception {
   constructor() {
      super("Not found", 404);
      this.name = "NotOwnerError";
   }
}

type Row = Record<string, unknown>;

/** The auth user id (`users.sso_sub`) of a bknd user id. */
export async function subOfUser(db: D1Database, userId: number | string | null | undefined): Promise<string | null> {
   if (userId === null || userId === undefined || userId === "") return null;
   const row = await db.prepare("SELECT sso_sub FROM users WHERE id = ?1").bind(Number(userId)).first<{ sso_sub: string | null }>();
   return row?.sso_sub ?? null;
}

/** `author_sub` of a post; undefined when there is no such post. */
export async function postAuthor(db: D1Database, postId: number): Promise<string | null | undefined> {
   const row = await db.prepare("SELECT author_sub FROM posts WHERE id = ?1").bind(postId).first<{ author_sub: string | null }>();
   return row ? (row.author_sub ?? null) : undefined;
}

/**
 * The ownership rule for one posts write (called by the content rules before bknd writes).
 * `current` is the stored row on update. Mutates `data` in place.
 */
export async function applyOwnership(db: D1Database | undefined, entity: string, data: Row, mode: "create" | "update", current?: Row | null): Promise<void> {
   if (entity !== "posts") return;
   const actor = currentActor();
   if (actor?.system) return;
   for (const k of PROTECTED_POST_FIELDS) delete data[k];
   if (actor?.role !== "writer") return;
   // The home timeline switch is staff's (featuring decides what a scholar post shows on the main site).
   delete data.show_on_timeline;
   if (!db) throw new NotOwnerError();
   const sub = actor.sub ?? (await subOfUser(db, actor.id));
   if (!sub) throw new NotOwnerError();
   if (mode === "create") {
      data.author_sub = sub;
      return;
   }
   if (!current || current.author_sub !== sub) throw new NotOwnerError();
}

export type WriterVerdict =
   | { kind: "allow" }
   | { kind: "deny" }
   | { kind: "scope-list" }
   | { kind: "scope-count" }
   | { kind: "own-post"; id: number }
   | { kind: "create-post" };

/**
 * What a writer may do on bknd's API (`/api/*`, after the wrapper's own blocks). Pure; unit-tested.
 * Posts: list and count are scoped to their own rows, one row needs ownership, create is allowed
 * (the content rules stamp the author). Media: read, list and upload. Session reads. Nothing else.
 */
export function writerApiVerdict(method: string, path: string): WriterVerdict {
   const read = method === "GET" || method === "HEAD";
   if (path === "/api/auth/me" || path === "/api/auth/strategies") return read ? { kind: "allow" } : { kind: "deny" };
   if (path === "/api/system/schema" || path.startsWith("/api/system/schema/")) return read ? { kind: "allow" } : { kind: "deny" };
   if (/^\/api\/data\/entity\/posts\/?$/.test(path)) {
      if (read) return { kind: "scope-list" };
      if (method === "POST") return { kind: "create-post" };
      return { kind: "deny" };
   }
   if (/^\/api\/data\/entity\/posts\/fn\/count\/?$/.test(path)) return method === "POST" || read ? { kind: "scope-count" } : { kind: "deny" };
   const one = /^\/api\/data\/entity\/posts\/(\d{1,12})\/?$/.exec(path);
   if (one && (read || method === "PATCH" || method === "PUT" || method === "DELETE")) return { kind: "own-post", id: Number(one[1]) };
   const cover = /^\/api\/media\/entity\/posts\/(\d{1,12})\/cover\/?$/.exec(path);
   if (cover && method === "POST") return { kind: "own-post", id: Number(cover[1]) };
   if (/^\/api\/data\/entity\/media(\/\d{1,12})?\/?$/.test(path) && read) return { kind: "allow" };
   if (path.startsWith("/api/media/upload") && method === "POST") return { kind: "allow" };
   if (/^\/api\/media\/file\/[^/]+$/.test(path) && read) return { kind: "allow" };
   if (path === "/api/media/files" && read) return { kind: "allow" };
   return { kind: "deny" };
}

/** A posts list URL with the writer's own rows only: `author_sub` is forced into the `where` filter. */
export function scopeListUrl(url: URL, sub: string): URL {
   const out = new URL(url);
   let where: Row = {};
   const raw = out.searchParams.get("where");
   if (raw) {
      try {
         const parsed = JSON.parse(raw) as unknown;
         if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) where = parsed as Row;
      } catch {
         where = {};
      }
   }
   out.searchParams.set("where", JSON.stringify(scopeWhere(where, sub)));
   return out;
}

/**
 * A where filter limited to `author_sub = sub`. bknd joins a top-level `$or` to its siblings with OR,
 * so an `$or` from the caller is dropped rather than trusted to stay inside the scope.
 */
export function scopeWhere(where: Row, sub: string): Row {
   const out: Row = {};
   for (const [k, v] of Object.entries(where)) if (!k.startsWith("$")) out[k] = v;
   out.author_sub = sub;
   return out;
}
