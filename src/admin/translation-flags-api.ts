/**
 * Translation flags and the glossary (docs/TRANSLATION_FLAGS.md). Mounted behind the session gate and the
 * same-origin check (src/index.ts).
 *
 * /admin/api/translation-flags
 *   GET  /?kind=&id=          a row's flags (open first, then history) with their audit events
 *   POST /preview             { kind, id, field, text, start, end } → the source span and Qur'an check
 *   POST /                    { kind, id, field, text, start, end, reason, suggestion?, note?, quran? } → 201 { flag }
 *   POST /:id/resolve         { resolution: applied|retranslated|edited|fixed, text? }
 *   POST /:id/dismiss         { note? }
 *   POST /:id/reopen
 *   POST /:id/alternatives    { text } → { alternatives } (AI; never for Qur'an)
 *   POST /:id/glossary        { sourceTerm, targetTerm, note? } → 201 { entry }
 *
 * /admin/api/glossary
 *   GET  /?q=&deleted=1       entries (opens with content: an empty q lists the newest)
 *   POST /                    { sourceLocale, sourceTerm, targetTerm, note? }
 *   DELETE /:id               soft delete (admins)
 *   POST /:id/restore         (admins)
 *
 * Roles: editors and admins flag, resolve and use the glossary; a scholar (writer) flags their own posts
 * and sees the flags on them, but does not resolve, dismiss or edit the glossary.
 */
import { Hono } from "hono";
import type { AppEnv, Ctx, Deps } from "../types.ts";
import { aiReady } from "../lib/ai/router.ts";
import { errText, log } from "../lib/log.ts";
import { subOfUser } from "../lib/scholars/ownership.ts";
import { addEntry, deleteEntry, GlossaryError, listEntries, restoreEntry, TERM_MAX } from "../lib/translation-flags/glossary.ts";
import { retranslate } from "../lib/translation-flags/retranslate.ts";
import { isTestAccount } from "../lib/slug-suggest.ts";
import {
   clean,
   createFlag,
   dismissFlag,
   FIELD_TEXT_MAX,
   fieldText,
   FlagError,
   flagsOf,
   getFlag,
   GLOSSARY_REASONS,
   isField,
   isReason,
   isResolution,
   logFlagEvent,
   NOTE_MAX,
   prepareFlag,
   reopenFlag,
   resolveFlag,
   slideIndexOf,
   TEXT_MAX,
   type Actor,
   type Flag,
   type FlagKind,
} from "../lib/translation-flags/store.ts";

type Row = Record<string, unknown>;
type Role = "admin" | "editor" | "staff_writer" | "writer";

const roleOf = (c: Ctx): Role | null => {
   const r = c.get("user")?.role;
   return r === "admin" || r === "editor" || r === "staff_writer" || r === "writer" ? r : null;
};
const canResolve = (role: Role | null) => role === "admin" || role === "editor";
const actorOf = (c: Ctx): Actor => {
   const u = c.get("user");
   const n = Number(u?.id);
   return { id: Number.isFinite(n) ? n : null, email: u?.email ?? null };
};
const isKind = (v: unknown): v is FlagKind => v === "posts" || v === "pages";
const posInt = (v: unknown) => {
   const n = Number(v);
   return Number.isInteger(n) && n > 0 ? n : null;
};

