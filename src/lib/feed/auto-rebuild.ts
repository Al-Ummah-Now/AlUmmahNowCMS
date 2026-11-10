/**
 * Rebuilds the home timeline automatically when its stored FORMAT is not the deployed code's
 * FEED_FORMAT (docs/FEED.md "Format version"; src/lib/feed/format.ts). No human step:
 *
 *   - the release pipeline (scripts/release/feed-format.ts) calls POST /api/release/v1/feed-format right
 *     after the stage and production promotes and after the QA deploy, then polls GET until the
 *     stamp matches;
 *   - safety net, lazily: the every-minute cron and every public /timeline read check the stamp
 *     (KV head first, then D1) and start the rebuild in the background (waitUntil). Readers keep
 *     getting the old feed until the new one is published, as with any build.
 *
 * Only one rebuild starts: a KV lock (FORMAT_LOCK_KEY, 10 min) keeps the lazy callers from even
 * trying, and the D1 claim (claimFormatRebuild, one INSERT … WHERE NOT EXISTS) is the authority.
 * The rebuild itself is the same full rebuild as the Timeline screen's button (feed_dirty "all" →
 * the queue → runBuild), so it is idempotent and logged; every automatic one is recorded in
 * timeline_changes as action "rebuild" by "system/release".
 */
import type { Env } from "../../env.ts";
import { logRebuild, type Actor } from "./admin.ts";
import { FEED_FORMAT, headFormat } from "./format.ts";
import { claimFormatRebuild, fullRebuildPending } from "./jobs.ts";
import { FEED_LOCALES, headKey, type FeedLocale } from "./model.ts";

export const FORMAT_LOCK_KEY = "feed:format-lock";
export const FORMAT_LOCK_TTL_S = 600;
export const SYSTEM_RELEASE: Actor = { id: null, email: "system/release" };

/** What asked: the release pipeline, a public read, or the cron. */
export type FormatTrigger = "release" | "read" | "cron";

export interface FormatState {
   /** This code's FEED_FORMAT. */
   code: number;
   /** The `format` of each locale's published head (0: written before formats; null: no head). */
   heads: Record<FeedLocale, number | null>;
   /** feed_state.format: the format of the last finished full rebuild (0: never). */
   built: number;
   /** A full rebuild for this format is queued or running. */
   rebuilding: boolean;
   /** Everything published is in this code's format. */
   current: boolean;
}

export interface EnsureResult {
   action: "current" | "started" | "in_progress" | "locked" | "unavailable";
   /** The head formats seen, per locale. */
   heads?: Record<FeedLocale, number | null>;
}

async function readHeads(env: Env): Promise<Record<FeedLocale, number | null>> {
   const out = {} as Record<FeedLocale, number | null>;
   for (const l of FEED_LOCALES) {
      const head = await env.FEED!.get(headKey(l), {
         type: "json",
         cacheTtl: 30,
      });
      out[l] = head ? headFormat(head) : null;
   }
   return out;
}

async function builtFormat(env: Env): Promise<number> {
   const row = await env.DB.prepare("SELECT format FROM feed_state WHERE id = 1").first<{ format: number | null }>();
   return Number(row?.format ?? 0);
}

/** The stamp, for the release pipeline's check (GET /api/release/v1/feed-format) and the Timeline screen. */
export async function feedFormatState(env: Env): Promise<FormatState> {
   const heads = env.FEED ? await readHeads(env) : ({ en: null, ar: null } as Record<FeedLocale, number | null>);
   const [built, rebuilding] = await Promise.all([builtFormat(env), fullRebuildPending(env)]);
   const current = built === FEED_FORMAT && FEED_LOCALES.every((l) => heads[l] === FEED_FORMAT);
   return { code: FEED_FORMAT, heads, built, rebuilding, current };
}

/**
 * Starts the format rebuild when the stored feed is in another format. Cheap when it is current
 * (two cached KV reads). `lock: false` (the release pipeline) goes straight to the D1 claim, so a
 * lazy caller's lock never makes the pipeline wait for a rebuild nobody started.
 */
export async function ensureFeedFormat(env: Env, trigger: FormatTrigger, opts: { lock?: boolean } = {}): Promise<EnsureResult> {
   if (!env.FEED) return { action: "unavailable" };
   const heads = await readHeads(env);
   if (FEED_LOCALES.every((l) => heads[l] === FEED_FORMAT)) return { action: "current", heads };
   // A head that is missing altogether is the verifier's job (it queues a full rebuild); here only
   // the stamp matters. D1 is exact where KV may still serve a cached head for up to a minute.
   const built = await builtFormat(env);
   if (built === FEED_FORMAT) return { action: "current", heads };
   if (await fullRebuildPending(env)) return { action: "in_progress", heads };
   if (opts.lock !== false) {
      if (await env.FEED.get(FORMAT_LOCK_KEY)) return { action: "locked", heads };
   }
   await env.FEED.put(
      FORMAT_LOCK_KEY,
      JSON.stringify({
         trigger,
         format: FEED_FORMAT,
         at: new Date().toISOString(),
      }),
      { expirationTtl: FORMAT_LOCK_TTL_S },
   );
   const reason = `format ${built} → ${FEED_FORMAT} (${trigger})`;
   if (!(await claimFormatRebuild(env, reason))) return { action: "in_progress", heads };
   console.log(
      JSON.stringify({
         msg: "feed format rebuild started",
         trigger,
         from: built,
         to: FEED_FORMAT,
         heads,
         actor: SYSTEM_RELEASE.email,
      }),
   );
   await logRebuild(env, SYSTEM_RELEASE, {
      reason: "format",
      trigger,
      from: built,
      to: FEED_FORMAT,
   }).catch((e) => console.error("feed rebuild log failed", String(e)));
   return { action: "started", heads };
}

/**
 * The lazy check, at most once a minute per isolate, and never again in an isolate that saw the feed
 * current (the stamp only changes with a deploy, which starts new isolates). Never throws.
 */
let seenCurrent = false;
let lastCheck = 0;
export async function checkFeedFormat(env: Env, trigger: Exclude<FormatTrigger, "release">, now = Date.now()): Promise<EnsureResult | null> {
   if (seenCurrent || now - lastCheck < 60_000) return null;
   lastCheck = now;
   try {
      const r = await ensureFeedFormat(env, trigger);
      if (r.action === "current") seenCurrent = true;
      return r;
   } catch (error) {
      console.error("feed format check failed", trigger, String(error));
      return null;
   }
}

/** Tests: forget what this isolate has seen. */
export function resetFormatCheck(): void {
   seenCurrent = false;
   lastCheck = 0;
}
