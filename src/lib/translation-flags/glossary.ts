/**
 * The translation glossary (migrations/0017, docs/TRANSLATION_FLAGS.md §4): preferred renderings of terms,
 * per language pair. Machine translation includes the entries whose source term occurs in the text being
 * translated (src/lib/ai/runner.ts), and so does "Re-translate selection".
 *
 * Soft delete: a deleted entry stops being used at once, can be restored for RETENTION_DAYS, and is then
 * purged by the 30-minute cron (purgeGlossary).
 */
import type { Locale } from "../ai/prompts.ts";
import type { Actor } from "./store.ts";

export const TERM_MAX = 200;
export const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
/** Entries a prompt may carry (the ones whose term occurs in the text, longest first). */
export const PROMPT_MAX = 60;

export interface GlossaryEntry {
   id: string;
   source_locale: Locale;
   source_term: string;
   target_locale: Locale;
   target_term: string;
   note: string | null;
   flag_id: string | null;
   created_by_email: string | null;
   created_at: number;
   updated_at: number;
   deleted_at: number | null;
   deleted_by_email: string | null;
}

export class GlossaryError extends Error {
   constructor(
      readonly status: 400 | 404 | 409,
      readonly code: string,
   ) {
      super(code);
   }
}

const other = (l: Locale): Locale => (l === "en" ? "ar" : "en");

/** Lower-cased, tashkeel and tatweel removed, whitespace collapsed: how terms are compared. */
export function termKey(s: string): string {
   return s
      .normalize("NFC")
      .replace(/[ً-ٰٟـ]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
}

export async function addEntry(
   db: D1Database,
   e: { sourceLocale: Locale; sourceTerm: string; targetTerm: string; note: string | null; flagId: string | null },
   actor: Actor,
   now: number,
): Promise<GlossaryEntry> {
   const source = e.sourceTerm.trim().slice(0, TERM_MAX);
   const target = e.targetTerm.trim().slice(0, TERM_MAX);
   if (!source || !target) throw new GlossaryError(400, "required");
   const pair = await db
      .prepare("SELECT id, source_term FROM translation_glossary WHERE source_locale = ?1 AND target_locale = ?2 AND deleted_at IS NULL")
      .bind(e.sourceLocale, other(e.sourceLocale))
      .all<{ id: string; source_term: string }>();
   const dup = (pair.results ?? []).find((r) => termKey(r.source_term) === termKey(source));
   if (dup) throw new GlossaryError(409, "exists");
   const id = crypto.randomUUID();
   await db
      .prepare(
         `INSERT INTO translation_glossary (id, source_locale, source_term, target_locale, target_term, note, flag_id, created_by, created_by_email, created_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)`,
      )
      .bind(id, e.sourceLocale, source, other(e.sourceLocale), target, e.note, e.flagId, actor.id, actor.email, now)
      .run();
   return (await getEntry(db, id))!;
}

export async function getEntry(db: D1Database, id: string): Promise<GlossaryEntry | null> {
   return db.prepare("SELECT * FROM translation_glossary WHERE id = ?1").bind(id).first<GlossaryEntry>();
}

/** Live entries (or the deleted ones), filtered by a search over both terms; newest first. */
export async function listEntries(db: D1Database, o: { q?: string; deleted?: boolean; limit?: number } = {}): Promise<GlossaryEntry[]> {
   const q = (o.q ?? "").trim().slice(0, 100);
   const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
   const { results } = await db
      .prepare(
         `SELECT * FROM translation_glossary WHERE ${o.deleted ? "deleted_at IS NOT NULL" : "deleted_at IS NULL"}
          AND (?1 = '' OR source_term LIKE ?2 ESCAPE '\\' OR target_term LIKE ?2 ESCAPE '\\')
          ORDER BY ${o.deleted ? "deleted_at" : "updated_at"} DESC LIMIT ?3`,
      )
      .bind(q, like, Math.min(Math.max(o.limit ?? 200, 1), 500))
      .all<GlossaryEntry>();
   return results ?? [];
}

export async function deleteEntry(db: D1Database, id: string, actor: Actor, now: number): Promise<void> {
   const res = await db.prepare("UPDATE translation_glossary SET deleted_at = ?2, deleted_by_email = ?3, updated_at = ?2 WHERE id = ?1 AND deleted_at IS NULL").bind(id, now, actor.email).run();
   if (res.meta.changes !== 1) throw new GlossaryError(404, "not_found");
}

export async function restoreEntry(db: D1Database, id: string, now: number): Promise<GlossaryEntry> {
   const e = await getEntry(db, id);
   if (!e || e.deleted_at === null) throw new GlossaryError(404, "not_found");
   const live = await listEntries(db, { q: e.source_term, limit: 50 });
   if (live.some((x) => x.source_locale === e.source_locale && termKey(x.source_term) === termKey(e.source_term))) throw new GlossaryError(409, "exists");
   await db.prepare("UPDATE translation_glossary SET deleted_at = NULL, deleted_by_email = NULL, updated_at = ?2 WHERE id = ?1").bind(id, now).run();
   return (await getEntry(db, id))!;
}

/** The cleanup: entries deleted RETENTION_DAYS ago are removed for good. */
export async function purgeGlossary(db: D1Database, now: number): Promise<number> {
   const res = await db.prepare("DELETE FROM translation_glossary WHERE deleted_at IS NOT NULL AND deleted_at < ?1").bind(now - RETENTION_MS).run();
   return res.meta.changes ?? 0;
}

/** The live entries for a language pair whose source term occurs in `text` (longest terms first). */
export async function entriesFor(db: D1Database, from: Locale, text: string): Promise<GlossaryEntry[]> {
   let rows: GlossaryEntry[];
   try {
      const res = await db
         .prepare("SELECT * FROM translation_glossary WHERE source_locale = ?1 AND target_locale = ?2 AND deleted_at IS NULL ORDER BY length(source_term) DESC LIMIT 2000")
         .bind(from, other(from))
         .all<GlossaryEntry>();
      rows = res.results ?? [];
   } catch {
      // No glossary table yet (the migration not applied): translate without one.
      return [];
   }
   const hay = termKey(text);
   return rows.filter((r) => hay.includes(termKey(r.source_term))).slice(0, PROMPT_MAX);
}

/** A version of the pair's glossary (part of the translation dedupe key: an edit means a fresh translation). */
export async function glossaryVersion(db: D1Database, from: Locale): Promise<string> {
   try {
      const r = await db.prepare("SELECT COUNT(*) AS n, MAX(updated_at) AS at FROM translation_glossary WHERE source_locale = ?1").bind(from).first<{ n: number; at: number | null }>();
      return `${r?.n ?? 0}:${r?.at ?? 0}`;
   } catch {
      return "0:0";
   }
}

/** The prompt section for the entries (empty when there are none). */
export function glossaryPrompt(entries: Pick<GlossaryEntry, "source_term" | "target_term" | "note">[]): string {
   if (!entries.length) return "";
   const lines = entries.map((e) => `- ${e.source_term} → ${e.target_term}${e.note ? ` (${e.note.slice(0, 120)})` : ""}`);
   return `Glossary: the publication's editors chose these renderings. Use them wherever the term occurs (inflect them as the sentence needs):\n${lines.join("\n")}`;
}
