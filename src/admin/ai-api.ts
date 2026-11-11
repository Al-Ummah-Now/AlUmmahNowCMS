/**
 * AI assist endpoints (docs/AI_ASSIST_SPEC.md §2–§5). Mounted at /admin/api/ai, behind the session
 * gate and the same-origin check (src/index.ts); every route checks the role again.
 *
 *   GET  /status                   { configured }
 *   POST /jobs                     { feature, kind, id?, locale, fields } → 202 { job } (deduped, rate-limited)
 *   GET  /jobs/:id                 the job (its owner or an admin)
 *   GET  /usage?from=&to=          admin: daily rollup for the cost dashboard (#266)
 *   POST /failures/:id/dismiss     admin: clear a failure flag
 *   GET  /settings                 admin: providers, routes, budget, bound AI_KEY_* names, recent audit
 *   PUT  /settings                 admin: { settings, version } → validated, versioned, audit-logged
 *   POST /settings/test            admin: { provider, model } → a tiny prompt through that (unsaved) config
 *   POST /slug                     { kind, locale, title, id?, fresh? } → { slug, base, source } (src/lib/slug-suggest.ts)
 */
import { Hono } from "hono";
import type { AppEnv, Ctx, Deps } from "../types.ts";
import { budgetState } from "../lib/ai/budget.ts";
import { aiReady, buildProvider } from "../lib/ai/router.ts";
import { auditTest, boundSecretNames, loadSettings, recentAudit, saveSettings, SettingsConflict, validateProvider, validateSettings, type SettingsError } from "../lib/ai/settings.ts";
import { errText, log } from "../lib/log.ts";
import {
   createJob,
   dedupeKey,
   dismissFailure,
   failJob,
   failIfStale,
   findDuplicate,
   getJob,
   LIMITS,
   rateLimitWait,
   usageRollup,
   type ContentKind,
   type Job,
   type NewJob,
   recordUsage,
} from "../lib/ai/jobs.ts";
import { postAuthor, subOfUser } from "../lib/scholars/ownership.ts";
import { FEATURES, type Feature, type Locale } from "../lib/ai/prompts.ts";
import { fallbackBase, freeSlug } from "../lib/slug.ts";
import { suggestSlug } from "../lib/slug-suggest.ts";

// Writers (auth "Scholar") use AI assist on their own posts, under the same per-user budget.
const isStaff = (role?: string) => role === "admin" || role === "editor" || role === "writer";

/** What the browser sees of a job (never the input text back, never provider errors). */
export function publicJob(j: Job) {
   return {
      id: j.id,
      feature: j.feature,
      kind: j.kind,
      rowId: j.row_id,
      locale: j.locale,
      targetLocale: j.target_locale,
      status: j.status,
      result: j.status === "done" ? j.result : null,
      error: j.status === "failed" ? (j.error ?? "unknown") : null,
   };
}

function readBody(raw: unknown): { ok: true; job: Omit<NewJob, "userId"> } | { ok: false; status: 400 | 413; error: string } {
   if (!raw || typeof raw !== "object") return { ok: false, status: 400, error: "bad_request" };
   const b = raw as Record<string, unknown>;
   const feature = b.feature as Feature;
   const kind = b.kind as ContentKind;
   const locale = b.locale as Locale;
   const ui = (b.ui === "ar" ? "ar" : "en") as Locale;
   if (!FEATURES.includes(feature) || (kind !== "pages" && kind !== "posts") || (locale !== "en" && locale !== "ar")) return { ok: false, status: 400, error: "bad_request" };
   const id = b.id == null || b.id === "" ? null : Number(b.id);
   if (id !== null && (!Number.isInteger(id) || id <= 0)) return { ok: false, status: 400, error: "bad_request" };
   const f = (b.fields ?? {}) as Record<string, unknown>;
   const str = (v: unknown) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n") : "");
   const fields = { title: str(f.title).trim(), summary: str(f.summary).trim(), body: str(f.body) };
   if (fields.title.length > 200 || fields.summary.length > 500) return { ok: false, status: 400, error: "bad_request" };
   if (fields.body.length > LIMITS.bodyMax[feature]) return { ok: false, status: 413, error: "too_long" };
   if (!fields.title && !fields.summary && !fields.body.trim()) return { ok: false, status: 400, error: "empty" };
   return { ok: true, job: { feature, kind, rowId: id, locale, input: { ...fields, ui } } };
}

