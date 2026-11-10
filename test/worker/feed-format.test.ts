/**
 * The feed format stamp and the automatic rebuild (docs/FEED.md "Format version";
 * src/lib/feed/format.ts, src/lib/feed/auto-rebuild.ts, src/routes/release-api.ts).
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { FEED_FORMAT } from "../../src/lib/feed/format.ts";
import { checkFeedFormat, ensureFeedFormat, feedFormatState, FORMAT_LOCK_KEY, resetFormatCheck } from "../../src/lib/feed/auto-rebuild.ts";
import { fullMarker, markDirty, runBuild } from "../../src/lib/feed/jobs.ts";
import { headKey, type HeadDoc } from "../../src/lib/feed/model.ts";
import { fakeQueue, insertPost, noSleep, resetFeed, testEnv } from "./feed-helpers.ts";
import { makeWorker } from "./helpers.ts";

const FEED = env.FEED as KVNamespace;
const build = (e: ReturnType<typeof testEnv>, maxWeeks?: number) => runBuild(e, { sleep: noSleep, maxWeeks });
async function drain(e: ReturnType<typeof testEnv>, maxWeeks?: number) {
   for (let i = 0; i < 200; i++) if (!(await build(e, maxWeeks)).claimed) return;
   throw new Error("feed did not drain");
}
const head = async (l: "en" | "ar") => (await FEED.get(headKey(l), "json")) as HeadDoc | null;
const dirty = async () =>
   (
      await env.DB.prepare("SELECT item FROM feed_dirty ORDER BY id").all<{
         item: string;
      }>()
   ).results.map((r) => r.item);
const built = async () =>
   (
      await env.DB.prepare("SELECT format FROM feed_state WHERE id = 1").first<{
         format: number | null;
      }>()
   )?.format ?? 0;
const rebuildLog = async () =>
   (await env.DB.prepare("SELECT action, entry_kind, entry_ref, actor_email, detail FROM timeline_changes WHERE action = 'rebuild' ORDER BY id").all<Record<string, unknown>>()).results;

/** A feed published by code from before formats existed: heads without `format`, D1 format NULL. */
async function legacyFeed(e: ReturnType<typeof testEnv>) {
   await markDirty(e, ["all"], "test");
   await drain(e);
   for (const l of ["en", "ar"] as const) {
      const h = (await head(l))!;
      delete h.format;
      await FEED.put(headKey(l), JSON.stringify(h));
   }
   await env.DB.prepare("UPDATE feed_state SET format = NULL WHERE id = 1").run();
   await env.DB.prepare("DELETE FROM timeline_changes").run();
}

beforeEach(async () => {
   await resetFeed();
   resetFormatCheck();
});

describe("format stamp", () => {
   it("a full rebuild stamps every head and D1 with FEED_FORMAT; incremental builds keep the stamp", async () => {
      const e = testEnv();
      await insertPost({ date: "2026-10-01T10:00:00.000Z" });
      await markDirty(e, ["all"], "test");
      const r = await build(e);
      expect(r.completedFull).toBe(true);
      expect((await head("en"))!.format).toBe(FEED_FORMAT);
      expect((await head("ar"))!.format).toBe(FEED_FORMAT); // empty locale: head written and stamped too
      expect(await built()).toBe(FEED_FORMAT);

      const id = await insertPost({ date: "2026-10-02T10:00:00.000Z" });
      await markDirty(e, [`p${id}`], "test");
      const r2 = await build(e);
      expect(r2.completedFull).toBe(false);
      expect((await head("en"))!.format).toBe(FEED_FORMAT);
      expect((await head("en"))!.v).toBe(1); // the layout version www checks is untouched
   });

   it("an incremental build never stamps an older feed as current", async () => {
      const e = testEnv();
      await insertPost({ date: "2026-10-01T10:00:00.000Z" });
      await legacyFeed(e);
      const id = await insertPost({ date: "2026-10-03T10:00:00.000Z" });
      await markDirty(e, [`p${id}`], "edit");
      await drain(e);
      expect((await head("en"))!.format).toBe(0);
      expect(await built()).toBe(0);
   });

   it("a full rebuild over several runs stamps only when the last week is written", async () => {
      const e = testEnv();
      for (let i = 0; i < 6; i++)
         await insertPost({
            date: new Date(Date.UTC(2026, 6, 1) + i * 8 * 86_400_000).toISOString(),
         });
      await legacyFeed(e);
      await markDirty(e, ["all"], "test");
      const first = await build(e, 2);
      expect(first.completedFull).toBe(false);
      expect(await dirty()).toContain(fullMarker(FEED_FORMAT)); // the marker travels with the carried weeks
      expect((await head("en"))!.format).toBe(0);
      expect(await built()).toBe(0);
      // An editor's change in between does not finish it either.
      const id = await insertPost({ date: "2026-12-01T10:00:00.000Z" });
      await markDirty(e, [`p${id}`], "edit");
      await drain(e, 2);
      expect((await head("en"))!.format).toBe(FEED_FORMAT);
      expect((await head("ar"))!.format).toBe(FEED_FORMAT);
      expect(await built()).toBe(FEED_FORMAT);
      expect(await dirty()).toEqual([]);
   });

   it("a full rebuild that other code started (deploy half-way) finishes as format 0, so it runs again", async () => {
      const e = testEnv();
      await insertPost({ date: "2026-10-01T10:00:00.000Z" });
      await legacyFeed(e);
      await env.DB.prepare("INSERT INTO feed_dirty (item, created_at) VALUES (?1, ?2), ('w:en:2026-W40', ?2)")
         .bind(fullMarker(FEED_FORMAT + 1), new Date().toISOString())
         .run();
      await drain(e);
      expect(await built()).toBe(0);
      expect((await head("en"))!.format).toBe(0);
      expect((await ensureFeedFormat(e, "cron")).action).toBe("started");
   });
});

