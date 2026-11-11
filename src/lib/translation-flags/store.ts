/**
 * Translation flags in D1 (migrations/0017, docs/TRANSLATION_FLAGS.md): create, list, resolve, dismiss,
 * reopen, open counts for the lists, and the audit trail. Flags are never deleted: a resolved or
 * dismissed flag is history.
 */
import { alignSource, detectQuran, insideOrnate, makeAnchor, quranUrl, type Anchor, type SourceScope } from "./anchor.ts";

export const REASONS = ["meaning", "term", "islamic_term", "quran_hadith", "grammar", "other"] as const;
export type Reason = (typeof REASONS)[number];
export const isReason = (v: unknown): v is Reason => typeof v === "string" && (REASONS as readonly string[]).includes(v);
/** Reasons whose correction can become a glossary entry. */
export const GLOSSARY_REASONS: Reason[] = ["term", "islamic_term"];

export const RESOLUTIONS = ["applied", "retranslated", "edited", "fixed"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export const isResolution = (v: unknown): v is Resolution => typeof v === "string" && (RESOLUTIONS as readonly string[]).includes(v);

export type FlagStatus = "open" | "resolved" | "dismissed";
export type FlagKind = "pages" | "posts";

export const TEXT_MAX = 2000;
export const NOTE_MAX = 1000;
export const FIELD_TEXT_MAX = 400_000;

export interface Actor {
   id: number | null;
   email: string | null;
}

export interface Flag {
   id: string;
   kind: FlagKind;
   row_id: number;
   locale: string;
   field: string;
   quote: string;
   prefix: string;
   suffix: string;
   start_offset: number;
   end_offset: number;
   source_row_id: number | null;
   source_text: string | null;
   source_scope: SourceScope;
   reason: Reason;
   suggestion: string | null;
   note: string | null;
   quran: number;
   quran_url: string | null;
   status: FlagStatus;
   resolution: string | null;
   created_by: number | null;
   created_by_email: string | null;
   created_at: number;
   resolved_by: number | null;
   resolved_by_email: string | null;
   resolved_at: number | null;
   updated_at: number;
}

export interface FlagEvent {
   id: string;
   flag_id: string;
   at: number;
   user_id: number | null;
   email: string | null;
   action: string;
   detail: unknown;
}

/** `title`, `summary`, `body`, or a card slide's `slide:<id>:heading` / `slide:<id>:body`. */
const FIELD = /^(?:title|summary|body|slide:[A-Za-z0-9_-]{1,64}:(?:heading|body))$/;
export const isField = (v: unknown): v is string => typeof v === "string" && FIELD.test(v);

export function clean(v: unknown, max: number): string | null {
   if (typeof v !== "string") return null;
   const s = v
      .replace(/\r\n?/g, "\n")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .trim();
   return s ? s.slice(0, max) : null;
}

/** The text of a field in a stored row (pages: summary; posts: excerpt; slides from JSON). */
export function fieldText(kind: FlagKind, row: Record<string, unknown> | null, field: string, slideIndex?: number): string {
   if (!row) return "";
   const str = (v: unknown) => (typeof v === "string" ? v : "");
   if (field === "title") return str(row.title);
   if (field === "summary") return str(kind === "pages" ? row.summary : row.excerpt);
   if (field === "body") return str(row.body);
   const m = field.match(/^slide:([^:]+):(heading|body)$/);
   if (!m) return "";
   const slides = parseSlides(row.slides);
   const slide = slideIndex === undefined ? slides.find((s) => s.id === m[1]) : slides[slideIndex];
   return slide ? str(slide[m[2] as "heading" | "body"]) : "";
}

function parseSlides(v: unknown): { id: string; heading: string; body: string }[] {
   try {
      const arr = typeof v === "string" ? JSON.parse(v) : v;
      return Array.isArray(arr) ? arr.filter((s) => s && typeof s === "object") : [];
   } catch {
      return [];
   }
}

/** Index of a slide by id in a stored row (to find the same slide in the other language). */
export function slideIndexOf(row: Record<string, unknown> | null, slideId: string): number {
   return parseSlides(row?.slides).findIndex((s) => s.id === slideId);
}

export interface NewFlag {
   kind: FlagKind;
   rowId: number;
   locale: string;
   field: string;
   /** The field's current text in the editor (it may be unsaved). */
   text: string;
   start: number;
   end: number;
   reason: Reason;
   suggestion: string | null;
   note: string | null;
   /** The editor said it is Qur'an (detection may also say so). */
   quran: boolean;
   source: { rowId: number; text: string } | null;
}

export class FlagError extends Error {
   constructor(
      readonly status: 400 | 403 | 404 | 409,
      readonly code: string,
   ) {
      super(code);
   }
}

const newId = () => crypto.randomUUID();

function eventStmt(db: D1Database, flagId: string, action: string, actor: Actor, at: number, detail?: unknown): D1PreparedStatement {
   return db
      .prepare("INSERT INTO translation_flag_events (id, flag_id, at, user_id, email, action, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(newId(), flagId, at, actor.id, actor.email, action, detail === undefined ? null : JSON.stringify(detail));
}

/** The anchor, the matching source span and the Qur'an check, without saving (also the dialog's preview). */
export function prepareFlag(n: Pick<NewFlag, "text" | "start" | "end" | "quran" | "source">): { anchor: Anchor; source: { text: string; scope: SourceScope }; quran: boolean; quranUrl: string | null } {
   const anchor = makeAnchor(n.text, n.start, n.end);
   if (!anchor) throw new FlagError(400, "bad_selection");
   const source = n.source ? alignSource(n.text, anchor, n.source.text) : { text: "", scope: "none" as SourceScope };
   // Only the source text that is about the span counts (a paragraph may quote an ayah elsewhere).
   const near = source.scope === "sentence" || source.scope === "field" ? source.text : "";
   const detected = detectQuran(anchor.quote, near);
   const quran = n.quran || detected.quran || insideOrnate(n.text, anchor);
   return { anchor, source, quran, quranUrl: quran ? quranUrl(detected.ref, near || anchor.quote) : null };
}

export async function createFlag(db: D1Database, n: NewFlag, actor: Actor, now: number): Promise<Flag> {
   const p = prepareFlag(n);
   const id = newId();
   await db.batch([
      db
         .prepare(
            `INSERT INTO translation_flags (id, kind, row_id, locale, field, quote, prefix, suffix, start_offset, end_offset, source_row_id, source_text, source_scope,
               reason, suggestion, note, quran, quran_url, status, created_by, created_by_email, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, 'open', ?19, ?20, ?21, ?21)`,
         )
         .bind(
            id,
            n.kind,
            n.rowId,
            n.locale,
            n.field,
            p.anchor.quote,
            p.anchor.prefix,
            p.anchor.suffix,
            p.anchor.start,
            p.anchor.end,
            n.source?.rowId ?? null,
            p.source.text || null,
            p.source.scope,
            n.reason,
            n.suggestion,
            n.note,
            p.quran ? 1 : 0,
            p.quranUrl,
            actor.id,
            actor.email,
            now,
         ),
      eventStmt(db, id, "created", actor, now, { reason: n.reason, quote: p.anchor.quote, field: n.field, ...(n.suggestion ? { suggestion: n.suggestion } : {}) }),
   ]);
   return (await getFlag(db, id))!;
}

export async function getFlag(db: D1Database, id: string): Promise<Flag | null> {
   return db.prepare("SELECT * FROM translation_flags WHERE id = ?1").bind(id).first<Flag>();
}

/** A row's flags (open first, then history, newest first) with their events. */
export async function flagsOf(db: D1Database, kind: FlagKind, rowId: number): Promise<(Flag & { events: FlagEvent[] })[]> {
   const [flags, events] = await db.batch([
      db.prepare("SELECT * FROM translation_flags WHERE kind = ?1 AND row_id = ?2 ORDER BY status = 'open' DESC, created_at DESC LIMIT 500").bind(kind, rowId),
      db
         .prepare(
            `SELECT e.* FROM translation_flag_events e JOIN translation_flags f ON f.id = e.flag_id
             WHERE f.kind = ?1 AND f.row_id = ?2 ORDER BY e.at ASC LIMIT 2000`,
         )
         .bind(kind, rowId),
   ]);
   const byFlag = new Map<string, FlagEvent[]>();
   for (const e of (events.results ?? []) as (FlagEvent & { detail: string | null })[]) {
      let detail: unknown;
      try {
         detail = e.detail ? JSON.parse(e.detail) : null;
      } catch {
         detail = null;
      }
      byFlag.set(e.flag_id, [...(byFlag.get(e.flag_id) ?? []), { ...e, detail }]);
   }
   return ((flags.results ?? []) as Flag[]).map((f) => ({ ...f, events: byFlag.get(f.id) ?? [] }));
}

async function setStatus(db: D1Database, id: string, from: FlagStatus[], to: FlagStatus, resolution: string | null, actor: Actor, now: number, action: string, detail?: unknown): Promise<Flag> {
   const flag = await getFlag(db, id);
   if (!flag) throw new FlagError(404, "not_found");
   if (!from.includes(flag.status)) throw new FlagError(409, "wrong_state");
   const closing = to !== "open";
   await db.batch([
      db
         .prepare(
            `UPDATE translation_flags SET status = ?2, resolution = ?3, resolved_by = ?4, resolved_by_email = ?5, resolved_at = ?6, updated_at = ?7
             WHERE id = ?1 AND status = ?8`,
         )
         .bind(id, to, resolution, closing ? actor.id : null, closing ? actor.email : null, closing ? now : null, now, flag.status),
      eventStmt(db, id, action, actor, now, detail),
   ]);
   return (await getFlag(db, id))!;
}

/** Resolved (kept as history). `text` is what replaced the span, when the fix replaced it. */
export function resolveFlag(db: D1Database, id: string, resolution: Resolution, text: string | null, actor: Actor, now: number): Promise<Flag> {
   return setStatus(db, id, ["open"], "resolved", resolution, actor, now, "resolved", { resolution, ...(text !== null ? { text } : {}) });
}

export function dismissFlag(db: D1Database, id: string, note: string | null, actor: Actor, now: number): Promise<Flag> {
   return setStatus(db, id, ["open"], "dismissed", "dismissed", actor, now, "dismissed", note ? { note } : undefined);
}

export function reopenFlag(db: D1Database, id: string, actor: Actor, now: number): Promise<Flag> {
   return setStatus(db, id, ["resolved", "dismissed"], "open", null, actor, now, "reopened");
}

export async function logFlagEvent(db: D1Database, id: string, action: string, actor: Actor, now: number, detail?: unknown): Promise<void> {
   await eventStmt(db, id, action, actor, now, detail).run();
}

/** Open flags per row, for the list badges. */
export async function openCounts(db: D1Database, kind: FlagKind, ids: number[]): Promise<Map<number, number>> {
   const out = new Map<number, number>();
   const list = ids.filter((n) => Number.isInteger(n) && n > 0).slice(0, 200);
   if (!list.length) return out;
   const { results } = await db
      .prepare(`SELECT row_id, COUNT(*) AS n FROM translation_flags WHERE kind = ?1 AND status = 'open' AND row_id IN (${list.map((_, i) => `?${i + 2}`).join(",")}) GROUP BY row_id`)
      .bind(kind, ...list)
      .all<{ row_id: number; n: number }>();
   for (const r of results ?? []) out.set(Number(r.row_id), Number(r.n));
   return out;
}