export function aiRoutes(deps?: Pick<Deps, "fetch">): Hono<AppEnv> {
   const r = new Hono<AppEnv>();

   r.use("*", async (c, next) => {
      if (!isStaff(c.get("user")?.role)) return c.json({ error: "forbidden" }, 403);
      return next();
   });

   r.get("/status", async (c) => c.json({ configured: await aiReady(c.env) }, 200, { "Cache-Control": "no-store" }));

   r.post("/jobs", async (c) => {
      if (!(c.req.header("content-type") ?? "").includes("application/json")) return c.json({ error: "bad_request", message: "JSON body required" }, 415);
      if (!(await aiReady(c.env))) return c.json({ error: "ai_not_configured" }, 503);
      const parsed = readBody(await c.req.json().catch(() => null));
      if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
      const user = c.get("user");
      if (user.role === "writer") {
         if (parsed.job.kind !== "posts") return c.json({ error: "forbidden" }, 403);
         if (parsed.job.rowId !== null && (await postAuthor(c.env.DB, parsed.job.rowId)) !== (await subOfUser(c.env.DB, user.id))) return c.json({ error: "not_found" }, 404);
      }
      const userId = Number(user.id);
      const now = Date.now();
      const j: NewJob = { ...parsed.job, userId };
      const key = await dedupeKey(j);
      const existing = await findDuplicate(c.env.DB, key, now);
      if (existing) return c.json({ job: publicJob(await failIfStale(c.env.DB, existing, now)), deduped: true }, 200);
      const { settings } = await loadSettings(c.env.DB);
      if ((await budgetState(c.env.DB, c.env.ENVIRONMENT, settings, now)).reached) return c.json({ error: "budget_reached" }, 402);
      const wait = await rateLimitWait(c.env.DB, userId, LIMITS.weight[j.feature], now);
      if (wait > 0) return c.json({ error: "rate_limited", retryAfter: wait }, 429, { "Retry-After": String(wait) });
      const job = await createJob(c.env.DB, j, key, now);
      try {
         await c.env.AI_JOBS!.send({ jobId: job.id });
      } catch {
         await failJob(c.env.DB, job.id, "enqueue_failed", Date.now());
         return c.json({ error: "unavailable" }, 503);
      }
      return c.json({ job: publicJob(job) }, 202);
   });

   // The editor's address suggestion: English title → English translation of the Arabic title →
   // transliteration, made free in its table and language. Works with AI off (no queue needed).
   r.post("/slug", async (c) => {
      const b = (await c.req.json().catch(() => null)) as { kind?: unknown; locale?: unknown; title?: unknown; id?: unknown; fresh?: unknown } | null;
      const kind = b?.kind;
      const locale = b?.locale;
      const title = typeof b?.title === "string" ? b.title.trim() : "";
      const id = b?.id == null || b.id === "" ? null : Number(b.id);
      if ((kind !== "pages" && kind !== "posts") || (locale !== "en" && locale !== "ar") || title.length > 200 || (id !== null && (!Number.isInteger(id) || id <= 0))) {
         return c.json({ error: "bad_request" }, 400);
      }
      const user = c.get("user");
      if (user.role === "writer") {
         if (kind !== "posts") return c.json({ error: "forbidden" }, 403);
         if (id !== null && (await postAuthor(c.env.DB, id)) !== (await subOfUser(c.env.DB, user.id))) return c.json({ error: "not_found" }, 404);
      }
      // The English title: this row's when it is English, else its linked English version's.
      let englishTitle: string | null = locale === "en" ? title : null;
      if (!englishTitle && id !== null) {
         const en = await c.env.DB.prepare(
            `SELECT o.title FROM "${kind}" t JOIN "${kind}" o ON o.translation_key = t.translation_key AND o.locale = 'en' WHERE t.id = ?1 AND t.translation_key IS NOT NULL LIMIT 1`,
         )
            .bind(id)
            .first<{ title: string }>();
         englishTitle = en?.title ?? null;
      }
      const s = await suggestSlug(c.env, { title, englishTitle, fresh: b?.fresh === true, user: { id: user.id, email: user.email } });
      let base = s.base || fallbackBase(kind);
      if (kind === "pages" && base === "home") base = "home-page";
      const slug = await freeSlug(c.env.DB, kind, locale, base, id);
      return c.json({ slug, base, source: s.source, reason: s.reason ?? null }, 200, { "Cache-Control": "no-store" });
   });

   r.get("/jobs/:id", async (c) => {
      const now = Date.now();
      const found = await getJob(c.env.DB, c.req.param("id"));
      const user = c.get("user");
      if (!found || (found.user_id !== Number(user.id) && user.role !== "admin")) return c.json({ error: "not_found" }, 404);
      return c.json({ job: publicJob(await failIfStale(c.env.DB, found, now)) }, 200, { "Cache-Control": "no-store" });
   });

   r.get("/usage", async (c) => {
      if (c.get("user").role !== "admin") return c.json({ error: "forbidden" }, 403);
      const day = /^\d{4}-\d{2}-\d{2}$/;
      const today = new Date().toISOString().slice(0, 10);
      const from = c.req.query("from") ?? today.slice(0, 8) + "01";
      const to = c.req.query("to") ?? today;
      if (!day.test(from) || !day.test(to) || from > to) return c.json({ error: "bad_request", message: "from/to must be YYYY-MM-DD, from ≤ to" }, 400);
      return c.json({ from, to, ...(await usageRollup(c.env.DB, from, to)) }, 200, { "Cache-Control": "no-store" });
   });

   r.post("/failures/:id/dismiss", async (c: Ctx) => {
      if (c.get("user").role !== "admin") return c.json({ error: "forbidden" }, 403);
      const ok = await dismissFailure(c.env.DB, c.req.param("id") ?? "");
      return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
   });

   r.get("/settings", async (c) => {
      if (c.get("user").role !== "admin") return c.json({ error: "forbidden" }, 403);
      const stored = await loadSettings(c.env.DB);
      const now = Date.now();
      return c.json(
         {
            ...stored,
            secrets: boundSecretNames(c.env),
            budget: await budgetState(c.env.DB, c.env.ENVIRONMENT, stored.settings, now),
            audit: await recentAudit(c.env.DB),
         },
         200,
         { "Cache-Control": "no-store" },
      );
   });

   r.put("/settings", async (c) => {
      const user = c.get("user");
      if (user.role !== "admin") return c.json({ error: "forbidden" }, 403);
      const body = (await c.req.json().catch(() => null)) as { settings?: unknown; version?: unknown } | null;
      if (!body || !Number.isInteger(body.version)) return c.json({ error: "bad_request" }, 400);
      const v = validateSettings(body.settings, { local: c.env.ENVIRONMENT === "local" });
      if (!v.ok) return c.json({ error: "invalid", errors: v.errors }, 400);
      try {
         const saved = await saveSettings(c.env.DB, v.settings, body.version as number, { id: Number(user.id) || null, email: user.email ?? null }, Date.now());
         return c.json(saved);
      } catch (e) {
         if (e instanceof SettingsConflict) return c.json({ error: "conflict" }, 409);
         log.error("ai settings save failed", { error: errText(e) });
         return c.json({ error: "internal_error" }, 500);
      }
   });

   r.post("/settings/test", async (c) => {
      const user = c.get("user");
      if (user.role !== "admin") return c.json({ error: "forbidden" }, 403);
      const body = (await c.req.json().catch(() => null)) as { provider?: unknown; model?: unknown } | null;
      const errors: SettingsError[] = [];
      const cfg = validateProvider(body?.provider, "provider", { local: c.env.ENVIRONMENT === "local" }, errors);
      const model = typeof body?.model === "string" ? body.model.trim() : "";
      if (!cfg || errors.length || !model) return c.json({ error: "invalid", errors: model ? errors : [...errors, { path: "model", code: "required" }] }, 400);
      // A disabled provider can still be tested before an admin turns it on.
      const provider = buildProvider({ ...cfg, enabled: true }, c.env, { fetch: deps?.fetch });
      if (!provider) return c.json({ ok: false, code: "not_configured", latencyMs: 0 });
      const result = await provider.complete({ model, system: TEST_SYSTEM, messages: [{ role: "user", content: "ping" }], schema: TEST_SCHEMA, reasoning: "none", maxTokens: 50 });
      const now = Date.now();
      const actor = { id: Number(user.id) || null, email: user.email ?? null };
      if (result.usage) await recordUsage(c.env.DB, { env: c.env.ENVIRONMENT, job: { id: null, user_id: actor.id, feature: "test" }, result, now });
      await auditTest(c.env.DB, actor, cfg.id, result.ok ? "ok" : result.code, now);
      return c.json(
         result.ok
            ? { ok: true, latencyMs: result.latencyMs, costUsd: result.costUsd, usage: result.usage, model: result.model, answer: result.text.slice(0, 500) }
            : { ok: false, code: result.code, latencyMs: result.latencyMs, costUsd: result.costUsd ?? 0, detail: result.detail ?? null, raw: result.raw ?? null },
         200,
         { "Cache-Control": "no-store" },
      );
   });

   return r;
}

/** The "Test connection" prompt: tiny, fixed, and it exercises the JSON answer path every feature uses. */
const TEST_SYSTEM = 'You are a connection test. Answer with the JSON object {"reply":"ok"} and nothing else.';
const TEST_SCHEMA = { type: "object", properties: { reply: { type: "string" } }, required: ["reply"], additionalProperties: false };
