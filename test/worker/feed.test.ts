import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
   collectGarbage,
   consumeFeed,
   consumeFeedDlq,
   duePosts,
   feedStatus,
   markDirty,
   mediaReady,
   requestFullRebuild,
   retryFeed,
   runBuild,
   verifyFeed,
   videoChanged,
} from "../../src/lib/feed/jobs.ts";
import { compareItems, cursorOf, headKey, isoWeek, parseCursor, readPage, weekKey, type FeedItem, type HeadDoc, type WeekDoc } from "../../src/lib/feed/model.ts";
import { fakeQueue, insertPost, insertVideoEntry, noSleep, recordingKv, resetFeed, testEnv } from "./feed-helpers.ts";

const build = (e: ReturnType<typeof testEnv>, maxWeeks?: number) => runBuild(e, { sleep: noSleep, maxWeeks });
/** Build until nothing is dirty (a full rebuild runs in several runs). */
async function drain(e: ReturnType<typeof testEnv>, maxWeeks?: number) {
   for (let i = 0; i < 400; i++) {
      const r = await build(e, maxWeeks);
      if (!r.claimed) return;
   }
   throw new Error("feed did not drain");
}
const kvGet = (kv: KVNamespace) => (key: string) => kv.get(key, "json");

/** Every page via readPage (the walk www does), following `next`. */
async function walk(kv: KVNamespace, l: "en" | "ar", size = 20) {
   const seen: FeedItem[] = [];
   let page = await readPage(kvGet(kv), l, null, size);
   const pinned = page.pinned;
   seen.push(...page.items);
   for (let i = 0; page.next && i < 2000; i++) {
      page = await readPage(kvGet(kv), l, page.next, size);
      seen.push(...page.items);
   }
   return { pinned, items: seen };
}

const FEED = env.FEED as KVNamespace;
beforeEach(resetFeed);