async function body(c: Ctx): Promise<Record<string, unknown>> {
   const b = await c.req.json().catch(() => null);
   return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

/** The row, if this user may see its flags (a writer: only their own posts). */
async function rowFor(c: Ctx, kind: FlagKind, id: number): Promise<Row | null> {
   const role = roleOf(c);
   if (!role) return null;
   if ((role === "writer" || role === "staff_writer") && kind !== "posts") return null;
   const row = await c.env.DB.prepare(`SELECT * FROM "${kind}" WHERE id = ?1`).bind(id).first<Row>();
   if (!row) return null;
   // A staff writer: Al Ummah Now's own posts only
   if (role === "staff_writer" && (row.author_sub || row.ref_post_id)) return null;
   if (role === "writer") {
      const sub = await subOfUser(c.env.DB, c.get("user").id);
      if (!sub || row.author_sub !== sub) return null;
   }
   return row;
}

/** The other language's version of a row (same translation_key). */
async function sourceOf(db: D1Database, kind: FlagKind, row: Row): Promise<Row | null> {
   if (!row.translation_key) return null;
   return db.prepare(`SELECT * FROM "${kind}" WHERE translation_key = ?1 AND locale != ?2 ORDER BY id LIMIT 1`).bind(String(row.translation_key), String(row.locale)).first<Row>();
}

/** The source text for a field: the same field of the other version (a slide: the one at the same position). */
function sourceFieldText(kind: FlagKind, row: Row, source: Row | null, field: string): string {
   if (!source) return "";
   const slide = field.match(/^slide:([^:]+):/);
   if (!slide) return fieldText(kind, source, field);
   const i = slideIndexOf(row, slide[1]);
   return i < 0 ? "" : fieldText(kind, source, field, i);
}

interface Selection {
   kind: FlagKind;
   id: number;
   field: string;
   text: string;
   start: number;
   end: number;
}

function readSelection(b: Record<string, unknown>): Selection | null {
   const id = posInt(b.id);
   const text = typeof b.text === "string" ? b.text.replace(/\r\n?/g, "\n") : null;
   const start = Number(b.start);
   const end = Number(b.end);
   if (!isKind(b.kind) || !id || !isField(b.field) || text === null || text.length > FIELD_TEXT_MAX || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > text.length || end <= start) return null;
   return { kind: b.kind, id, field: b.field, text, start, end };
}

/** What the browser sees of a flag. */
function publicFlag(f: Flag & { events?: unknown[] }) {
   return {
      id: f.id,
      field: f.field,
      quote: f.quote,
      prefix: f.prefix,
      suffix: f.suffix,
      start: f.start_offset,
      end: f.end_offset,
      sourceText: f.source_text,
      sourceScope: f.source_scope,
      reason: f.reason,
      suggestion: f.suggestion,
      note: f.note,
      quran: f.quran === 1,
      quranUrl: f.quran_url,
      status: f.status,
      resolution: f.resolution,
      createdBy: f.created_by_email,
      createdAt: f.created_at,
      resolvedBy: f.resolved_by_email,
      resolvedAt: f.resolved_at,
      events: f.events ?? [],
   };
}

function fail(c: Ctx, e: unknown) {
   if (e instanceof FlagError || e instanceof GlossaryError) return c.json({ error: e.code }, e.status);
   log.error("translation flags failed", { error: errText(e) });
   return c.json({ error: "internal_error" }, 500);
}

export function translationFlagsApi(deps?: Pick<Deps, "fetch">): Hono<AppEnv> {
   const r = new Hono<AppEnv>();
   void deps;

   r.use("*", async (c, next) => {
      if (!roleOf(c)) return c.json({ error: "forbidden" }, 403);
      return next();
   });

   r.get("/", async (c) => {
      const kind = c.req.query("kind");
      const id = posInt(c.req.query("id"));
      if (!isKind(kind) || !id) return c.json({ error: "bad_request" }, 400);
      if (!(await rowFor(c, kind, id))) return c.json({ error: "not_found" }, 404);
      const flags = await flagsOf(c.env.DB, kind, id);
      return c.json({ flags: flags.map(publicFlag), canResolve: canResolve(roleOf(c)) }, 200, { "Cache-Control": "no-store" });
   });

   r.post("/preview", async (c) => {
      const sel = readSelection(await body(c));
      if (!sel) return c.json({ error: "bad_request" }, 400);
      const row = await rowFor(c, sel.kind, sel.id);
      if (!row) return c.json({ error: "not_found" }, 404);
      const source = await sourceOf(c.env.DB, sel.kind, row);
      try {
         const p = prepareFlag({ ...sel, quran: false, source: source ? { rowId: Number(source.id), text: sourceFieldText(sel.kind, row, source, sel.field) } : null });
         return c.json({ quote: p.anchor.quote, sourceText: p.source.text, sourceScope: p.source.scope, quran: p.quran, quranUrl: p.quranUrl }, 200, { "Cache-Control": "no-store" });
      } catch (e) {
         return fail(c, e);
      }
   });

   r.post("/", async (c) => {
      const b = await body(c);
      const sel = readSelection(b);
      if (!sel || !isReason(b.reason)) return c.json({ error: "bad_request" }, 400);
      const row = await rowFor(c, sel.kind, sel.id);
      if (!row) return c.json({ error: "not_found" }, 404);
      const source = await sourceOf(c.env.DB, sel.kind, row);
      try {
         const flag = await createFlag(
            c.env.DB,
            {
               ...sel,
               rowId: sel.id,
               locale: String(row.locale),
               reason: b.reason,
               suggestion: clean(b.suggestion, TEXT_MAX),
               note: clean(b.note, NOTE_MAX),
               quran: b.quran === true,
               source: source ? { rowId: Number(source.id), text: sourceFieldText(sel.kind, row, source, sel.field) } : null,
            },
            actorOf(c),
            Date.now(),
         );
         log.info("translation flagged", { kind: sel.kind, row_id: sel.id, flag: flag.id, reason: flag.reason, quran: flag.quran === 1 });
         return c.json({ flag: publicFlag(flag) }, 201);
      } catch (e) {
         return fail(c, e);
      }
   });

   /** A flag this user may act on: it exists, they may see its row, and (to change it) they may resolve. */
   const flagFor = async (c: Ctx, change: boolean): Promise<{ flag: Flag; row: Row } | Response> => {
      const flag = await getFlag(c.env.DB, c.req.param("id") ?? "");
      const row = flag ? await rowFor(c, flag.kind, flag.row_id) : null;
      if (!flag || !row) return c.json({ error: "not_found" }, 404);
      if (change && !canResolve(roleOf(c))) return c.json({ error: "forbidden" }, 403);
      return { flag, row };
   };

   r.post("/:id/resolve", async (c) => {
      const got = await flagFor(c, true);
      if (got instanceof Response) return got;
      const b = await body(c);
      if (!isResolution(b.resolution)) return c.json({ error: "bad_request" }, 400);
      const text = typeof b.text === "string" ? b.text.slice(0, TEXT_MAX) : null;
      try {
         return c.json({ flag: publicFlag(await resolveFlag(c.env.DB, got.flag.id, b.resolution, text, actorOf(c), Date.now())) });
      } catch (e) {
         return fail(c, e);
      }
   });

   r.post("/:id/dismiss", async (c) => {
      const got = await flagFor(c, true);
      if (got instanceof Response) return got;
      try {
         return c.json({ flag: publicFlag(await dismissFlag(c.env.DB, got.flag.id, clean((await body(c)).note, NOTE_MAX), actorOf(c), Date.now())) });
      } catch (e) {
         return fail(c, e);
      }
   });

   r.post("/:id/reopen", async (c) => {
      const got = await flagFor(c, true);
      if (got instanceof Response) return got;
      try {
         return c.json({ flag: publicFlag(await reopenFlag(c.env.DB, got.flag.id, actorOf(c), Date.now())) });
      } catch (e) {
         return fail(c, e);
      }
   });

   r.post("/:id/alternatives", async (c) => {
      const got = await flagFor(c, true);
      if (got instanceof Response) return got;
      const { flag } = got;
      // Qur'an is never machine-translated (docs/specs/TRANSCRIPTION-TRANSLATION.md principle 3).
      if (flag.quran === 1) return c.json({ error: "quran" }, 409);
      if (flag.status !== "open") return c.json({ error: "wrong_state" }, 409);
      if (!(await aiReady(c.env))) return c.json({ error: "ai_not_configured" }, 503);
      // Automated test accounts never spend AI on a deployed env (the owner's rule for tests).
      if (c.env.ENVIRONMENT !== "local" && isTestAccount(c.get("user").email)) return c.json({ error: "test_account" }, 403);
      const b = await body(c);
      const text = typeof b.text === "string" && b.text.length <= FIELD_TEXT_MAX ? b.text.replace(/\r\n?/g, "\n") : fieldText(flag.kind, got.row, flag.field);
      const out = await retranslate(c.env, flag, text, { userId: actorOf(c).id, deps: deps?.fetch ? { fetch: deps.fetch } : undefined });
      if (!out.ok) {
         if (out.code === "rate_limited") return c.json({ error: "rate_limited", retryAfter: out.retryAfter }, 429, { "Retry-After": String(out.retryAfter ?? 60) });
         if (out.code === "budget_reached") return c.json({ error: "budget_reached" }, 402);
         return c.json({ error: out.code }, 502);
      }
      await logFlagEvent(c.env.DB, flag.id, "alternatives", actorOf(c), Date.now(), { count: out.alternatives.length });
      return c.json({ alternatives: out.alternatives }, 200, { "Cache-Control": "no-store" });
   });

   r.post("/:id/glossary", async (c) => {
      const got = await flagFor(c, true);
      if (got instanceof Response) return got;
      const { flag } = got;
      if (!GLOSSARY_REASONS.includes(flag.reason)) return c.json({ error: "wrong_reason" }, 409);
      const b = await body(c);
      const sourceTerm = clean(b.sourceTerm, TERM_MAX);
      const targetTerm = clean(b.targetTerm, TERM_MAX) ?? clean(flag.suggestion, TERM_MAX);
      if (!sourceTerm || !targetTerm) return c.json({ error: "required" }, 400);
      const now = Date.now();
      try {
         const entry = await addEntry(c.env.DB, { sourceLocale: flag.locale === "ar" ? "en" : "ar", sourceTerm, targetTerm, note: clean(b.note, NOTE_MAX), flagId: flag.id }, actorOf(c), now);
         await logFlagEvent(c.env.DB, flag.id, "glossary", actorOf(c), now, { entry: entry.id, sourceTerm, targetTerm });
         return c.json({ entry }, 201);
      } catch (e) {
         return fail(c, e);
      }
   });

   return r;
}

export function glossaryApi(): Hono<AppEnv> {
   const r = new Hono<AppEnv>();

   r.use("*", async (c, next) => {
      if (!canResolve(roleOf(c))) return c.json({ error: "forbidden" }, 403);
      return next();
   });

   r.get("/", async (c) => {
      const entries = await listEntries(c.env.DB, { q: c.req.query("q") ?? "", deleted: c.req.query("deleted") === "1" && roleOf(c) === "admin" });
      return c.json({ entries }, 200, { "Cache-Control": "no-store" });
   });

   r.post("/", async (c) => {
      const b = await body(c);
      const sourceTerm = clean(b.sourceTerm, TERM_MAX);
      const targetTerm = clean(b.targetTerm, TERM_MAX);
      if ((b.sourceLocale !== "en" && b.sourceLocale !== "ar") || !sourceTerm || !targetTerm) return c.json({ error: "bad_request" }, 400);
      try {
         return c.json({ entry: await addEntry(c.env.DB, { sourceLocale: b.sourceLocale, sourceTerm, targetTerm, note: clean(b.note, NOTE_MAX), flagId: null }, actorOf(c), Date.now()) }, 201);
      } catch (e) {
         return fail(c, e);
      }
   });

   r.delete("/:id", async (c) => {
      if (roleOf(c) !== "admin") return c.json({ error: "forbidden" }, 403);
      try {
         await deleteEntry(c.env.DB, c.req.param("id"), actorOf(c), Date.now());
         return c.json({ ok: true });
      } catch (e) {
         return fail(c, e);
      }
   });

   r.post("/:id/restore", async (c) => {
      if (roleOf(c) !== "admin") return c.json({ error: "forbidden" }, 403);
      try {
         return c.json({ entry: await restoreEntry(c.env.DB, c.req.param("id"), Date.now()) });
      } catch (e) {
         return fail(c, e);
      }
   });

   return r;
}
