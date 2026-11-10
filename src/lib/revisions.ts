/**
 * Content history (issue #8). Every create, update and restore of a page or post writes one row to
 * `content_revisions` (migrations/0004): who, when, the full row as saved, and which fields changed
 * since the previous revision. Restoring is an ordinary update through the same optimistic lock
 * (src/lib/content-rules.ts), so it is recorded like any other save.
 *
 * Who: bknd's mutator events carry no request, so the Worker runs each staff write inside
 * `withActor()` (an AsyncLocalStorage context) and the revisions plugin reads it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { DatabaseEvents, type AppPlugin } from "bknd";

export const REVISIONED = new Set(["pages", "posts"]);
export type RevisionedEntity = "pages" | "posts";
export type RevisionAction = "create" | "update" | "restore";
export const REVISIONS_PAGE = 20;

export interface Actor {
   id: number | string | null;
   email: string | null;
   /** Set by the restore endpoint: the revision being restored. */
   restoredFrom?: number;
}

const actors = new AsyncLocalStorage<Actor>();
export const withActor = <T>(actor: Actor, fn: () => T): T => actors.run(actor, fn);
export const currentActor = (): Actor | undefined => actors.getStore();

/** Fields compared between revisions (timestamps and ids are bookkeeping, not edits). */
const IGNORED = new Set(["id", "created_at", "updated_at"]);

/** Fields a restore writes back. Status, schedule, language and translation link stay as they are. */
export const RESTORABLE: Record<RevisionedEntity, string[]> = {
   pages: ["title", "slug", "summary", "body", "seo_title", "seo_description", "show_in_sitemap"],
   posts: ["title", "slug", "excerpt", "body", "author_name", "tags", "seo_title", "seo_description"],
};

type Row = Record<string, unknown>;

/** A stable form for comparison: JSON strings parsed, dates as ISO, empty string = null. */
export function normalizeValue(v: unknown): unknown {
   if (v === undefined || v === "") return null;
   if (v instanceof Date) return v.toISOString();
   if (typeof v === "string" && (v.startsWith("[") || v.startsWith("{"))) {
      try {
         return JSON.parse(v);
      } catch {
         return v;
      }
   }
   return v;
}

const same = (a: unknown, b: unknown) => {
   const x = normalizeValue(a);
   const y = normalizeValue(b);
   const bool = (v: unknown) => (v === true || v === 1 ? true : v === false || v === 0 ? false : v);
   return JSON.stringify(bool(x)) === JSON.stringify(bool(y));
};

/** Fields that differ between two snapshots (all non-empty fields when there is no previous one). */
export function changedFields(prev: Row | null, next: Row): string[] {
   const keys = new Set([...Object.keys(next), ...Object.keys(prev ?? {})]);
   const out: string[] = [];
   for (const k of keys) {
      if (IGNORED.has(k)) continue;
      if (prev ? !same(prev[k], next[k]) : normalizeValue(next[k]) !== null) out.push(k);
   }
   return out.sort();
}

export function serializeRow(row: Row): string {
   const out: Row = {};
   for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
   return JSON.stringify(out);
}

export interface Revision {
   id: number;
   entity: RevisionedEntity;
   entity_id: number;
   version: number;
   action: RevisionAction;
   actor_id: number | null;
   actor_email: string | null;
   restored_from: number | null;
   changed: string[];
   snapshot: Row;
   created_at: string;
}

type RawRevision = Omit<Revision, "changed" | "snapshot"> & { changed: string | null; snapshot: string };

function parse(r: RawRevision): Revision {
   let snapshot: Row = {};
   let changed: string[] = [];
   try {
      snapshot = JSON.parse(r.snapshot) as Row;
   } catch {
      /* unreadable snapshot: shown empty */
   }
   try {
      changed = r.changed ? (JSON.parse(r.changed) as string[]) : [];
   } catch {
      /* keep [] */
   }
   return { ...r, changed, snapshot };
}

/**
 * Appends a revision. The version is taken in the same statement (max + 1), and the unique
 * (entity, entity_id, version) index makes a lost race fail instead of writing a duplicate;
 * one retry covers it.
 */
