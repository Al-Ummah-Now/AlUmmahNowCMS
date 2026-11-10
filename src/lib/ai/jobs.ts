/**
 * AI jobs and usage in D1 (docs/AI_ASSIST_SPEC.md §3–§6): create with dedupe, per-user rate limit,
 * lease-based claim (a duplicate queue delivery is a no-op), partial results for resumable chunked
 * translation, failure flags for admins, the usage log and its daily rollup for the cost dashboard.
 */
import { costUsd } from "./pricing.ts";
import { PROMPT_VERSION, type Feature, type Locale } from "./prompts.ts";
import type { CallUsage } from "./client.ts";

export type JobStatus = "queued" | "running" | "done" | "failed";
export type ContentKind = "pages" | "posts";

export interface JobInput {
   /** Title, summary (pages) or excerpt (posts), body: the form's current values. */
   title: string;
   summary: string;
   body: string;
   /** The editor's UI language (check notes are written in it). */
   ui: Locale;
}

export interface Job {
   id: string;
   dedupe_key: string;
   user_id: number;
   feature: Feature;
   kind: ContentKind;
   row_id: number | null;
   locale: Locale;
   target_locale: Locale | null;
   input: JobInput;
   status: JobStatus;
   attempts: number;
   lease_until: number;
   partial: { chunks: string[]; title?: string; summary?: string } | null;
   result: unknown;
   error: string | null;
   flagged: number;
   weight: number;
   created_at: number;
   updated_at: number;
}

interface JobRow extends Omit<Job, "input" | "partial" | "result"> {
   input: string;
   partial: string | null;
   result: string | null;
}

const parse = <T>(s: string | null): T | null => {
   if (s == null) return null;
   try {
      return JSON.parse(s) as T;
   } catch {
      return null;
   }
};

function fromRow(r: JobRow): Job {
   return { ...r, input: parse<JobInput>(r.input) ?? { title: "", summary: "", body: "", ui: "en" }, partial: parse(r.partial), result: parse(r.result) };
}

export const LIMITS = {
   windowMs: 10 * 60 * 1000,
   perWindow: 10,
   perDay: 60,
   weight: { translate: 3, seo: 1, check: 1 } as Record<Feature, number>,
   bodyMax: { translate: 100_000, seo: 60_000, check: 60_000 } as Record<Feature, number>,
   dedupeMs: 24 * 60 * 60 * 1000,
   leaseMs: 15 * 60 * 1000,
   staleMs: 20 * 60 * 1000,
   retentionMs: 30 * 24 * 60 * 60 * 1000,
};

