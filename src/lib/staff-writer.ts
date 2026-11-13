/**
 * Staff writers (auth "Writer" → CMS role "staff_writer"; owner decision SS18, 2026-11-13): they write
 * and edit Al Ummah Now's OWN posts in the CMS editor, the posts with no scholar author
 * (`author_sub IS NULL`, so never a scholar post or a scholar post reference). Not pages, navigation,
 * site settings, the timeline, featuring, scholars, people or deletes. Scholars write in Studio
 * (their CMS role "writer": docs/SCHOLARS.md §7).
 *
 * Two layers, as for scholars: this wrapper (screens and bknd API calls) and the content rules
 * (src/lib/scholars/ownership.ts applyOwnership), which check every insert and update.
 */
import { scopeWhereStaff } from "./scholars/ownership.ts";

type Verdict = { kind: "allow" } | { kind: "deny" } | { kind: "scope-list" } | { kind: "scope-count" } | { kind: "staff-post"; id: number };

const SCREENS: RegExp[] = [
   /^\/$/,
   /^\/posts\/?$/,
   /^\/posts\/new\/?$/,
   /^\/posts\/\d{1,12}\/?$/,
   /^\/posts\/\d{1,12}\/history\/?$/,
   /^\/library\/?$/,
   /^\/admin\/api\/suggest\/?$/,
   /^\/admin\/api\/ai(\/.*)?$/,
   /^\/admin\/api\/translation-flags(\/.*)?$/,
   /^\/admin\/api\/revisions\/\d{1,12}\/restore\/?$/,
   /^\/admin\/api\/media\/\d{1,12}\/alt\/?$/,
   /^\/picker\/api\/.+$/,
   /^\/preview\/posts\/\d{1,12}\/?$/,
];

/** Screens and Worker endpoints a staff writer may open. Pure; unit-tested. */
export function staffWriterScreenAllowed(_method: string, path: string): boolean {
   return SCREENS.some((re) => re.test(path));
}

/** What a staff writer may do on bknd's API. Pure; unit-tested. */
export function staffWriterApiVerdict(method: string, path: string): Verdict {
   const read = method === "GET" || method === "HEAD";
   if (path === "/api/auth/me" || path === "/api/auth/strategies") return read ? { kind: "allow" } : { kind: "deny" };
   if (path === "/api/system/schema" || path.startsWith("/api/system/schema/")) return read ? { kind: "allow" } : { kind: "deny" };
   if (/^\/api\/data\/entity\/posts\/?$/.test(path)) return read ? { kind: "scope-list" } : method === "POST" ? { kind: "allow" } : { kind: "deny" };
   if (/^\/api\/data\/entity\/posts\/fn\/count\/?$/.test(path)) return method === "POST" || read ? { kind: "scope-count" } : { kind: "deny" };
   const one = /^\/api\/data\/entity\/posts\/(\d{1,12})\/?$/.exec(path);
   // No deletes (like editors): only reads and edits, of Al Ummah Now's own posts
   if (one && (read || method === "PATCH" || method === "PUT")) return { kind: "staff-post", id: Number(one[1]) };
   const cover = /^\/api\/media\/entity\/posts\/(\d{1,12})\/cover\/?$/.exec(path);
   if (cover && method === "POST") return { kind: "staff-post", id: Number(cover[1]) };
   if (/^\/api\/data\/entity\/media(\/\d{1,12})?\/?$/.test(path) && read) return { kind: "allow" };
   if (path.startsWith("/api/media/upload") && method === "POST") return { kind: "allow" };
   if (/^\/api\/media\/file\/[^/]+$/.test(path) && read) return { kind: "allow" };
   if (path === "/api/media/files" && read) return { kind: "allow" };
   return { kind: "deny" };
}

/** A posts list URL limited to Al Ummah Now's own posts (author_sub IS NULL). */
export function scopeStaffListUrl(url: URL): URL {
   const out = new URL(url);
   let where: Record<string, unknown> = {};
   const raw = out.searchParams.get("where");
   if (raw) {
      try {
         const parsed = JSON.parse(raw) as unknown;
         if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) where = parsed as Record<string, unknown>;
      } catch {
         where = {};
      }
   }
   out.searchParams.set("where", JSON.stringify(scopeWhereStaff(where)));
   return out;
}

/** Whether a post is Al Ummah Now's own (no scholar author); undefined when there is no such post. */
export async function isStaffPost(db: D1Database, postId: number): Promise<boolean | undefined> {
   const row = await db.prepare("SELECT author_sub, ref_post_id FROM posts WHERE id = ?1").bind(postId).first<{ author_sub: string | null; ref_post_id: string | null }>();
   if (!row) return undefined;
   return !row.author_sub && !row.ref_post_id;
}