describe("ensureFeedFormat (version check, lock, claim)", () => {
   it("current feed: nothing happens", async () => {
      const e = testEnv();
      await markDirty(e, ["all"], "test");
      await drain(e);
      expect(await ensureFeedFormat(e, "cron")).toMatchObject({
         action: "current",
         heads: { en: FEED_FORMAT, ar: FEED_FORMAT },
      });
      expect(await dirty()).toEqual([]);
      expect(await rebuildLog()).toEqual([]);
   });

   it("an older format: one rebuild, queued, locked, logged as system/release; then current", async () => {
      const { queue, sent } = fakeQueue();
      const e = testEnv({ FEED_JOBS: queue });
      await insertPost({ date: "2026-10-01T10:00:00.000Z" });
      await legacyFeed(e);
      await env.DB.prepare("UPDATE feed_state SET queued_at = NULL").run();
      sent.length = 0;

      expect(await ensureFeedFormat(e, "read")).toMatchObject({
         action: "started",
         heads: { en: 0, ar: 0 },
      });
      expect(await dirty()).toEqual(["all"]);
      expect(sent).toHaveLength(1);
      expect(await FEED.get(FORMAT_LOCK_KEY)).toBeTruthy();
      const log = await rebuildLog();
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({
         action: "rebuild",
         entry_kind: "feed",
         entry_ref: "all",
         actor_email: "system/release",
      });
      expect(JSON.parse(String(log[0].detail))).toMatchObject({
         reason: "format",
         trigger: "read",
         from: 0,
         to: FEED_FORMAT,
      });

      // Everyone else meanwhile: in progress (the D1 claim sees the pending "all"), no second rebuild.
      expect((await ensureFeedFormat(e, "cron")).action).toBe("in_progress");
      expect((await ensureFeedFormat(e, "release", { lock: false })).action).toBe("in_progress");
      expect(await dirty()).toEqual(["all"]);
      expect(await rebuildLog()).toHaveLength(1);

      await drain(e);
      expect((await ensureFeedFormat(e, "cron")).action).toBe("current");
      expect(await feedFormatState(e)).toEqual({
         code: FEED_FORMAT,
         heads: { en: FEED_FORMAT, ar: FEED_FORMAT },
         built: FEED_FORMAT,
         rebuilding: false,
         current: true,
      });
   });

   it("the KV lock stops lazy callers; the release pipeline goes past it to the D1 claim", async () => {
      const e = testEnv();
      await legacyFeed(e);
      await FEED.put(FORMAT_LOCK_KEY, "{}", { expirationTtl: 600 });
      expect((await ensureFeedFormat(e, "read")).action).toBe("locked");
      expect(await dirty()).toEqual([]);
      expect((await ensureFeedFormat(e, "release", { lock: false })).action).toBe("started");
      expect(await dirty()).toEqual(["all"]);
   });

   it("KV still serving an old head after the rebuild finished (edge cache): D1 says current", async () => {
      const e = testEnv();
      await legacyFeed(e);
      await env.DB.prepare("UPDATE feed_state SET format = ?1 WHERE id = 1").bind(FEED_FORMAT).run();
      expect((await ensureFeedFormat(e, "read")).action).toBe("current");
      expect(await dirty()).toEqual([]);
   });

   it("is idempotent under concurrent callers: exactly one claim", async () => {
      const e = testEnv();
      await legacyFeed(e);
      const rs = await Promise.all([1, 2, 3, 4].map(() => ensureFeedFormat(e, "release", { lock: false })));
      expect(rs.filter((r) => r.action === "started")).toHaveLength(1);
      expect(await dirty()).toEqual(["all"]);
      expect(await rebuildLog()).toHaveLength(1);
   });
});