describe("home timeline in KV", () => {
   it("builds head, year and week keys; paging walks every item once, newest first, pinned on top", async () => {
      const { queue } = fakeQueue();
      const e = testEnv({ FEED_JOBS: queue });
      const ids: number[] = [];
      for (let i = 0; i < 30; i++) ids.push(await insertPost({ date: new Date(Date.UTC(2026, 9, 1) + i * 2 * 86_400_000).toISOString() }));
      await insertPost({ date: "2026-10-20T10:00:00.000Z", show: 0 }); // turned off in the editor
      await insertPost({ date: "2026-10-21T10:00:00.000Z", locale: "ar" });
      await insertPost({ date: "2026-10-22T10:00:00.000Z", status: "draft" });
      await insertPost({ date: "2026-10-23T10:00:00.000Z", publishAt: "2099-01-01T00:00:00.000Z" }); // scheduled
      const v = await insertVideoEntry({ ref: "vid-a", date: "2026-10-10T12:00:00.000Z" });
      const pinnedVideo = await insertVideoEntry({ ref: "vid-b", date: "2026-01-01T00:00:00.000Z", pin: 1 });
      await env.DB.prepare("INSERT INTO timeline_entries (kind, post_id, hidden, pin_rank, created_at, updated_at) VALUES ('post', ?1, 0, 2, ?2, ?2)").bind(ids[3], new Date().toISOString()).run();
      await env.DB.prepare("INSERT INTO timeline_entries (kind, post_id, hidden, created_at, updated_at) VALUES ('post', ?1, 1, ?2, ?2)").bind(ids[4], new Date().toISOString()).run();
      await markDirty(e, ["all"], "test");
      await drain(e);

      const { pinned, items } = await walk(FEED, "en", 7);
      expect(pinned.map((x) => x.key)).toEqual([`v${pinnedVideo}`, `p${ids[3]}`]);
      const expected = [...ids.filter((id) => id !== ids[3] && id !== ids[4]).map((id) => `p${id}`), `v${v}`];
      expect(items.map((x) => x.key).sort()).toEqual(expected.sort());
      expect(new Set(items.map((x) => x.key)).size).toBe(items.length); // no duplicates
      expect([...items].sort(compareItems).map((x) => x.key)).toEqual(items.map((x) => x.key)); // in order
      const ar = await walk(FEED, "ar");
      expect(ar.items).toHaveLength(2); // the arabic post + the 'all' video
      expect(ar.pinned.map((x) => x.key)).toEqual([`v${pinnedVideo}`]);
      const video = items.find((x) => x.key === `v${v}`)!;
      expect(video.video).toMatchObject({ kind: "video", ref_id: "vid-a", snapshot: { title: "Video vid-a" } });
   });

   it("the first page is one KV read on the 1st of a month and mid-month", async () => {
      const e = testEnv();
      for (const d of ["2026-11-01T00:30:00.000Z", "2026-10-31T23:00:00.000Z", "2026-10-15T10:00:00.000Z", "2026-11-15T10:00:00.000Z"]) await insertPost({ date: d });
      await markDirty(e, ["all"], "test");
      await drain(e);
      const { kv, ops } = recordingKv();
      const page = await readPage(kvGet(kv), "en", null);
      expect(page.reads).toBe(1);
      expect(ops.filter((o) => o.op === "get")).toEqual([{ op: "get", key: headKey("en") }]);
      expect(page.items.map((i) => i.date)).toEqual(["2026-11-15T10:00:00.000Z", "2026-11-01T00:30:00.000Z", "2026-10-31T23:00:00.000Z", "2026-10-15T10:00:00.000Z"]);
   });

   it("a new post rewrites its week, its year index and the head (pointer last) — nothing else", async () => {
      const e0 = testEnv();
      for (let i = 0; i < 60; i++) await insertPost({ date: new Date(Date.UTC(2026, 0, 5) + i * 5 * 86_400_000).toISOString() });
      await markDirty(e0, ["all"], "seed");
      await drain(e0);
      const { kv, ops } = recordingKv();
      const e = testEnv({ FEED: kv });
      // The newest week so far is 2026-W44 (the last seeded post is on Oct 27).
      const id = await insertPost({ date: "2026-10-28T09:00:00.000Z" });
      await markDirty(e, [`p${id}`], "new post");
      await build(e);
      const puts = ops.filter((o) => o.op === "put").map((o) => o.key);
      // New week version, its year index, the head (the pointer flip), then the old week version
      // becomes a tombstone (only after the flip).
      expect(puts).toHaveLength(4);
      expect(puts[0]).toMatch(/^feed:en:w:2026-W44:/);
      expect(puts[1]).toMatch(/^feed:en:y:2026:/);
      expect(puts[2]).toBe(headKey("en"));
      expect(puts[3]).toMatch(/^feed:en:w:2026-W44:/);
      expect(puts[3]).not.toBe(puts[0]);
      expect(await FEED.get(puts[3], "json")).toMatchObject({ week: "2026-W44", moved: puts[0].split(":").at(-1) });
      const head = (await FEED.get(headKey("en"), "json")) as HeadDoc;
      expect(head.items[0].key).toBe(`p${id}`);
   });

   it("an insert into an old week touches that week + the year index + the head", async () => {
      const e0 = testEnv();
      for (let i = 0; i < 80; i++) await insertPost({ date: new Date(Date.UTC(2025, 5, 2) + i * 3 * 86_400_000).toISOString() });
      await markDirty(e0, ["all"], "seed");
      await drain(e0);
      const { kv, ops } = recordingKv();
      const e = testEnv({ FEED: kv });
      const id = await insertPost({ date: "2025-07-02T09:00:00.000Z" });
      await markDirty(e, [`p${id}`], "backdated");
      await build(e);
      const puts = ops.filter((o) => o.op === "put").map((o) => o.key);
      const week = `feed:en:w:${isoWeek("2025-07-02T09:00:00.000Z")}`;
      expect(puts.map((k) => k.replace(/^(feed:\w\w:[wy]:[^:]+):[a-z0-9]+$/, "$1"))).toEqual([week, "feed:en:y:2025", headKey("en"), week]);
      const all = await walk(FEED, "en");
      expect(all.items.filter((x) => x.key === `p${id}`)).toHaveLength(1);
   });

   it("a date change moves an item between weeks (both rewritten), and between years", async () => {
      const e = testEnv();
      const a = await insertPost({ date: "2026-03-04T10:00:00.000Z" });
      await insertPost({ date: "2026-03-05T10:00:00.000Z" });
      await insertPost({ date: "2025-12-01T10:00:00.000Z" });
      await markDirty(e, ["all"], "seed");
      await drain(e);
      const { kv, ops } = recordingKv();
      const e2 = testEnv({ FEED: kv });
      await env.DB.prepare("UPDATE posts SET published_at = '2025-12-02T10:00:00.000Z', updated_at = ?2 WHERE id = ?1").bind(a, new Date().toISOString()).run();
      await markDirty(e2, [`p${a}`], "date moved");
      await build(e2);
      const puts = ops.filter((o) => o.op === "put").map((o) => o.key.replace(/^(feed:\w\w:[wy]:[^:]+):[a-z0-9]+$/, "$1"));
      expect(puts).toContain(`feed:en:w:${isoWeek("2026-03-04T10:00:00.000Z")}`);
      expect(puts).toContain(`feed:en:w:${isoWeek("2025-12-02T10:00:00.000Z")}`);
      expect(puts).toContain("feed:en:y:2025");
      expect(puts).toContain("feed:en:y:2026");
      // Everything before the head flip is a new version; only tombstones come after it.
      const flip = puts.indexOf(headKey("en"));
      expect(puts.slice(flip + 1).every((k) => k.startsWith("feed:en:w:"))).toBe(true);
      const all = await walk(FEED, "en", 1);
      expect(all.items.map((x) => x.key).filter((k) => k === `p${a}`)).toHaveLength(1);
      expect(all.items).toHaveLength(3);
   });

   it("pages across ISO week and year boundaries, incl. 2026-W53, with no duplicates or gaps", async () => {
      const e = testEnv();
      // 2026-12-28 … 2027-01-03 is ISO week 2026-W53; 2027-01-04 starts 2027-W01.
      const dates = ["2026-12-27T23:59:59.999Z", "2026-12-28T00:00:00.000Z", "2026-12-31T23:59:59.000Z", "2027-01-01T00:00:00.000Z", "2027-01-03T23:59:59.999Z", "2027-01-04T00:00:00.000Z"];
      const ids: number[] = [];
      for (const d of dates) ids.push(await insertPost({ date: d }));
      // Same instant as another post: ties are ordered by type then id.
      ids.push(await insertPost({ date: "2027-01-01T00:00:00.000Z" }));
      const vid = await insertVideoEntry({ ref: "vid-tie", date: "2027-01-01T00:00:00.000Z" });
      // Enough newer items that the head (40) doesn't reach back to the boundary.
      for (let i = 0; i < 45; i++) await insertPost({ date: new Date(Date.UTC(2027, 1, 1) + i * 3_600_000).toISOString() });
      await markDirty(e, ["all"], "seed");
      await drain(e);
      expect(isoWeek("2026-12-31T23:59:59.000Z")).toBe("2026-W53");
      expect(isoWeek("2027-01-03T23:59:59.999Z")).toBe("2026-W53");
      expect(isoWeek("2027-01-04T00:00:00.000Z")).toBe("2027-W01");
      expect(isoWeek("2026-12-27T23:59:59.999Z")).toBe("2026-W52");
      for (const size of [1, 2, 3, 7, 20]) {
         const { items } = await walk(FEED, "en", size);
         expect(items).toHaveLength(dates.length + 2 + 45);
         expect(new Set(items.map((x) => x.key)).size).toBe(items.length);
         expect([...items].sort(compareItems).map((x) => x.key)).toEqual(items.map((x) => x.key));
      }
      const { items } = await walk(FEED, "en", 5);
      const tie = items.filter((x) => x.date === "2027-01-01T00:00:00.000Z").map((x) => x.key);
      expect(tie).toEqual([`v${vid}`, `p${ids[6]}`, `p${ids[3]}`]);
   });

   it("an item added between two page loads never shifts or repeats the next page (cursor, not offset)", async () => {
      const e = testEnv();
      for (let i = 0; i < 50; i++) await insertPost({ date: new Date(Date.UTC(2026, 6, 1) + i * 86_400_000).toISOString() });
      await markDirty(e, ["all"], "seed");
      await drain(e);
      const first = await readPage(kvGet(FEED), "en", null, 10);
      const id = await insertPost({ date: "2026-11-01T00:00:00.000Z" });
      await markDirty(e, [`p${id}`], "new");
      await drain(e);
      const second = await readPage(kvGet(FEED), "en", first.next, 10);
      expect(second.items[0].key).not.toBe(first.items[9].key);
      expect(cursorOf(second.items[0]) < cursorOf(first.items[9]) || Date.parse(second.items[0].date) < Date.parse(first.items[9].date)).toBe(true);
      expect(new Set([...first.items, ...second.items].map((x) => x.key)).size).toBe(20);
   });

   it("a burst of changes is one message and one build; the head is written once", async () => {
      const { queue, sent } = fakeQueue();
      const { kv, ops } = recordingKv();
      const e = testEnv({ FEED_JOBS: queue, FEED: kv });
      for (let i = 0; i < 25; i++) {
         const id = await insertPost({ date: new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString() });
         await markDirty(e, [`p${id}`], "burst");
      }
      expect(sent).toHaveLength(1);
      const batch = fakeBatch(sent.length);
      await consumeFeed(batch.batch as never, e);
      expect(batch.acked).toBe(true);
      expect(ops.filter((o) => o.op === "put" && o.key === headKey("en"))).toHaveLength(1);
      expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM feed_dirty").first<{ n: number }>())!.n).toBe(0);
      // Idempotent: the same work again writes nothing.
      ops.length = 0;
      await markDirty(e, ["p999999"], "no-op");
      await build(e);
      expect(ops.filter((o) => o.op === "put")).toHaveLength(0);
   });

   it("a head is never rewritten within a second (KV: 1 write/s per key); the two locales don't wait on each other", async () => {
      const slept: number[] = [];
      const sleep = async (ms: number) => {
         slept.push(ms);
      };
      const en = await insertPost({ date: "2026-11-02T10:00:00.000Z" });
      const ar = await insertPost({ date: "2026-11-02T10:00:00.000Z", locale: "ar" });
      await markDirty(testEnv(), [`p${en}`, `p${ar}`], "both");
      await runBuild(testEnv(), { sleep });
      expect(slept).toEqual([]);
      await env.DB.prepare("UPDATE posts SET title = 'Again', updated_at = ?2 WHERE id = ?1").bind(en, new Date().toISOString()).run();
      await markDirty(testEnv(), [`p${en}`], "again");
      await runBuild(testEnv(), { sleep });
      expect(slept).toHaveLength(1);
      expect(slept[0]).toBeGreaterThan(0);
      expect(slept[0]).toBeLessThanOrEqual(1_100);
   });

   it("with 10,000 items, a change still writes a constant number of keys", async () => {
      const e0 = testEnv();
      await env.DB.prepare(
         `WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 9999)
          INSERT INTO posts (slug, locale, title, status, published_at, created_at, updated_at, kind, tags, body)
          SELECT 'bulk-' || i, 'en', 'Bulk ' || i, 'published', strftime('%Y-%m-%dT%H:%M:%fZ', '2020-01-01', '+' || (i * 4) || ' hours'),
                 strftime('%Y-%m-%dT%H:%M:%fZ', '2020-01-01', '+' || (i * 4) || ' hours'), '2020-01-01T00:00:00.000Z', 'article', '[]', '' FROM n`,
      ).run();
      await requestFullRebuild(e0);
      await drain(e0);
      const head = (await FEED.get(headKey("en"), "json")) as HeadDoc;
      expect(head.total).toBe(10_000);
      expect(head.years.map((y) => y.year)).toEqual([2024, 2023, 2022, 2021, 2020]);
      for (const date of ["2024-07-25T10:00:00.000Z", "2021-02-03T10:00:00.000Z"]) {
         const { kv, ops } = recordingKv();
         const e = testEnv({ FEED: kv });
         const id = await insertPost({ date });
         await markDirty(e, [`p${id}`], "one");
         await build(e);
         expect(ops.filter((o) => o.op === "put")).toHaveLength(4); // week, year index, head, tombstone
      }
      // A position-only cursor deep in the archive (the fallback) reads the head, one year index and
      // one or two weeks; its next cursor then reads one week per page.
      const deep = await readPage(kvGet(FEED), "en", `${Date.parse("2022-06-01T00:00:00.000Z")}-p1`, 20);
      expect(deep.items).toHaveLength(20);
      expect(deep.reads).toBeLessThanOrEqual(4);
      const after = await readPage(kvGet(FEED), "en", deep.next, 20);
      expect(after.via).toBe("pointer");
      expect(after.reads).toBeLessThanOrEqual(2);
   }, 120_000);

   it("a failing build retries with backoff; the DLQ flags it; Retry clears and requeues; KV keeps the last good copy", async () => {
      const { queue, sent } = fakeQueue();
      const id = await insertPost({ date: "2026-11-02T10:00:00.000Z" });
      await markDirty(testEnv(), [`p${id}`], "seed");
      await build(testEnv());
      const good = await FEED.get(headKey("en"));
      const { kv, failPuts } = recordingKv();
      failPuts.on = true;
      const e = testEnv({ FEED_JOBS: queue, FEED: kv });
      const id2 = await insertPost({ date: "2026-11-03T10:00:00.000Z" });
      await markDirty(e, [`p${id2}`], "will fail");
      const b = fakeBatch(1, 3);
      await consumeFeed(b.batch as never, e);
      expect(b.retried).toEqual({ delaySeconds: 120 });
      let st = await feedStatus(env.DB);
      expect(st.lastError).toMatch(/KV put failed/);
      expect(st.pending).toBeGreaterThan(0);
      await consumeFeedDlq(fakeBatch(1).batch as never, e);
      st = await feedStatus(env.DB);
      expect(st.deadAt).not.toBeNull();
      expect(await FEED.get(headKey("en"))).toBe(good); // last good copy still served
      failPuts.on = false;
      sent.length = 0;
      expect(await retryFeed(e)).toBe(true);
      expect(sent).toHaveLength(1);
      await consumeFeed(fakeBatch(1).batch as never, e);
      st = await feedStatus(env.DB);
      expect(st.deadAt).toBeNull();
      expect(st.lastError).toBeNull();
      expect(((await FEED.get(headKey("en"), "json")) as HeadDoc).items[0].key).toBe(`p${id2}`);
   });

   it("the publish_at watcher puts a scheduled post on the timeline once it is live", async () => {
      const { queue, sent } = fakeQueue();
      const e = testEnv({ FEED_JOBS: queue });
      const past = new Date(Date.now() - 30_000).toISOString();
      const id = await insertPost({ date: past, publishAt: past });
      await insertPost({ date: "2099-01-01T00:00:00.000Z", publishAt: "2099-01-01T00:00:00.000Z" });
      await env.DB.prepare("UPDATE feed_state SET due_checked_until = ?1 WHERE id = 1").bind(new Date(Date.now() - 60_000).toISOString()).run();
      expect(await duePosts(e)).toBe(1);
      expect(sent).toHaveLength(1);
      const dirty = await env.DB.prepare("SELECT item FROM feed_dirty").all<{ item: string }>();
      expect(dirty.results.map((r) => r.item)).toEqual([`p${id}`]);
      expect(await duePosts(e)).toBe(0); // watermark moved on
   });

   it("triggers: a video snapshot change and cover variants becoming ready mark the right items", async () => {
      const e = testEnv();
      const entry = await insertVideoEntry({ ref: "vid-x", date: "2026-11-01T00:00:00.000Z" });
      const withVideo = await insertPost({ date: "2026-11-01T00:00:00.000Z", body: "Intro\n\n::video[vid-x]\n" });
      await insertPost({ date: "2026-11-01T00:00:00.000Z", body: "nothing" });
      await videoChanged(e, "video", "vid-x");
      let dirty = (await env.DB.prepare("SELECT item FROM feed_dirty ORDER BY item").all<{ item: string }>()).results.map((r) => r.item);
      expect(dirty.sort()).toEqual([`p${withVideo}`, `v${entry}`].sort());
      await env.DB.prepare("DELETE FROM feed_dirty").run();
      const post = await insertPost({ date: "2026-11-01T00:00:00.000Z" });
      await env.DB.prepare("INSERT INTO media (path, reference, entity_id, mime_type, size, folder, etag, modified_at) VALUES ('cover.jpg', 'posts.cover', ?1, 'image/jpeg', 1, 0, 'e', '2026-01-01')")
         .bind(String(post))
         .run();
      await mediaReady(e, "cover.jpg");
      dirty = (await env.DB.prepare("SELECT item FROM feed_dirty").all<{ item: string }>()).results.map((r) => r.item);
      expect(dirty).toEqual([`p${post}`]);
   });

   it("post bodies' ::video lines travel with the item (in order, with their snapshots)", async () => {
      const e = testEnv();
      await insertVideoEntry({ ref: "vid-1", date: "2020-01-01T00:00:00.000Z", hidden: 1 });
      const id = await insertPost({ date: "2026-11-01T00:00:00.000Z", body: "a\n\n::video[vid-1]\n\ntext ::video[nope] inline\n\n::video[vid-2]\n" });
      await markDirty(e, [`p${id}`], "t");
      await build(e);
      const head = (await FEED.get(headKey("en"), "json")) as HeadDoc;
      const videos = (head.items[0].post as { videos: { ref_id: string; snapshot: unknown }[] }).videos;
      expect(videos.map((v) => v.ref_id)).toEqual(["vid-1", "vid-2"]);
      expect(videos[0].snapshot).toMatchObject({ title: "Video vid-1" });
      expect(videos[1].snapshot).toBeNull();
   });

   it("the verifier repairs only the week that drifted; a missing head triggers a full rebuild", async () => {
      const { queue } = fakeQueue();
      const e = testEnv({ FEED_JOBS: queue });
      // More than the head holds, so the oldest week is only in its bucket.
      for (let i = 0; i < 60; i++) await insertPost({ date: new Date(Date.UTC(2026, 3, 1) + i * 2 * 86_400_000).toISOString() });
      await markDirty(e, ["all"], "seed");
      await drain(e);
      expect(await verifyFeed(e)).toEqual({ weeks: 0, heads: 0, full: false });
      // A change that never reached the builder (e.g. a lost event): only that week drifts.
      const target = await env.DB.prepare("SELECT id, published_at FROM posts ORDER BY published_at LIMIT 1").first<{ id: number; published_at: string }>();
      await env.DB.prepare("UPDATE posts SET title = 'Changed', updated_at = ?2 WHERE id = ?1").bind(target!.id, new Date().toISOString()).run();
      const r = await verifyFeed(e);
      expect(r.weeks).toBe(1);
      const dirty = (await env.DB.prepare("SELECT item FROM feed_dirty").all<{ item: string }>()).results.map((x) => x.item);
      expect(dirty).toEqual([`w:en:${isoWeek(target!.published_at)}`]);
      await drain(e);
      expect(await verifyFeed(e)).toEqual({ weeks: 0, heads: 0, full: false });
      await FEED.delete(headKey("en"));
      expect((await verifyFeed(e)).full).toBe(true);
      await drain(e);
      expect(await FEED.get(headKey("en"))).not.toBeNull();
   });

   it("superseded keys are deleted only after the grace period", async () => {
      const e = testEnv();
      const id = await insertPost({ date: "2026-11-02T10:00:00.000Z" });
      await markDirty(e, [`p${id}`], "a");
      await build(e);
      const firstWeek = (await env.DB.prepare("SELECT key FROM feed_weeks").first<{ key: string }>())!.key;
      await env.DB.prepare("UPDATE posts SET title = 'B', updated_at = ?2 WHERE id = ?1").bind(id, new Date().toISOString()).run();
      await markDirty(e, [`p${id}`], "b");
      await build(e);
      expect(await collectGarbage(e)).toBe(0);
      expect(await FEED.get(firstWeek, "json")).toMatchObject({ moved: expect.any(String) }); // a tombstone now
      await collectGarbage(e, new Date(Date.now() + 16 * 60_000)); // old year indexes go after 15 min
      expect(await FEED.get(firstWeek)).not.toBeNull(); // week tombstones are kept far past the HTML cache life
      expect(await collectGarbage(e, new Date(Date.now() + 8 * 86_400_000))).toBeGreaterThan(0);
      expect(await FEED.get(firstWeek)).toBeNull();
   });
});

