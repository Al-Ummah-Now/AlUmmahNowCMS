/**
 * Image variant jobs (CMS-10): queued, idempotent, retried with backoff; failures flag admins.
 *
 *   enqueue (upload / first request for a missing variant / cron backfill)
 *     → "plan" message: read the original's size, decide the widths, fan out one message per width
 *     → "width" message: decode, scale, encode AVIF + WebP + fallback, put to R2 (create-only keys
 *       under _variants/; the original is never touched)
 *
 * State per original lives in D1 `media_variants` (migrations/0003): queued → processing → done,
 * or failed (with the reason). Failed rows show in the staff Library ("Sizes not made", Retry) and
 * as a count on the Overview. Nothing here runs inside a public request: the media route only
 * inserts a row and sends a message (ctx.waitUntil), and serves the original meanwhile.
 *
 * Retries: a thrown error retries the message with exponential backoff (30 s … 30 min) up to
 * MAX_ATTEMPTS, then the row is marked failed. A crash that never reaches the catch (e.g. the
 * isolate running out of memory) is caught by the row's own start counter: STARTS_LIMIT starts
 * without finishing marks it failed. The queue's DLQ keeps any message that slips past both.
 */
import type { Env } from "../../env.ts";
import { decodeScaled, encode } from "./codecs.ts";
import { backoffSeconds, formatsFor, PermanentVariantError, heightFor, isSourceType, MAX_SOURCE_PIXELS, VARIANT_TYPES, variantKey, variantPrefix, widthsFor } from "./plan.ts";
import { probeImage } from "./probe.ts";
import { mediaReady } from "../feed/jobs.ts";

export type VariantMessage = { kind: "plan"; path: string } | { kind: "width"; path: string; width: number };

export const MAX_ATTEMPTS = 5;
export const STARTS_LIMIT = 8;
/** Rows still queued/processing after this long lost their message; the cron sends it again. */
export const STALE_MS = 60 * 60 * 1000;


export { PermanentVariantError };

export interface VariantRow {
   path: string;
   status: "queued" | "processing" | "done" | "failed";
   width: number | null;
   height: number | null;
   widths: string | null;
   done_widths: string;
   attempts: number;
   error: string | null;
   queued_at: string;
   updated_at: string;
}

const now = () => new Date().toISOString();

/**
 * Queues variants for `path` unless a row already exists (idempotent: concurrent callers insert
 * once; only the inserter sends). Returns true when a message was sent.
 */
export async function enqueueVariants(env: Env, path: string): Promise<boolean> {
   if (!env.VARIANTS) return false;
   const t = now();
   const res = await env.DB.prepare(
      "INSERT INTO media_variants (path, status, queued_at, updated_at) SELECT ?1, 'queued', ?2, ?2 WHERE EXISTS (SELECT 1 FROM media WHERE path = ?1) ON CONFLICT (path) DO NOTHING",
   )
      .bind(path, t)
      .run();
   if (!res.meta.changes) return false;
   await env.VARIANTS.send({ kind: "plan", path } satisfies VariantMessage);
   return true;
}

/** Admin "Retry": back to queued with a clean slate (made widths stay; they are skipped). */
export async function retryVariants(env: Env, path: string): Promise<boolean> {
   if (!env.VARIANTS) return false;
   const res = await env.DB.prepare(
      "UPDATE media_variants SET status = 'queued', attempts = 0, error = NULL, updated_at = ?2 WHERE path = ?1 AND EXISTS (SELECT 1 FROM media WHERE path = ?1)",
   )
      .bind(path, now())
      .run();
   if (!res.meta.changes) return enqueueVariants(env, path);
   await env.VARIANTS.send({ kind: "plan", path } satisfies VariantMessage);
   return true;
}

/** Removes every variant of `path` and its row (the original was deleted). */
export async function deleteVariants(env: Env, path: string): Promise<void> {
   const prefix = variantPrefix(path);
   let cursor: string | undefined;
   do {
      const list = await env.MEDIA.list({ prefix, cursor });
      if (list.objects.length) await env.MEDIA.delete(list.objects.map((o) => o.key));
      cursor = list.truncated ? list.cursor : undefined;
   } while (cursor);
   await env.DB.prepare("DELETE FROM media_variants WHERE path = ?1").bind(path).run();
}

/**
 * The original has no media row: its variants go, unless it is in the trash (soft-deleted,
 * docs/SOFT_DELETE.md), whose variants stay until the cleanup purges it (and they go with it).
 */
async function dropIfGone(env: Env, path: string): Promise<void> {
   const trashed = await env.DB.prepare("SELECT 1 AS x FROM trash WHERE kind = 'media' AND ref = ?1 LIMIT 1").bind(path).first();
   if (!trashed) await deleteVariants(env, path);
}

