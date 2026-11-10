/**
 * AI assist endpoints (docs/AI_ASSIST_SPEC.md §2–§5). Mounted at /admin/api/ai, behind the session
 * gate and the same-origin check (src/index.ts); every route checks the role again.
 *
 *   GET  /status                   { configured }
 *   POST /jobs                     { feature, kind, id?, locale, fields } → 202 { job } (deduped, rate-limited)
 *   GET  /jobs/:id                 the job (its owner or an admin)
 *   GET  /usage?from=&to=          admin: daily rollup for the cost dashboard (#266)
 *   POST /failures/:id/dismiss     admin: clear a failure flag
 */
import { Hono } from "hono";
import type { AppEnv, Ctx } from "../types.ts";
import { aiConfigured } from "../lib/ai/config.ts";
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
} from "../lib/ai/jobs.ts";
import { FEATURES, type Feature, type Locale } from "../lib/ai/prompts.ts";

const isStaff = (role?: string) => role === "admin" || role === "editor";

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

export function aiRoutes(): Hono<AppEnv> {
   const r = new Hono<AppEnv>();

   r.use("*", async (c, next) => {
      if (!isStaff(c.get("user")?.role)) return c.json({ error: "forbidden" }, 403);
      return next();
   });

   r.get("/status", async (c) => c.json({ configured: await aiConfigured(c.env) }, 200, { "Cache-Control": "no-store" }));

   r.post("/jobs", async (c) => {
      if (!(c.req.header("content-type") ?? "").includes("application/json")) return c.json({ error: "bad_request", message: "JSON body required" }, 415);
      if (!(await aiConfigured(c.env))) return c.json({ error: "ai_not_configured" }, 503);
      const parsed = readBody(await c.req.json().catch(() => null));
      if (!parsed.ok) return c.json({ error: parsed.error }, parsed.status);
      const user = c.get("user");
      const userId = Number(user.id);
      const now = Date.now();
      const j: NewJob = { ...parsed.job, userId };
      const key = await dedupeKey(j);
      const existing = await findDuplicate(c.env.DB, key, now);
      if (existing) return c.json({ job: publicJob(await failIfStale(c.env.DB, existing, now)), deduped: true }, 200);
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

   return r;
}
