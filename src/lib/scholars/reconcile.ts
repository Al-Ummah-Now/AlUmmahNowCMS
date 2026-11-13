/**
 * The nightly scholar reference check (issue #1217; wiki AUN-SCHOLAR-SITES §11 "Refs drift from their
 * community posts"). api-videos' outbox keeps refs in step on every change and the queue retries; this
 * catches what still slipped through (a dead-lettered message, an outage longer than the retries).
 *
 * Per scholar with a primary channel (at most MAX_SCHOLARS a night, oldest check first):
 *   1. api-videos' digest of the channel's newest ≤ 200 posts: { id, live, updatedAt } (one call).
 *   2. That channel's refs: ONE indexed query (posts.ref_channel_id, migration 0020).
 *   3. Repairs only the differences, at most MAX_REPAIRS a night in all:
 *      - a live post with no ref, a drafted ref or a ref older than the post → re-read and upsert;
 *      - a published ref whose post is not live → removeRef (drafted: www answers 404);
 *      - a published ref missing from a COMPLETE digest → re-checked by id, removed if gone.
 * No scans: scholars by primary_channel_id (indexed), refs by ref_channel_id (indexed).
 */
import type { Env } from "../../env.ts";
import { log, errText } from "../log.ts";
import { removeRef, upsertRef } from "./refs.ts";
import { channelDigest, communityPost } from "./videos-internal.ts";
import type { PostLike } from "../post-schema.generated.ts";

export const MAX_SCHOLARS = 50;
export const MAX_REPAIRS = 50;

export interface ReconcileResult {
   channels: number;
   checked: number;
   upserted: number;
   removed: number;
   failed: number;
   capped: boolean;
}

const time = (v: unknown): number => {
   const t = typeof v === "string" ? Date.parse(v) : Number.NaN;
   return Number.isNaN(t) ? 0 : t;
};

export async function reconcileRefs(env: Env, opts: { fetch?: typeof fetch } = {}): Promise<ReconcileResult> {
   const out: ReconcileResult = { channels: 0, checked: 0, upserted: 0, removed: 0, failed: 0, capped: false };
   const { results: scholars } = await env.DB.prepare(
      "SELECT DISTINCT primary_channel_id AS ch FROM scholars WHERE primary_channel_id IS NOT NULL ORDER BY primary_channel_id LIMIT ?1",
   )
      .bind(MAX_SCHOLARS)
      .all<{ ch: string }>();
   let repairs = 0;
   const repair = async (fn: () => Promise<unknown>) => {
      if (repairs >= MAX_REPAIRS) {
         out.capped = true;
         return;
      }
      repairs++;
      try {
         await fn();
      } catch (error) {
         out.failed++;
         log.warn("scholar ref check: repair failed", { error: errText(error) });
      }
   };
   for (const { ch } of scholars) {
      if (out.capped) break;
      let digest;
      try {
         digest = await channelDigest(env, ch, opts.fetch);
      } catch (error) {
         out.failed++;
         log.warn("scholar ref check: digest failed", { channel: ch, error: errText(error) });
         continue;
      }
      out.channels++;
      const { results: refs } = await env.DB.prepare("SELECT ref_post_id, status, updated_at FROM posts WHERE ref_channel_id = ?1").bind(ch).all<{ ref_post_id: string; status: string; updated_at: string | null }>();
      const byId = new Map(refs.map((r) => [r.ref_post_id, r]));
      const posts = digest?.posts ?? [];
      const seen = new Set<string>();
      for (const p of posts) {
         seen.add(p.id);
         out.checked++;
         const ref = byId.get(p.id);
         if (p.live && (!ref || ref.status !== "published" || time(ref.updated_at) < time(p.updatedAt))) {
            await repair(async () => {
               const post = await communityPost(env, ch, p.id, opts.fetch);
               if (post) {
                  const r = await upsertRef(env, p.id, ch, post as PostLike);
                  if (r.status === "ok") out.upserted++;
               } else if (ref?.status === "published") {
                  await removeRef(env, p.id, ch);
                  out.removed++;
               }
            });
         } else if (!p.live && ref?.status === "published") {
            await repair(async () => {
               await removeRef(env, p.id, ch);
               out.removed++;
            });
         }
      }
      // Refs the digest does not name: only judged when the digest covered the whole channel (or the
      // channel is gone); then each is re-checked by id before it is removed.
      if (!digest || digest.complete) {
         for (const ref of refs) {
            if (seen.has(ref.ref_post_id) || ref.status !== "published") continue;
            out.checked++;
            await repair(async () => {
               // Always re-read by id: only a post api-videos says is gone (404) loses its ref.
               const post = await communityPost(env, ch, ref.ref_post_id, opts.fetch);
               if (!post) {
                  await removeRef(env, ref.ref_post_id, ch);
                  out.removed++;
               }
            });
         }
      }
   }
   if (out.upserted || out.removed || out.failed || out.capped) log.warn("scholar ref check repaired drift", { ...out });
   return out;
}

/** The 30-minute cron runs the check once a night: the run that fires at 03:00 UTC. */
export const isReconcileSlot = (scheduledTime: number) => {
   const d = new Date(scheduledTime);
   return d.getUTCHours() === 3 && d.getUTCMinutes() < 30;
};
