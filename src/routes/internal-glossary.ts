/**
 * /internal/glossary — the translation glossary (migrations/0017, docs/TRANSLATION_FLAGS.md §4) for the
 * videos platform's machine translation of staff-set site fields (AlUmmahNow processor
 * src/captions/admin-fields.ts, L10N rule 2026-11-16). This table stays the one source of truth: the
 * other apps read it here instead of keeping a copy. Service-to-service only: `X-API-Key` must equal the
 * shared internal key (VIDEOS_INTERNAL_API_KEY). No session, no CORS, never cached.
 *
 *   GET /internal/glossary?from=en|ar&to=ar|en  → { entries: [{ source, target, note }] }  (live entries, longest term first)
 */
import { Hono } from "hono";
import type { Env } from "../env.ts";
import { internalKey } from "../lib/scholars/videos-internal.ts";
import { errText, log } from "../lib/log.ts";
import { sameKey } from "./internal-refs.ts";

const LOCALES = new Set(["en", "ar"]);
const MAX = 2000;

export function internalGlossaryApi(): Hono<{ Bindings: Env }> {
   const api = new Hono<{ Bindings: Env }>();

   api.use("*", async (c, next) => {
      const expected = await internalKey(c.env);
      const given = c.req.header("X-API-Key") ?? "";
      if (!expected || !given || !sameKey(given, expected)) return c.json({ error: "unauthorized" }, 401, { "Cache-Control": "no-store" });
      await next();
      c.header("Cache-Control", "no-store");
   });

   api.get("/", async (c) => {
      const from = c.req.query("from") ?? "";
      const to = c.req.query("to") ?? "";
      if (!LOCALES.has(from) || !LOCALES.has(to) || from === to) return c.json({ error: "invalid_locale" }, 400);
      try {
         const res = await c.env.DB.prepare(
            "SELECT source_term, target_term, note FROM translation_glossary WHERE source_locale = ?1 AND target_locale = ?2 AND deleted_at IS NULL ORDER BY length(source_term) DESC LIMIT ?3",
         )
            .bind(from, to, MAX)
            .all<{ source_term: string; target_term: string; note: string | null }>();
         return c.json({ entries: (res.results ?? []).map((r) => ({ source: r.source_term, target: r.target_term, note: r.note })) });
      } catch (error) {
         log.error("[Glossary] Internal read failed", { error: errText(error) });
         return c.json({ error: "unavailable" }, 503);
      }
   });

   return api;
}