async function markFailed(env: Env, path: string, reason: string): Promise<void> {
   console.error(JSON.stringify({ msg: "image variants failed", path, reason }));
   await env.DB.prepare("UPDATE media_variants SET status = 'failed', error = ?2, updated_at = ?3 WHERE path = ?1")
      .bind(path, reason.slice(0, 500), now())
      .run();
}

async function original(env: Env, path: string): Promise<{ type: string; bytes: Uint8Array } | null> {
   const row = await env.DB.prepare("SELECT mime_type FROM media WHERE path = ?1 LIMIT 1").bind(path).first<{ mime_type: string | null }>();
   if (!row) return null;
   const obj = await env.MEDIA.get(path);
   if (!obj) return null;
   return { type: (row.mime_type || obj.httpMetadata?.contentType || "").toLowerCase(), bytes: new Uint8Array(await obj.arrayBuffer()) };
}

/** Reads the original's displayed size, records the widths, sends one message per width not made yet. */
async function plan(env: Env, path: string): Promise<void> {
   const src = await original(env, path);
   if (!src) {
      await dropIfGone(env, path); // the original is gone; nothing to make
      return;
   }
   if (!isSourceType(src.type)) throw new PermanentVariantError(`unsupported type ${src.type || "(none)"}`);
   const size = probeImage(src.bytes, src.type);
   if (!size) throw new PermanentVariantError("the image header could not be read");
   if (size.width * size.height > MAX_SOURCE_PIXELS[src.type]) {
      throw new PermanentVariantError(
         `too large to resize (${size.width}×${size.height}; at most ${Math.round(MAX_SOURCE_PIXELS[src.type] / 1e6)} MP). It is served as uploaded; upload a smaller copy for faster pages.`,
      );
   }
   const widths = widthsFor(size.width)!;
   const row = await env.DB.prepare(
      "UPDATE media_variants SET status = 'processing', width = ?2, height = ?3, widths = ?4, updated_at = ?5 WHERE path = ?1 RETURNING done_widths",
   )
      .bind(path, size.width, size.height, JSON.stringify(widths), now())
      .first<{ done_widths: string }>();
   const done = new Set<number>(row ? (JSON.parse(row.done_widths) as number[]) : []);
   const todo = widths.filter((w) => !done.has(w));
   if (!todo.length) {
      await env.DB.prepare("UPDATE media_variants SET status = 'done', error = NULL, updated_at = ?2 WHERE path = ?1").bind(path, now()).run();
      return;
   }
   await env.VARIANTS!.sendBatch(todo.map((width) => ({ body: { kind: "width", path, width } satisfies VariantMessage })));
}

/** Makes one width in every format (skipping objects that already exist), then records it. */
async function makeWidth(env: Env, path: string, width: number): Promise<void> {
   const started = await env.DB.prepare(
      "UPDATE media_variants SET attempts = attempts + 1, status = CASE WHEN status = 'failed' THEN status ELSE 'processing' END, updated_at = ?2 WHERE path = ?1 RETURNING attempts, status, width, height",
   )
      .bind(path, now())
      .first<{ attempts: number; status: string; width: number | null; height: number | null }>();
   if (!started || started.status === "failed") return; // row deleted (original gone) or already flagged
   if (started.attempts > STARTS_LIMIT) {
      await markFailed(env, path, "kept failing without finishing (the image may be too large to process)");
      return;
   }
   const src = await original(env, path);
   if (!src) {
      await dropIfGone(env, path);
      return;
   }
   if (!isSourceType(src.type)) throw new PermanentVariantError(`unsupported type ${src.type}`);
   const size = probeImage(src.bytes, src.type);
   if (!size) throw new PermanentVariantError("the image header could not be read");
   const formats = formatsFor(src.type);
   const missing: typeof formats = [];
   for (const f of formats) if (!(await env.MEDIA.head(variantKey(path, width, f)))) missing.push(f);
   if (missing.length) {
      const target = Math.min(width, size.width);
      const scaled = await decodeScaled(src.bytes, src.type, size, MAX_SOURCE_PIXELS[src.type], target, heightFor(size.width, size.height, target));
      src.bytes = new Uint8Array(0);
      for (const f of missing) {
         const body = await encode(scaled, f);
         await env.MEDIA.put(variantKey(path, width, f), body, {
            httpMetadata: { contentType: VARIANT_TYPES[f], cacheControl: "public, max-age=31536000, immutable" },
            customMetadata: { source: path, width: String(target) },
            // Create-only: a concurrent duplicate message can't replace a finished object.
            onlyIf: { etagDoesNotMatch: "*" },
         });
      }
   }
   // Record the width; the row is done when every planned width is.
   await env.DB.prepare(
      `UPDATE media_variants SET
          done_widths = (SELECT json_group_array(v) FROM (SELECT DISTINCT value AS v FROM json_each(done_widths) UNION SELECT ?2 ORDER BY 1)),
          attempts = MAX(0, attempts - 1), updated_at = ?3
       WHERE path = ?1`,
   )
      .bind(path, width, now())
      .run();
   const finished = await env.DB.prepare(
      `UPDATE media_variants SET status = 'done', error = NULL, attempts = 0, updated_at = ?2
       WHERE path = ?1 AND status NOT IN ('failed', 'done') AND widths IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM json_each(widths) w WHERE w.value NOT IN (SELECT value FROM json_each(done_widths)))`,
   )
      .bind(path, now())
      .run();
   // Every size exists now: posts on the home timeline using this image get their <picture> sources.
   if (finished.meta.changes > 0) await mediaReady(env, path);
}

