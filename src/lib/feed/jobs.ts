/**
 * Publishing the home timeline to Workers KV (docs/FEED.md). Nothing here runs in a public request.
 *
 *   change (post saved/deleted/restored, Timeline screen, publish_at passing, snapshot refresh,
 *   cover variants ready, verifier repair, admin "Rebuild")
 *     → markDirty(): one row per touched item in D1 `feed_dirty`, and ONE queue message while none
 *       is pending (feed_state.queued_at) — a burst of edits is one rebuild
 *     → consumeFeed(): claims every dirty row, works out the weeks they left and entered, rewrites
 *       only those week buckets (new versioned keys), the year index of the years that changed,
 *       then the head (pointer + first page) LAST, once per locale per build. Unchanged buckets
 *       (same checksum) are not written. Superseded keys are deleted GC_DELAY_MS later.
 *
 * Failures: a thrown build records the reason (feed_state.last_error) and retries with backoff;
 * after the queue's max_retries the message lands in the DLQ, whose consumer flags the admin
 * (Overview: reason + Retry). The dirty rows stay until a build succeeds, so Retry (or the next
 * change) picks everything up. KV keeps serving the last good build meanwhile.
 *
 * KV rules this follows: no key is read before it exists (bucket and year keys are versioned and
 * written before the head that names them; KV caches misses), and the one overwritten key (the
 * head) is written at most once per build, at least HEAD_WRITE_GAP_MS apart (KV allows 1 write/s
 * per key). The consumer runs with max_concurrency 1, so builds never overlap.
 */
import type { Env } from "../../env.ts";
import { lookupItem } from "../videos.ts";
import { putSnapshot } from "../video-snapshots.ts";
import { bodyVideoIds, feedItems, liteItems, liteSig } from "./source.ts";
import {
   checksum,
   cursorOf,
   FEED_LOCALES,
   FEED_VERSION,
   GC_DELAY_MS,
   HEAD_SIZE,
   TOMBSTONE_MS,
   headKey,
   isoWeek,
   PAGE_SIZE,
   weekKey,
   weekRange,
   weekYear,
   yearKey,
   type FeedItem,
   type FeedLocale,
   type WeekPtr,
   type WeekTombstone,
   type HeadDoc,
   type WeekDoc,
   type YearDoc,
} from "./model.ts";

export interface FeedMessage {
   kind: "build";
   reason: string;
}

/** Weeks rewritten per run at most; the rest stay dirty and a follow-up message continues. */
export const MAX_WEEKS_PER_RUN = 40;
/** A queue message still pending after this long is assumed lost; the next change sends another. */
export const QUEUED_STALE_MS = 2 * 60_000;
export const HEAD_WRITE_GAP_MS = 1_100;
/** Retry backoff for a failed build (seconds): 30 s, 1, 2, 4, 8, 15 min. */
export const backoffSeconds = (attempt: number) => Math.min(900, 30 * 2 ** Math.max(0, attempt - 1));

const nowIso = () => new Date().toISOString();
type Dirty = { id: number; item: string };

/* Requesting a build */

/**
 * Records what changed and wakes the builder. Items: "p<postId>", "v<entryId>", "w:<l>:<week>",
 * "head:<l>", "all". Safe to call from anywhere (bknd plugin, routes, cron); never throws.
 */
export async function markDirty(env: Env, items: string[], reason: string): Promise<void> {
   if (!items.length) return;
   try {
      const at = nowIso();
      const stmts = items.map((item) => env.DB.prepare("INSERT INTO feed_dirty (item, created_at) VALUES (?1, ?2)").bind(item, at));
      for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
      await wake(env, reason);
   } catch (error) {
      // The change itself is saved; the verifier (every 30 min) repairs a missed rebuild.
      console.error("feed markDirty failed", reason, String(error));
   }
}