describe("lazy path", () => {
   it("the public /timeline answers from D1 at once and starts the rebuild in the background", async () => {
      const e = testEnv();
      await insertPost({ date: "2026-10-01T10:00:00.000Z", title: "Old one" });
      await legacyFeed(e);
      const f = makeWorker();
      const res = await f("/api/public/v1/timeline?locale=en");
      expect(res.status).toBe(200);
      expect(((await res.json()) as { items: unknown[] }).items).toHaveLength(1);
      expect(await dirty()).toEqual(["all"]);
      expect((await rebuildLog())[0]).toMatchObject({
         actor_email: "system/release",
      });
      // The next reads in this isolate don't check again within the minute.
      await f("/api/public/v1/timeline?locale=en");
      expect(await rebuildLog()).toHaveLength(1);
   });

   it("checkFeedFormat: once current, an isolate stops checking; at most once a minute otherwise", async () => {
      const e = testEnv();
      await legacyFeed(e);
      await FEED.put(FORMAT_LOCK_KEY, "{}", { expirationTtl: 600 });
      expect((await checkFeedFormat(e, "cron", 1_000_000))!.action).toBe("locked");
      expect(await checkFeedFormat(e, "cron", 1_030_000)).toBeNull();
      await FEED.delete(FORMAT_LOCK_KEY);
      await env.DB.prepare("UPDATE feed_state SET format = ?1 WHERE id = 1").bind(FEED_FORMAT).run();
      expect((await checkFeedFormat(e, "cron", 1_070_000))!.action).toBe("current");
      expect(await checkFeedFormat(e, "cron", 9_000_000)).toBeNull();
   });
});

describe("release API (/api/release/v1/feed-format)", () => {
   const hex = async (s: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join("");
   async function token(expiresInMs = 600_000, purpose = "feed-format") {
      const t = `tok-${crypto.randomUUID()}-${crypto.randomUUID()}`;
      await env.DB.prepare("INSERT INTO system_tokens (token_hash, purpose, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)")
         .bind(await hex(t), purpose, new Date(Date.now() + expiresInMs).toISOString(), new Date().toISOString())
         .run();
      return t;
   }

   it("refuses a missing, wrong, expired or other-purpose token", async () => {
      const f = makeWorker();
      expect((await f("/api/release/v1/feed-format", { method: "POST" })).status).toBe(401);
      expect(
         (
            await f("/api/release/v1/feed-format", {
               method: "POST",
               headers: { Authorization: `Bearer ${"x".repeat(40)}` },
            })
         ).status,
      ).toBe(401);
      const expired = await token(-1000);
      expect(
         (
            await f("/api/release/v1/feed-format", {
               method: "GET",
               headers: { Authorization: `Bearer ${expired}` },
            })
         ).status,
      ).toBe(401);
      const other = await token(600_000, "something-else");
      expect(
         (
            await f("/api/release/v1/feed-format", {
               method: "GET",
               headers: { Authorization: `Bearer ${other}` },
            })
         ).status,
      ).toBe(401);
      expect(await dirty()).toEqual([]);
   });

   it("POST starts the rebuild (system/release); GET reports the stamp until it is current", async () => {
      const e = testEnv();
      await insertPost({ date: "2026-10-01T10:00:00.000Z" });
      await legacyFeed(e);
      const t = await token();
      const f = makeWorker();
      const auth = { Authorization: `Bearer ${t}` };
      const post = await f("/api/release/v1/feed-format", {
         method: "POST",
         headers: auth,
      });
      expect(post.status).toBe(202);
      expect(post.headers.get("cache-control")).toContain("no-store");
      expect(((await post.json()) as { data: { action: string } }).data.action).toBe("started");
      const before = (await (await f("/api/release/v1/feed-format", { headers: auth })).json()) as { data: { current: boolean; rebuilding: boolean } };
      expect(before.data).toMatchObject({ current: false, rebuilding: true });
      await drain(e);
      const after = (await (await f("/api/release/v1/feed-format", { headers: auth })).json()) as { data: { current: boolean } };
      expect(after.data.current).toBe(true);
      // Again: idempotent, nothing to do.
      const again = await f("/api/release/v1/feed-format", {
         method: "POST",
         headers: auth,
      });
      expect(((await again.json()) as { data: { action: string } }).data.action).toBe("current");
      expect(await rebuildLog()).toHaveLength(1);
   });
});