async function handle(env: Env, body: VariantMessage): Promise<void> {
   if (body.kind === "plan") return plan(env, body.path);
   return makeWidth(env, body.path, body.width);
}

/** Queue consumer (wrangler.jsonc `queues.consumers`). Messages are handled one at a time. */
export async function consumeVariants(batch: MessageBatch<VariantMessage>, env: Env): Promise<void> {
   for (const msg of batch.messages) {
      const body = msg.body;
      if (!body || typeof body.path !== "string" || (body.kind !== "plan" && body.kind !== "width")) {
         msg.ack();
         continue;
      }
      try {
         await handle(env, body);
         msg.ack();
      } catch (error) {
         const reason = error instanceof Error ? error.message : String(error);
         if (error instanceof PermanentVariantError || msg.attempts >= MAX_ATTEMPTS) {
            await markFailed(env, body.path, reason).catch(() => {});
            msg.ack();
         } else {
            console.warn(JSON.stringify({ msg: "image variants retry", path: body.path, attempt: msg.attempts, reason }));
            await env.DB.prepare("UPDATE media_variants SET error = ?2, updated_at = ?3 WHERE path = ?1").bind(body.path, reason.slice(0, 500), now()).run().catch(() => {});
            msg.retry({ delaySeconds: backoffSeconds(msg.attempts) });
         }
      }
   }
}

/**
 * Cron (every 30 min): queue originals that have no row yet (backfill and missed uploads), resend
 * rows whose message was lost, drop rows (and objects) of deleted originals (not of soft-deleted
 * ones in the trash: the cleanup purges those).
 */
export async function sweepVariants(env: Env, limit = 25): Promise<{ queued: number; resent: number; removed: number }> {
   if (!env.VARIANTS) return { queued: 0, resent: 0, removed: 0 };
   const { results: missing } = await env.DB.prepare(
      "SELECT m.path FROM media m LEFT JOIN media_variants v ON v.path = m.path WHERE v.path IS NULL AND m.path IS NOT NULL ORDER BY m.id DESC LIMIT ?1",
   )
      .bind(limit)
      .all<{ path: string }>();
   let queued = 0;
   for (const { path } of missing) if (await enqueueVariants(env, path)) queued++;

   const staleBefore = new Date(Date.now() - STALE_MS).toISOString();
   const { results: stale } = await env.DB.prepare(
      "UPDATE media_variants SET updated_at = ?2 WHERE path IN (SELECT path FROM media_variants WHERE status IN ('queued', 'processing') AND updated_at < ?1 LIMIT ?3) RETURNING path",
   )
      .bind(staleBefore, now(), limit)
      .all<{ path: string }>();
   if (stale.length) await env.VARIANTS.sendBatch(stale.map(({ path }) => ({ body: { kind: "plan", path } satisfies VariantMessage })));

   const { results: orphans } = await env.DB.prepare(
      "SELECT v.path FROM media_variants v LEFT JOIN media m ON m.path = v.path WHERE m.path IS NULL AND NOT EXISTS (SELECT 1 FROM trash t WHERE t.kind = 'media' AND t.ref = v.path) LIMIT ?1",
   )
      .bind(limit)
      .all<{ path: string }>();
   for (const { path } of orphans) await deleteVariants(env, path);
   return { queued, resent: stale.length, removed: orphans.length };
}

/** Rows for the staff screens: failed ones (flag + Retry) and a status per path. */
export async function failedVariants(env: Env, limit = 50): Promise<VariantRow[]> {
   const { results } = await env.DB.prepare("SELECT * FROM media_variants WHERE status = 'failed' ORDER BY updated_at DESC LIMIT ?1").bind(limit).all<VariantRow>();
   return results;
}

export async function variantStatuses(env: Env, paths: string[]): Promise<Map<string, VariantRow>> {
   const out = new Map<string, VariantRow>();
   if (!paths.length) return out;
   for (let i = 0; i < paths.length; i += 90) {
      const chunk = paths.slice(i, i + 90);
      const { results } = await env.DB.prepare(`SELECT * FROM media_variants WHERE path IN (${chunk.map((_, j) => `?${j + 1}`).join(",")})`)
         .bind(...chunk)
         .all<VariantRow>();
      for (const r of results) out.set(r.path, r);
   }
   return out;
}