export async function sha256(text: string): Promise<string> {
   const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
   return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface NewJob {
   userId: number;
   feature: Feature;
   kind: ContentKind;
   rowId: number | null;
   locale: Locale;
   input: JobInput;
}

export function targetOf(feature: Feature, locale: Locale): Locale | null {
   return feature === "translate" ? (locale === "en" ? "ar" : "en") : null;
}

export async function dedupeKey(j: NewJob): Promise<string> {
   // The UI language only matters for check notes.
   const input = j.feature === "check" ? j.input : { ...j.input, ui: "" };
   return sha256(JSON.stringify([PROMPT_VERSION, j.userId, j.feature, j.kind, j.rowId, j.locale, targetOf(j.feature, j.locale), input]));
}

/** A queued/running/done job with the same key from the last 24 h, if any. */
export async function findDuplicate(db: D1Database, key: string, now: number): Promise<Job | null> {
   const row = await db
      .prepare("SELECT * FROM ai_jobs WHERE dedupe_key = ?1 AND created_at > ?2 AND status IN ('queued','running','done') ORDER BY created_at DESC LIMIT 1")
      .bind(key, now - LIMITS.dedupeMs)
      .first<JobRow>();
   return row ? fromRow(row) : null;
}

/** Seconds until the user may start a job of `weight`, or 0 when allowed now. */
export async function rateLimitWait(db: D1Database, userId: number, weight: number, now: number): Promise<number> {
   const dayStart = now - 24 * 60 * 60 * 1000;
   const rows = await db
      .prepare("SELECT created_at, weight FROM ai_jobs WHERE user_id = ?1 AND created_at > ?2 ORDER BY created_at")
      .bind(userId, dayStart)
      .all<{ created_at: number; weight: number }>();
   const all = rows.results ?? [];
   const wait = (items: typeof all, limit: number, span: number, from: number) => {
      let used = items.filter((r) => r.created_at > from).reduce((n, r) => n + r.weight, 0);
      if (used + weight <= limit) return 0;
      // Oldest rows leave the window first: find when enough weight has left.
      for (const r of items.filter((x) => x.created_at > from)) {
         used -= r.weight;
         if (used + weight <= limit) return Math.ceil((r.created_at + span - now) / 1000);
      }
      return Math.ceil(span / 1000);
   };
   return Math.max(wait(all, LIMITS.perWindow, LIMITS.windowMs, now - LIMITS.windowMs), wait(all, LIMITS.perDay, 24 * 60 * 60 * 1000, dayStart));
}

export async function createJob(db: D1Database, j: NewJob, key: string, now: number): Promise<Job> {
   const id = crypto.randomUUID();
   await db
      .prepare(
         `INSERT INTO ai_jobs (id, dedupe_key, user_id, feature, kind, row_id, locale, target_locale, input, status, weight, created_at, updated_at)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'queued', ?10, ?11, ?11)`,
      )
      .bind(id, key, j.userId, j.feature, j.kind, j.rowId, j.locale, targetOf(j.feature, j.locale), JSON.stringify(j.input), LIMITS.weight[j.feature], now)
      .run();
   return (await getJob(db, id))!;
}

export async function getJob(db: D1Database, id: string): Promise<Job | null> {
   const row = await db.prepare("SELECT * FROM ai_jobs WHERE id = ?1").bind(id).first<JobRow>();
   return row ? fromRow(row) : null;
}

/**
 * Claims a job for this delivery: queued, or running with an expired lease (a consumer that died).
 * Returns null when it is done/failed (ack) or another delivery holds a live lease (retry later).
 */
export async function claimJob(db: D1Database, id: string, now: number): Promise<{ job: Job | null; busy: boolean }> {
   const res = await db
      .prepare(
         `UPDATE ai_jobs SET status = 'running', attempts = attempts + 1, lease_until = ?2, updated_at = ?3
          WHERE id = ?1 AND (status = 'queued' OR (status = 'running' AND lease_until < ?3))`,
      )
      .bind(id, now + LIMITS.leaseMs, now)
      .run();
   const job = await getJob(db, id);
   if (res.meta.changes === 1 && job) return { job, busy: false };
   return { job: null, busy: job?.status === "running" };
}

export async function savePartial(db: D1Database, id: string, partial: Job["partial"], now: number): Promise<void> {
   await db.prepare("UPDATE ai_jobs SET partial = ?2, updated_at = ?3 WHERE id = ?1").bind(id, JSON.stringify(partial), now).run();
}

export async function completeJob(db: D1Database, id: string, result: unknown, now: number): Promise<void> {
   await db.prepare("UPDATE ai_jobs SET status = 'done', result = ?2, error = NULL, lease_until = 0, updated_at = ?3 WHERE id = ?1").bind(id, JSON.stringify(result), now).run();
}

/** Releases the lease so the queue's redelivery can claim it again. */
export async function releaseJob(db: D1Database, id: string, error: string, now: number): Promise<void> {
   await db.prepare("UPDATE ai_jobs SET status = 'queued', error = ?2, lease_until = 0, updated_at = ?3 WHERE id = ?1 AND status = 'running'").bind(id, error, now).run();
}

/** Final failure: flagged for admins (Overview card) and logged. No-op on a done job. */
export async function failJob(db: D1Database, id: string, error: string, now: number): Promise<boolean> {
   const res = await db
      .prepare("UPDATE ai_jobs SET status = 'failed', error = ?2, flagged = 1, lease_until = 0, updated_at = ?3 WHERE id = ?1 AND status != 'done'")
      .bind(id, error, now)
      .run();
   if (res.meta.changes === 1) console.error(JSON.stringify({ msg: "ai_job_failed", jobId: id, error }));
   return res.meta.changes === 1;
}

/** A running job whose consumer vanished for 20 min: failed + flagged (the queue may still redeliver it; claim refuses a failed job). */
export async function failIfStale(db: D1Database, job: Job, now: number): Promise<Job> {
   if ((job.status === "running" || job.status === "queued") && job.updated_at < now - LIMITS.staleMs) {
      await failJob(db, job.id, "stalled", now);
      return (await getJob(db, job.id)) ?? job;
   }
   return job;
}

export interface FailedJob {
   id: string;
   feature: Feature;
   kind: ContentKind;
   row_id: number | null;
   error: string | null;
   email: string | null;
   updated_at: number;
}

export async function flaggedFailures(db: D1Database, limit = 5): Promise<{ total: number; items: FailedJob[] }> {
   const [count, rows] = await db.batch<{ n: number } & FailedJob>([
      db.prepare("SELECT COUNT(*) AS n FROM ai_jobs WHERE flagged = 1 AND status = 'failed'"),
      db
         .prepare(
            `SELECT j.id, j.feature, j.kind, j.row_id, j.error, u.email, j.updated_at FROM ai_jobs j LEFT JOIN users u ON u.id = j.user_id
             WHERE j.flagged = 1 AND j.status = 'failed' ORDER BY j.updated_at DESC LIMIT ?1`,
         )
         .bind(limit),
   ]);
   return { total: Number(count.results?.[0]?.n ?? 0), items: (rows.results ?? []) as FailedJob[] };
}

export async function dismissFailure(db: D1Database, id: string): Promise<boolean> {
   const res = await db.prepare("UPDATE ai_jobs SET flagged = 0 WHERE id = ?1 AND flagged = 1").bind(id).run();
   return res.meta.changes === 1;
}

export async function recordUsage(db: D1Database, p: { env: string; job: Pick<Job, "id" | "user_id" | "feature">; usage: CallUsage; status: string; now: number }): Promise<void> {
   const { usage: u } = p;
   const day = new Date(p.now).toISOString().slice(0, 10);
   await db
      .prepare(
         `INSERT INTO ai_usage (id, at, day, env, user_id, feature, model, job_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, status)
          VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
      )
      .bind(
         crypto.randomUUID(),
         p.now,
         day,
         p.env,
         p.job.user_id,
         p.job.feature,
         u.model,
         p.job.id,
         u.input,
         u.output,
         u.cacheRead,
         u.cacheWrite,
         costUsd(u.model, { input: u.input, output: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite }),
         p.status,
      )
      .run();
}

/** Daily rollup in the cost spec's vendor_costs_daily shape, plus token totals by feature and by user. */
export async function usageRollup(db: D1Database, from: string, to: string) {
   const [daily, byFeature, byUser] = await db.batch([
      db
         .prepare(
            `SELECT day, env, model, SUM(cost_usd) AS amount_usd, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, COUNT(*) AS calls
             FROM ai_usage WHERE day BETWEEN ?1 AND ?2 GROUP BY day, env, model ORDER BY day, model`,
         )
         .bind(from, to),
      db
         .prepare(
            `SELECT feature, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, SUM(cost_usd) AS amount_usd, COUNT(*) AS calls
             FROM ai_usage WHERE day BETWEEN ?1 AND ?2 GROUP BY feature ORDER BY feature`,
         )
         .bind(from, to),
      db
         .prepare(
            `SELECT a.user_id, u.email, SUM(a.input_tokens) AS input_tokens, SUM(a.output_tokens) AS output_tokens, SUM(a.cost_usd) AS amount_usd, COUNT(*) AS calls
             FROM ai_usage a LEFT JOIN users u ON u.id = a.user_id WHERE a.day BETWEEN ?1 AND ?2 GROUP BY a.user_id ORDER BY amount_usd DESC`,
         )
         .bind(from, to),
   ]);
   type Daily = { day: string; env: string; model: string; amount_usd: number; input_tokens: number; output_tokens: number; calls: number };
   return {
      vendor_costs_daily: ((daily.results ?? []) as Daily[]).map((r) => ({
         day: r.day,
         vendor: "anthropic",
         line_item: r.model,
         env: r.env,
         amount_usd: Math.round(Number(r.amount_usd) * 1e6) / 1e6,
         source: "estimate" as const,
         input_tokens: Number(r.input_tokens),
         output_tokens: Number(r.output_tokens),
         calls: Number(r.calls),
      })),
      by_feature: byFeature.results ?? [],
      by_user: byUser.results ?? [],
   };
}

/** Retention (spec §3): job rows hold the text; deleted after 30 days. Usage rows are kept for the cost dashboard. */
export async function pruneJobs(db: D1Database, now: number): Promise<number> {
   const res = await db.prepare("DELETE FROM ai_jobs WHERE created_at < ?1").bind(now - LIMITS.retentionMs).run();
   return res.meta.changes ?? 0;
}