describe("load more through week pointers", () => {
   /** One post per day for `days` days from `start`. */
   async function seed(start: number, days: number) {
      const ids: number[] = [];
      for (let i = 0; i < days; i++) ids.push(await insertPost({ date: new Date(start + i * 86_400_000).toISOString() }));
      await markDirty(testEnv(), ["all"], "seed");
      await drain(testEnv());
      return ids;
   }

   it("is one KV read per page in the normal case, across weeks and the year boundary", async () => {
      await seed(Date.UTC(2026, 9, 1), 140); // Oct 2026 → Feb 2027, ~7 per week
      let page = await readPage(kvGet(FEED), "en", null, 7);
      expect(page.reads).toBe(1);
      const seen = [...page.items];
      let pages = 0;
      while (page.next) {
         page = await readPage(kvGet(FEED), "en", page.next, 7);
         expect(page.via).toBe("pointer");
         // A page of 7 that starts mid-week spans two weeks; one that starts on a week does not.
         expect(page.reads).toBeLessThanOrEqual(2);
         seen.push(...page.items);
         pages++;
      }
      expect(seen).toHaveLength(140);
      expect(new Set(seen.map((x) => x.key)).size).toBe(140);
      // Pages aligned to weeks are one read each.
      const head = (await FEED.get(headKey("en"), "json")) as HeadDoc;
      const w = (await FEED.get(weekKey("en", head.weeks[1].week, head.weeks[1].build), "json")) as WeekDoc;
      const cur = cursorOf(w.items[0]);
      const aligned = await readPage(kvGet(FEED), "en", `${cur}.${w.week}.${w.build}`, w.items.length - 1);
      expect(aligned.reads).toBe(1);
      expect(pages).toBeGreaterThan(15);
   });

   it("a superseded week is reached through its tombstone; once deleted, through the year index", async () => {
      await seed(Date.UTC(2026, 0, 5), 70);
      const p1 = await readPage(kvGet(FEED), "en", null, 20);
      const p2 = await readPage(kvGet(FEED), "en", p1.next, 20);
      const cached = p2.next!; // a cursor in a cached HTML page
      const ptr = parseCursor(cached)!.next!;
      // Edit an item in that week: new version, old one becomes a tombstone.
      const victim = (await FEED.get(weekKey("en", ptr.week, ptr.build), "json")) as WeekDoc;
      const id = Number(victim.items[victim.items.length - 1].key.slice(1));
      await env.DB.prepare("UPDATE posts SET title = 'Edited', updated_at = ?2 WHERE id = ?1").bind(id, new Date().toISOString()).run();
      await markDirty(testEnv(), [`p${id}`], "edit");
      await build(testEnv());
      const viaTomb = await readPage(kvGet(FEED), "en", cached, 20);
      expect(viaTomb.via).toBe("pointer");
      expect(viaTomb.items.find((x) => x.key === `p${id}`)?.post?.title).toBe("Edited"); // never the old copy
      // After the tombstone is deleted the same cursor still works, via the index.
      await collectGarbage(testEnv(), new Date(Date.now() + 8 * 86_400_000));
      const viaIndex = await readPage(kvGet(FEED), "en", cached, 20);
      expect(viaIndex.via).toBe("index");
      expect(viaIndex.items.map((x) => x.key)).toEqual(viaTomb.items.map((x) => x.key));
   });

   it("when a week empties or a new older week appears, the newer neighbour's pointer is rewritten", async () => {
      const a = await insertPost({ date: "2026-05-04T10:00:00.000Z" }); // 2026-W19
      const b = await insertPost({ date: "2026-05-13T10:00:00.000Z" }); // 2026-W20
      const c = await insertPost({ date: "2026-05-20T10:00:00.000Z" }); // 2026-W21
      for (let i = 0; i < 45; i++) await insertPost({ date: new Date(Date.UTC(2026, 6, 1) + i * 3_600_000).toISOString() });
      await markDirty(testEnv(), ["all"], "seed");
      await drain(testEnv());
      const olderOf = async (week: string) => {
         const row = await env.DB.prepare("SELECT key FROM feed_weeks WHERE locale = 'en' AND week = ?1").bind(week).first<{ key: string }>();
         return ((await FEED.get(row!.key, "json")) as WeekDoc).older?.week ?? null;
      };
      expect(await olderOf("2026-W21")).toBe("2026-W20");
      // W20 empties: W21 must now point at W19.
      await env.DB.prepare("UPDATE posts SET status = 'draft', updated_at = ?2 WHERE id = ?1").bind(b, new Date().toISOString()).run();
      await markDirty(testEnv(), [`p${b}`], "unpublish");
      const { kv, ops } = recordingKv();
      await build(testEnv({ FEED: kv }));
      expect(await olderOf("2026-W21")).toBe("2026-W19");
      const puts = ops.filter((o) => o.op === "put").map((o) => o.key);
      expect(puts.filter((k) => k.startsWith("feed:en:w:2026-W21:"))).toHaveLength(2); // new version + tombstone
      expect(((await FEED.get(puts.find((k) => k.startsWith("feed:en:w:2026-W20:"))!, "json")) as { gone?: boolean }).gone).toBe(true);
      // A new week between W21 and W19 appears: W21 points to it, and it points to W19.
      const d = await insertPost({ date: "2026-05-12T10:00:00.000Z" }); // 2026-W20 again
      await markDirty(testEnv(), [`p${d}`], "new");
      await build(testEnv());
      expect(await olderOf("2026-W21")).toBe("2026-W20");
      expect(await olderOf("2026-W20")).toBe("2026-W19");
      expect(await olderOf("2026-W19")).toBeNull();
      const { items } = await walk(FEED, "en", 2);
      expect(items.map((x) => x.key).slice(-3)).toEqual([`p${c}`, `p${d}`, `p${a}`]);
   });
});

function fakeBatch(n: number, attempts = 1) {
   const state = { acked: false, retried: undefined as unknown, batch: undefined as unknown };
   state.batch = {
      queue: "al-ummah-now-cms-feed-qa",
      messages: Array.from({ length: n }, (_, i) => ({ id: String(i), attempts, body: { kind: "build", reason: "t" }, ack() {}, retry() {} })),
      ackAll() {
         state.acked = true;
      },
      retryAll(o: unknown) {
         state.retried = o;
      },
   };
   return state as { acked: boolean; retried: unknown; batch: unknown };
}