export async function recordRevision(db: D1Database, entity: RevisionedEntity, row: Row, action: RevisionAction, actor: Actor | undefined, now = new Date()): Promise<void> {
   const id = Number(row.id);
   if (!Number.isFinite(id)) return;
   for (let attempt = 0; ; attempt++) {
      try {
         const prev = await db
            .prepare("SELECT snapshot FROM content_revisions WHERE entity = ?1 AND entity_id = ?2 ORDER BY version DESC LIMIT 1")
            .bind(entity, id)
            .first<{ snapshot: string }>();
         let prevRow: Row | null = null;
         try {
            prevRow = prev ? (JSON.parse(prev.snapshot) as Row) : null;
         } catch {
            prevRow = null;
         }
         const changed = changedFields(prevRow, row);
         await db
            .prepare(
               `INSERT INTO content_revisions (entity, entity_id, version, action, actor_id, actor_email, restored_from, changed, snapshot, created_at)
                SELECT ?1, ?2, coalesce(max(version), 0) + 1, ?3, ?4, ?5, ?6, ?7, ?8, ?9 FROM content_revisions WHERE entity = ?1 AND entity_id = ?2`,
            )
            .bind(
               entity,
               id,
               action,
               actor?.id === null || actor?.id === undefined ? null : Number(actor.id),
               actor?.email ?? null,
               actor?.restoredFrom ?? null,
               JSON.stringify(changed),
               serializeRow(row),
               now.toISOString(),
            )
            .run();
         return;
      } catch (error) {
         if (attempt >= 2 || !/UNIQUE/i.test(String(error))) throw error;
      }
   }
}

export async function listRevisions(db: D1Database, entity: RevisionedEntity, id: number, page: number, size = REVISIONS_PAGE): Promise<{ items: Revision[]; total: number }> {
   const [count, rows] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS n FROM content_revisions WHERE entity = ?1 AND entity_id = ?2").bind(entity, id).first<{ n: number }>(),
      db
         .prepare("SELECT * FROM content_revisions WHERE entity = ?1 AND entity_id = ?2 ORDER BY version DESC LIMIT ?3 OFFSET ?4")
         .bind(entity, id, size, (page - 1) * size)
         .all<RawRevision>(),
   ]);
   return { items: rows.results.map(parse), total: Number(count?.n ?? 0) };
}

export async function getRevision(db: D1Database, revId: number): Promise<Revision | null> {
   const r = await db.prepare("SELECT * FROM content_revisions WHERE id = ?1").bind(revId).first<RawRevision>();
   return r ? parse(r) : null;
}

/** The revision just before `rev` for the same row (what its diff is against). */
export async function previousRevision(db: D1Database, rev: Revision): Promise<Revision | null> {
   const r = await db
      .prepare("SELECT * FROM content_revisions WHERE entity = ?1 AND entity_id = ?2 AND version < ?3 ORDER BY version DESC LIMIT 1")
      .bind(rev.entity, rev.entity_id, rev.version)
      .first<RawRevision>();
   return r ? parse(r) : null;
}

export type DiffLine = { op: "same" | "add" | "del"; text: string };

/** Line diff (LCS) for long text fields; unchanged runs are kept for context by the screen. */
export function lineDiff(before: string, after: string, maxLines = 1500): DiffLine[] {
   const a = before.split("\n");
   const b = after.split("\n");
   if (a.length > maxLines || b.length > maxLines) {
      return [...a.map((text) => ({ op: "del" as const, text })), ...b.map((text) => ({ op: "add" as const, text }))];
   }
   const n = a.length;
   const m = b.length;
   const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
   for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
   const out: DiffLine[] = [];
   let i = 0;
   let j = 0;
   while (i < n && j < m) {
      if (a[i] === b[j]) {
         out.push({ op: "same", text: a[i] });
         i++;
         j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ op: "del", text: a[i++] });
      else out.push({ op: "add", text: b[j++] });
   }
   while (i < n) out.push({ op: "del", text: a[i++] });
   while (j < m) out.push({ op: "add", text: b[j++] });
   return out;
}

/** bknd plugin: a revision after every insert and update of a page or post. */
export function revisionsPlugin(db?: D1Database): AppPlugin {
   return (app) => ({
      name: "aun-revisions",
      onBuilt: async () => {
         if (!db) return;
         const write = async (entity: string, row: unknown, action: "create" | "update") => {
            if (!REVISIONED.has(entity) || !row || typeof row !== "object") return;
            const actor = currentActor();
            try {
               await recordRevision(db, entity as RevisionedEntity, row as Row, actor?.restoredFrom ? "restore" : action, actor);
            } catch (error) {
               // The save itself is committed; a missing revision must not turn it into an error.
               console.error("revision write failed", entity, String((row as Row).id), String(error));
            }
         };
         app.emgr.onEvent(
            DatabaseEvents.MutatorInsertAfter,
            async (event) => {
               const { entity, data } = event.params as { entity: { name: string }; data: unknown };
               await write(entity.name, data, "create");
            },
            { mode: "sync", id: "aun-revisions-insert" },
         );
         app.emgr.onEvent(
            DatabaseEvents.MutatorUpdateAfter,
            async (event) => {
               const { entity, data } = event.params as { entity: { name: string }; data: unknown };
               await write(entity.name, data, "update");
            },
            { mode: "sync", id: "aun-revisions-update" },
         );
      },
   });
}