/** Sends one build message unless one is already pending (queued_at), so bursts coalesce. */
export async function wake(env: Env, reason: string, force = false): Promise<boolean> {
   if (!env.FEED_JOBS) return false;
   const at = nowIso();
   const stale = new Date(Date.now() - QUEUED_STALE_MS).toISOString();
   const claimed = await env.DB.prepare(
      `UPDATE feed_state SET queued_at = ?1, updated_at = ?1 WHERE id = 1 AND (?3 OR queued_at IS NULL OR queued_at < ?2) RETURNING id`,
   )
      .bind(at, stale, force ? 1 : 0)
      .first();
   if (!claimed) return false;
   await env.FEED_JOBS.send({ kind: "build", reason } satisfies FeedMessage, { delaySeconds: 2 });
   return true;
}

/* Building */

export interface BuildResult {
   claimed: number;
   weeks: number;
   writes: string[];
   deferred: number;
   heads: FeedLocale[];
}

const newBuildId = () => `${Date.now().toString(36)}${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;

interface WeekRow {
   week: string;
   key: string;
   build: string;
   older: string | null;
   count: number;
   newest: string;
   oldest: string;
   sig: string;
   lite: string;
}

/** One build: everything dirty right now (up to MAX_WEEKS_PER_RUN weeks). Idempotent. */
export async function runBuild(env: Env, opts: { now?: () => Date; sleep?: (ms: number) => Promise<void>; maxWeeks?: number } = {}): Promise<BuildResult> {
   if (!env.FEED) throw new Error("FEED KV binding missing");
   const clock = opts.now ?? (() => new Date());
   const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
   const result: BuildResult = { claimed: 0, weeks: 0, writes: [], deferred: 0, heads: [] };
   const { results: dirty } = await env.DB.prepare("SELECT id, item FROM feed_dirty ORDER BY id LIMIT 2000").all<Dirty>();
   result.claimed = dirty.length;
   if (!dirty.length) return result;
   const maxId = dirty[dirty.length - 1].id;

   // Which weeks and heads changed, per locale.
   const weeks = new Map<FeedLocale, Set<string>>(FEED_LOCALES.map((l) => [l, new Set<string>()]));
   const heads = new Set<FeedLocale>();
   const posts = new Set<number>();
   const entries = new Set<number>();
   let all = false;
   for (const { item } of dirty) {
      if (item === "all") all = true;
      else if (/^p\d+$/.test(item)) posts.add(Number(item.slice(1)));
      else if (/^v\d+$/.test(item)) entries.add(Number(item.slice(1)));
      else {
         const w = /^w:(en|ar):(\d{4}-W\d{2})$/.exec(item);
         const h = /^head:(en|ar)$/.exec(item);
         if (w) {
            weeks.get(w[1] as FeedLocale)!.add(w[2]);
            heads.add(w[1] as FeedLocale);
         } else if (h) heads.add(h[1] as FeedLocale);
      }
   }
   for (const l of FEED_LOCALES) {
      if (all) {
         for (const r of await liteItems(env, l, { pinned: false })) weeks.get(l)!.add(isoWeek(r.date));
         const { results } = await env.DB.prepare("SELECT week FROM feed_weeks WHERE locale = ?1").bind(l).all<{ week: string }>();
         for (const r of results) weeks.get(l)!.add(r.week);
         heads.add(l);
         continue;
      }
      if (!posts.size && !entries.size) continue;
      const keys = [...[...posts].map((id) => `p${id}`), ...[...entries].map((id) => `v${id}`)];
      // Where the items were (feed_items) and where they belong now.
      for (let i = 0; i < keys.length; i += 90) {
         const part = keys.slice(i, i + 90);
         const { results } = await env.DB.prepare(`SELECT week FROM feed_items WHERE locale = ?1 AND item IN (${part.map((_, j) => `?${j + 2}`).join(",")})`)
            .bind(l, ...part)
            .all<{ week: string }>();
         for (const r of results) if (r.week !== "pinned") weeks.get(l)!.add(r.week);
         if (results.length) heads.add(l);
      }
      const now = await liteItems(env, l, { posts: [...posts], entries: [...entries] });
      for (const r of now) if (!r.pinned) weeks.get(l)!.add(isoWeek(r.date));
      if (now.length) heads.add(l);
   }

   // Bound the work of one run; the rest is carried to the next message.
   const maxWeeks = opts.maxWeeks ?? MAX_WEEKS_PER_RUN;
   const carry: string[] = [];
   let budget = maxWeeks;
   for (const l of FEED_LOCALES) {
      const sorted = [...weeks.get(l)!].sort().reverse(); // newest weeks first
      const take = sorted.slice(0, Math.max(0, budget));
      for (const w of sorted.slice(take.length)) carry.push(`w:${l}:${w}`);
      weeks.set(l, new Set(take));
      budget -= take.length;
   }
   result.deferred = carry.length;

   const build = newBuildId();
   const written: string[] = [];
   /** Week versions replaced in this build → their tombstone (written after the head flip). */
   const tombstones: { key: string; doc: WeekTombstone }[] = [];
   const oldYears: string[] = [];
   const put = async (key: string, value: string) => {
      await env.FEED!.put(key, value);
      written.push(key);
      result.writes.push(key);
   };
   try {
      await ensureBodySnapshots(env, [...posts]);
      for (const l of FEED_LOCALES) {
         const lw = weeks.get(l)!;
         if (!lw.size && !heads.has(l)) continue;
         const at = clock().toISOString();
         const { results: rows } = await env.DB.prepare("SELECT * FROM feed_weeks WHERE locale = ?1").bind(l).all<WeekRow>();
         const existing = new Map(rows.map((r) => [r.week, r]));

         // 1. New content of the dirty weeks.
         const content = new Map<string, FeedItem[]>();
         const lites = new Map<string, string>();
         for (const week of lw) {
            result.weeks++;
            const range = weekRange(week);
            content.set(week, await feedItems(env, l, { pinned: false, range }));
            lites.set(week, checksum(liteSig(await liteItems(env, l, { pinned: false, range }))));
         }
         // 2. The non-empty weeks after this build, newest first; each points to the next one.
         const final = new Set([...existing.keys()]);
         for (const [w, items] of content) {
            if (items.length) final.add(w);
            else final.delete(w);
         }
         const order = [...final].sort().reverse();
         const olderOf = new Map(order.map((w, i) => [w, order[i + 1] ?? null]));
         // 3. Weeks to (re)write: the dirty ones, and any week whose older neighbour appeared or went.
         const candidates = new Set([...lw].filter((w) => final.has(w)));
         for (const w of order) if (!lw.has(w) && (existing.get(w)!.older?.split(".")[0] ?? null) !== olderOf.get(w)) candidates.add(w);
         // Oldest first, so each week knows the build its older neighbour ends up with.
         const builds = new Map<string, string>();
         const changedYears = new Set<number>();
         const stmts: D1PreparedStatement[] = [];
         for (const week of [...final].sort()) {
            const prev = existing.get(week);
            if (!candidates.has(week)) {
               builds.set(week, prev!.build);
               continue;
            }
            const items = content.get(week) ?? (await feedItems(env, l, { pinned: false, range: weekRange(week) }));
            const olderWeek = olderOf.get(week) ?? null;
            const older = olderWeek ? { week: olderWeek, build: builds.get(olderWeek)! } : null;
            // The signature names the older WEEK, not its build: a newer version of the older week
            // is reached through its tombstone, so it never forces a rewrite up the chain.
            const sig = checksum(JSON.stringify({ items, older: olderWeek }));
            const lite = lites.get(week) ?? prev?.lite ?? "";
            for (const it of items) stmts.push(env.DB.prepare("INSERT OR REPLACE INTO feed_items (locale, item, week) VALUES (?1, ?2, ?3)").bind(l, it.key, week));
            if (prev && prev.sig === sig) {
               builds.set(week, prev.build);
               if (prev.lite !== lite) stmts.push(env.DB.prepare("UPDATE feed_weeks SET lite = ?3 WHERE locale = ?1 AND week = ?2").bind(l, week, lite));
               continue;
            }
            const doc: WeekDoc = { v: FEED_VERSION, week, build, items, older };
            await put(weekKey(l, week, build), JSON.stringify(doc));
            builds.set(week, build);
            changedYears.add(weekYear(week));
            if (prev) tombstones.push({ key: prev.key, doc: { v: FEED_VERSION, week, moved: build } });
            stmts.push(
               env.DB.prepare(
                  `INSERT INTO feed_weeks (locale, week, key, build, older, count, newest, oldest, sig, lite, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
                   ON CONFLICT (locale, week) DO UPDATE SET key = excluded.key, build = excluded.build, older = excluded.older, count = excluded.count,
                     newest = excluded.newest, oldest = excluded.oldest, sig = excluded.sig, lite = excluded.lite, updated_at = excluded.updated_at`,
               ).bind(l, week, weekKey(l, week, build), build, older ? `${older.week}.${older.build}` : null, items.length, cursorOf(items[0]), cursorOf(items[items.length - 1]), sig, lite, at),
            );
         }
         // Weeks that emptied: gone (their tombstone says so; readers fall back to the index).
         for (const week of lw) {
            const prev = existing.get(week);
            if (final.has(week) || !prev) continue;
            changedYears.add(weekYear(week));
            tombstones.push({ key: prev.key, doc: { v: FEED_VERSION, week, gone: true } });
            stmts.push(env.DB.prepare("DELETE FROM feed_weeks WHERE locale = ?1 AND week = ?2").bind(l, week));
         }
         for (const week of lw) stmts.unshift(env.DB.prepare("DELETE FROM feed_items WHERE locale = ?1 AND week = ?2").bind(l, week));
         await batch(env, stmts);

         // Year indexes of the years whose weeks changed.
         for (const year of changedYears) {
            const prev = await env.DB.prepare("SELECT key, sig FROM feed_years WHERE locale = ?1 AND year = ?2").bind(l, year).first<{ key: string; sig: string }>();
            const { results } = await env.DB.prepare("SELECT * FROM feed_weeks WHERE locale = ?1 AND week LIKE ?2 ORDER BY week DESC").bind(l, `${year}-W%`).all<WeekRow>();
            if (!results.length) {
               if (prev) {
                  oldYears.push(prev.key);
                  await env.DB.prepare("DELETE FROM feed_years WHERE locale = ?1 AND year = ?2").bind(l, year).run();
               }
               continue;
            }
            const doc: YearDoc = { v: FEED_VERSION, year, weeks: results.map((w) => ({ week: w.week, key: w.key, count: w.count, newest: w.newest, oldest: w.oldest })) };
            const json = JSON.stringify(doc);
            const sig = checksum(json);
            if (prev?.sig === sig) continue;
            const key = yearKey(l, year, build);
            await put(key, json);
            if (prev) oldYears.push(prev.key);
            const count = results.reduce((n, w) => n + w.count, 0);
            await env.DB.prepare(
               `INSERT INTO feed_years (locale, year, key, count, sig, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                ON CONFLICT (locale, year) DO UPDATE SET key = excluded.key, count = excluded.count, sig = excluded.sig, updated_at = excluded.updated_at`,
            )
               .bind(l, year, key, count, sig, at)
               .run();
         }

         // The head: pointer + first page. Written last, and only when it changed.
         const pinned = await feedItems(env, l, { pinned: true });
         const top = await feedItems(env, l, { pinned: false, limit: HEAD_SIZE + 1 });
         const items = top.slice(0, HEAD_SIZE);
         const { results: years } = await env.DB.prepare(
            "SELECT y.year, y.key, y.count, (SELECT w.oldest FROM feed_weeks w WHERE w.locale = y.locale AND w.week LIKE y.year || '-W%' ORDER BY w.week LIMIT 1) AS oldest FROM feed_years y WHERE y.locale = ?1 ORDER BY y.year DESC",
         )
            .bind(l)
            .all<{ year: number; key: string; count: number; oldest: string | null }>();
         const headWeekIds = [...new Set(items.map((it) => isoWeek(it.date)))];
         const { results: hw } = headWeekIds.length
            ? await env.DB.prepare(`SELECT week, build, older, oldest FROM feed_weeks WHERE locale = ?1 AND week IN (${headWeekIds.map((_, i) => `?${i + 2}`).join(",")}) ORDER BY week DESC`)
                 .bind(l, ...headWeekIds)
                 .all<{ week: string; build: string; older: string | null; oldest: string }>()
            : { results: [] };
         const body = {
            pinned,
            items,
            more: top.length > HEAD_SIZE,
            total: years.reduce((n, y) => n + y.count, 0),
            weeks: hw.map((w) => ({ week: w.week, build: w.build, oldest: w.oldest, older: ptrOf(w.older) })),
            years: years.map((y) => ({ year: y.year, key: y.key, count: y.count, oldest: y.oldest ?? "" })),
         };
         const sig = checksum(JSON.stringify(body));
         const headLite = checksum(liteSig([...(await liteItems(env, l, { pinned: true })), ...(await liteItems(env, l, { pinned: false, limit: HEAD_SIZE + 1 }))]));
         const prevHead = await env.DB.prepare("SELECT sig, build, built_at FROM feed_heads WHERE locale = ?1").bind(l).first<{ sig: string; build: string; built_at: string }>();
         const pinStmts = [
            env.DB.prepare("DELETE FROM feed_items WHERE locale = ?1 AND week = 'pinned'").bind(l),
            ...pinned.map((it) => env.DB.prepare("INSERT OR REPLACE INTO feed_items (locale, item, week) VALUES (?1, ?2, 'pinned')").bind(l, it.key)),
         ];
         if (prevHead?.sig === sig && !all) {
            await batch(env, [...pinStmts, env.DB.prepare("UPDATE feed_heads SET lite = ?2 WHERE locale = ?1").bind(l, headLite)]);
            continue;
         }
         const builtAt = clock().toISOString();
         const head: HeadDoc = { v: FEED_VERSION, locale: l, build, built_at: builtAt, page_size: PAGE_SIZE, ...body };
         // KV allows one write per second per key: never rewrite this head sooner than that.
         const gap = prevHead?.built_at ? HEAD_WRITE_GAP_MS - (clock().getTime() - Date.parse(prevHead.built_at)) : 0;
         if (gap > 0) await sleep(gap);
         await env.FEED.put(headKey(l), JSON.stringify(head));
         result.writes.push(headKey(l));
         result.heads.push(l);
         await batch(env, [
            ...pinStmts,
            env.DB.prepare(
               `INSERT INTO feed_heads (locale, build, sig, lite, built_at) VALUES (?1, ?2, ?3, ?4, ?5)
                ON CONFLICT (locale) DO UPDATE SET build = excluded.build, sig = excluded.sig, lite = excluded.lite, built_at = excluded.built_at`,
            ).bind(l, build, sig, headLite, builtAt),
            env.DB.prepare("UPDATE feed_state SET last_head_write_at = ?1 WHERE id = 1").bind(clock().toISOString()),
         ]);
      }
   } catch (error) {
      // Keys written by this failed build are referenced by nothing: delete them at the next GC.
      const at = clock().toISOString();
      await batch(env, written.map((k) => env.DB.prepare("INSERT OR IGNORE INTO feed_garbage (key, delete_after) VALUES (?1, ?2)").bind(k, at))).catch(() => {});
      throw error;
   }

   // After the flip: superseded week versions become tombstones (a cached cursor or a stale pointer
   // follows them to the new version, never to old items), deleted after TOMBSTONE_MS.
   for (const t of tombstones) {
      await env.FEED.put(t.key, JSON.stringify(t.doc));
      result.writes.push(t.key);
   }
   const now = clock().getTime();
   const at = new Date(now).toISOString();
   await batch(env, [
      ...tombstones.map((t) => env.DB.prepare("INSERT OR REPLACE INTO feed_garbage (key, delete_after) VALUES (?1, ?2)").bind(t.key, new Date(now + TOMBSTONE_MS).toISOString())),
      ...oldYears.map((k) => env.DB.prepare("INSERT OR REPLACE INTO feed_garbage (key, delete_after) VALUES (?1, ?2)").bind(k, new Date(now + GC_DELAY_MS).toISOString())),
      env.DB.prepare("DELETE FROM feed_dirty WHERE id <= ?1").bind(maxId),
      ...carry.map((item) => env.DB.prepare("INSERT INTO feed_dirty (item, created_at) VALUES (?1, ?2)").bind(item, at)),
      env.DB.prepare(
         "UPDATE feed_state SET last_build = ?1, last_build_at = ?2, attempts = 0, last_error = NULL, failed_at = NULL, dead_at = NULL, full_total = CASE WHEN ?3 THEN full_total ELSE NULL END, full_requested_at = CASE WHEN ?3 THEN full_requested_at ELSE NULL END, updated_at = ?2 WHERE id = 1",
      ).bind(build, at, carry.length ? 1 : 0),
   ]);
   return result;
}

const ptrOf = (v: string | null): WeekPtr | null => {
   const m = v ? /^(\d{4}-W\d{2})\.([a-z0-9]+)$/.exec(v) : null;
   return m ? { week: m[1], build: m[2] } : null;
};

async function batch(env: Env, stmts: D1PreparedStatement[]): Promise<void> {
   for (let i = 0; i < stmts.length; i += 80) await env.DB.batch(stmts.slice(i, i + 80));
}

/**
 * Body videos (`::video[ID]`) of the posts being rebuilt that have no snapshot yet: looked up once
 * (public items only) and stored in video_snapshots, which the cron refreshes from then on. A
 * failed lookup leaves the video without a snapshot (www shows a plain player card for it).
 */
async function ensureBodySnapshots(env: Env, postIds: number[]): Promise<void> {
   if (!postIds.length || !env.VIDEOS_API_URL) return;
   const ids = new Set<string>();
   for (let i = 0; i < postIds.length; i += 90) {
      const part = postIds.slice(i, i + 90);
      const { results } = await env.DB.prepare(`SELECT body FROM posts WHERE id IN (${part.map((_, j) => `?${j + 1}`).join(",")}) AND body LIKE '%::video[%'`)
         .bind(...part)
         .all<{ body: string }>();
      for (const r of results) for (const id of bodyVideoIds(r.body)) ids.add(id);
   }
   if (!ids.size) return;
   const list = [...ids];
   const { results } = await env.DB.prepare(`SELECT ref_id FROM video_snapshots WHERE kind = 'video' AND ref_id IN (${list.map((_, j) => `?${j + 1}`).join(",")})`)
      .bind(...list)
      .all<{ ref_id: string }>();
   const have = new Set(results.map((r) => r.ref_id));
   for (const id of list.filter((x) => !have.has(x)).slice(0, 10)) {
      try {
         const item = await lookupItem(env.VIDEOS_API_URL.replace(/\/+$/, ""), "video", id);
         if (item) await putSnapshot(env.DB, item);
      } catch (error) {
         console.warn("feed body video lookup failed", id, String(error));
      }
   }
}

/* Queue consumers */

/** The feed queue: one build per batch (messages are only wake-ups; the work is in feed_dirty). */
export async function consumeFeed(batch: MessageBatch<FeedMessage>, env: Env): Promise<void> {
   await env.DB.prepare("UPDATE feed_state SET queued_at = NULL WHERE id = 1").run();
   try {
      const r = await runBuild(env);
      console.log(JSON.stringify({ msg: "feed build", claimed: r.claimed, weeks: r.weeks, writes: r.writes.length, deferred: r.deferred }));
      batch.ackAll();
      await collectGarbage(env).catch((e) => console.error("feed gc failed", String(e)));
      // More dirty work arrived meanwhile, or this run carried weeks over: go again.
      const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM feed_dirty").first<{ n: number }>();
      if (Number(left?.n ?? 0) > 0) await wake(env, "continue", true);
   } catch (error) {
      const reason = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const attempts = Math.max(...batch.messages.map((m) => m.attempts), 1);
      console.warn(JSON.stringify({ msg: "feed build retry", attempt: attempts, reason }));
      await env.DB.prepare("UPDATE feed_state SET attempts = ?1, last_error = ?2, failed_at = ?3, updated_at = ?3 WHERE id = 1")
         .bind(attempts, reason.slice(0, 500), nowIso())
         .run()
         .catch(() => {});
      batch.retryAll({ delaySeconds: backoffSeconds(attempts) });
   }
}

/** The feed DLQ: a build that kept failing. Flag it for the admin (Overview: reason + Retry). */
export async function consumeFeedDlq(batch: MessageBatch<unknown>, env: Env): Promise<void> {
   const at = nowIso();
   await env.DB.prepare("UPDATE feed_state SET dead_at = ?1, queued_at = NULL, last_error = coalesce(last_error, 'the build kept failing'), updated_at = ?1 WHERE id = 1").bind(at).run();
   console.error(JSON.stringify({ msg: "feed build dead-lettered", messages: batch.messages.length }));
   batch.ackAll();
}

/* Admin actions */

export async function retryFeed(env: Env): Promise<boolean> {
   await env.DB.prepare("UPDATE feed_state SET dead_at = NULL, attempts = 0, updated_at = ?1 WHERE id = 1").bind(nowIso()).run();
   return wake(env, "retry", true);
}

/** Disaster recovery: rebuild every week bucket (in runs of MAX_WEEKS_PER_RUN, with progress). */
export async function requestFullRebuild(env: Env): Promise<void> {
   let total = 0;
   for (const l of FEED_LOCALES) {
      const weeks = new Set((await liteItems(env, l, { pinned: false })).map((r) => isoWeek(r.date)));
      const { results } = await env.DB.prepare("SELECT week FROM feed_weeks WHERE locale = ?1").bind(l).all<{ week: string }>();
      for (const r of results) weeks.add(r.week);
      total += weeks.size;
   }
   await env.DB.prepare("UPDATE feed_state SET full_requested_at = ?1, full_total = ?2, updated_at = ?1 WHERE id = 1").bind(nowIso(), total).run();
   await markDirty(env, ["all"], "full rebuild");
}

export interface FeedStatus {
   lastBuildAt: string | null;
   lastError: string | null;
   failedAt: string | null;
   deadAt: string | null;
   attempts: number;
   pending: number;
   full: { total: number; left: number } | null;
}

export async function feedStatus(db: D1Database): Promise<FeedStatus> {
   const [s, pending, weeksLeft] = await Promise.all([
      db.prepare("SELECT * FROM feed_state WHERE id = 1").first<Record<string, unknown>>(),
      db.prepare("SELECT COUNT(*) AS n FROM feed_dirty").first<{ n: number }>(),
      db.prepare("SELECT COUNT(*) AS n FROM feed_dirty WHERE item LIKE 'w:%' OR item = 'all'").first<{ n: number }>(),
   ]);
   const str = (v: unknown) => (typeof v === "string" && v ? v : null);
   const total = Number(s?.full_total ?? 0);
   return {
      lastBuildAt: str(s?.last_build_at),
      lastError: str(s?.last_error),
      failedAt: str(s?.failed_at),
      deadAt: str(s?.dead_at),
      attempts: Number(s?.attempts ?? 0),
      pending: Number(pending?.n ?? 0),
      full: total > 0 ? { total, left: Math.min(total, Number(weeksLeft?.n ?? 0) > 0 ? Number(weeksLeft?.n) : 0) } : null,
   };
}

/* Cron jobs */

/** Every minute: posts whose publish_at passed since the last check go onto the timeline. */
export async function duePosts(env: Env, now = new Date()): Promise<number> {
   const s = await env.DB.prepare("SELECT due_checked_until FROM feed_state WHERE id = 1").first<{ due_checked_until: string | null }>();
   const from = s?.due_checked_until ?? new Date(now.getTime() - 10 * 60_000).toISOString();
   const to = now.toISOString();
   const { results } = await env.DB.prepare("SELECT id FROM posts WHERE status = 'published' AND publish_at > ?1 AND publish_at <= ?2").bind(from, to).all<{ id: number }>();
   await env.DB.prepare("UPDATE feed_state SET due_checked_until = ?1 WHERE id = 1").bind(to).run();
   if (results.length) await markDirty(env, results.map((r) => `p${r.id}`), "publish_at passed");
   return results.length;
}

/**
 * Every 30 minutes: compare what KV should hold (D1, light scan) with what was published, and
 * mark only the drifted weeks / heads dirty. A missing head (namespace emptied) → full rebuild.
 */
export async function verifyFeed(env: Env): Promise<{ weeks: number; heads: number; full: boolean }> {
   const out = { weeks: 0, heads: 0, full: false };
   const dirty: string[] = [];
   for (const l of FEED_LOCALES) {
      const head = env.FEED ? ((await env.FEED.get(headKey(l), "json")) as HeadDoc | null) : null;
      const storedHead = await env.DB.prepare("SELECT build, lite FROM feed_heads WHERE locale = ?1").bind(l).first<{ build: string; lite: string }>();
      if (!head) {
         out.full = true;
         continue;
      }
      const rows = await liteItems(env, l);
      const byWeek = new Map<string, typeof rows>();
      for (const r of rows) {
         if (r.pinned) continue;
         const w = isoWeek(r.date);
         if (!byWeek.has(w)) byWeek.set(w, []);
         byWeek.get(w)!.push(r);
      }
      const { results: weeks } = await env.DB.prepare("SELECT week, lite FROM feed_weeks WHERE locale = ?1").bind(l).all<{ week: string; lite: string }>();
      const have = new Map(weeks.map((w) => [w.week, w.lite]));
      for (const [w, list] of byWeek) if (have.get(w) !== checksum(liteSig(list))) dirty.push(`w:${l}:${w}`);
      for (const w of have.keys()) if (!byWeek.has(w)) dirty.push(`w:${l}:${w}`);
      const headLite = checksum(liteSig([...rows.filter((r) => r.pinned), ...rows.filter((r) => !r.pinned).slice(0, HEAD_SIZE + 1)]));
      if (!storedHead || storedHead.lite !== headLite || storedHead.build !== head.build) {
         dirty.push(`head:${l}`);
         out.heads++;
      }
   }
   out.weeks = dirty.filter((d) => d.startsWith("w:")).length;
   if (out.full) await requestFullRebuild(env);
   else if (dirty.length) await markDirty(env, dirty, "verifier repair");
   return out;
}

/** Deletes superseded keys whose time is up (tombstones after TOMBSTONE_MS, old year indexes after GC_DELAY_MS). */
export async function collectGarbage(env: Env, now = new Date(), limit = 200): Promise<number> {
   if (!env.FEED) return 0;
   const { results } = await env.DB.prepare("SELECT key FROM feed_garbage WHERE delete_after <= ?1 LIMIT ?2").bind(now.toISOString(), limit).all<{ key: string }>();
   for (const { key } of results) await env.FEED.delete(key);
   if (results.length) await batch(env, results.map(({ key }) => env.DB.prepare("DELETE FROM feed_garbage WHERE key = ?1").bind(key)));
   return results.length;
}

/* Triggers from other jobs */

/** A video snapshot changed: the timeline entries and posts that show it. */
export async function videoChanged(env: Env, kind: string, refId: string): Promise<void> {
   const [entries, posts] = await Promise.all([
      env.DB.prepare("SELECT id FROM timeline_entries WHERE kind = 'video' AND video_kind = ?1 AND ref_id = ?2").bind(kind, refId).all<{ id: number }>(),
      kind === "video"
         ? env.DB.prepare("SELECT id FROM posts WHERE body LIKE ?1").bind(`%::video[${refId}]%`).all<{ id: number }>()
         : Promise.resolve({ results: [] as { id: number }[] }),
   ]);
   await markDirty(env, [...entries.results.map((r) => `v${r.id}`), ...posts.results.map((r) => `p${r.id}`)], "video snapshot changed");
}

/** An image's variants are ready: the posts using it as cover or card image. */
export async function mediaReady(env: Env, path: string): Promise<void> {
   const m = await env.DB.prepare("SELECT id, reference, entity_id FROM media WHERE path = ?1").bind(path).first<{ id: number; reference: string | null; entity_id: string | number | null }>();
   if (!m) return;
   const ids = new Set<number>();
   if (m.reference === "posts.cover" && m.entity_id !== null) ids.add(Number(m.entity_id));
   const { results } = await env.DB.prepare("SELECT id FROM posts WHERE kind = 'cards' AND slides LIKE ?1").bind(`%"media_id":${Number(m.id)}%`).all<{ id: number }>();
   for (const r of results) ids.add(r.id);
   await markDirty(env, [...ids].map((id) => `p${id}`), "image variants ready");
}
