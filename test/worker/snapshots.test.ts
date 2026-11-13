import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { refreshCuratedSnapshots } from "../../src/lib/snapshots.ts";
import { makeWorker } from "./helpers.ts";

const API = "https://videos.api.test";
const OLD = JSON.stringify({ title: "Old", thumbnail_url: "https://cdn/old.jpg?token=x&expires=1", channel_name: "Ch" });

/** Fake videos API: v-<n> are public videos, gone-<n> are 404, flaky-<n> answer 500. */
function videosApi(calls: string[] = [], delay = 0): typeof fetch {
   return (async (input: RequestInfo | URL) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      calls.push(url.pathname);
      if (delay) await new Promise((r) => setTimeout(r, delay));
      const id = url.pathname.split("/").pop()!;
      if (id.startsWith("gone")) return new Response("nf", { status: 404 });
      if (id.startsWith("flaky")) return new Response("boom", { status: 500 });
      return Response.json({
         id,
         title: `Title ${id}`,
         titleLocalized: { ar: `عنوان ${id}` },
         description: "Desc",
         thumbnailUrl: `https://cdn/${id}.jpg?token=new&expires=9999999999`,
         channelName: "Ch",
         duration: 125,
         dateCreated: "2026-01-02T03:04:05Z",
         isPublic: true,
         uploadStatus: "ready",
      });
   }) as typeof fetch;
}

async function seed(ids: string[]) {
   const stmt = env.DB.prepare("INSERT INTO curated_videos (kind, ref_id, placement, locale, sort, status, snapshot) VALUES ('video', ?1, 'home', 'all', ?2, 'published', ?3)");
   await env.DB.batch(ids.map((id, i) => stmt.bind(id, i, OLD)));
}
const snap = async (refId: string) =>
   JSON.parse(String((await env.DB.prepare("SELECT snapshot FROM curated_videos WHERE ref_id = ?1").bind(refId).first<{ snapshot: string }>())!.snapshot));

describe("curated snapshot refresh", () => {
   beforeEach(async () => {
      await env.DB.prepare("DELETE FROM curated_videos").run();
   });

   it("20 overlapping runs over 60 rows: every public row refreshed, gone rows hidden, failing rows kept", async () => {
      const ids = [...Array.from({ length: 50 }, (_, i) => `v-${i}`), ...Array.from({ length: 5 }, (_, i) => `gone-${i}`), ...Array.from({ length: 5 }, (_, i) => `flaky-${i}`)];
      await seed(ids);
      const now = new Date("2026-11-09T12:00:00Z");
      const results = await Promise.all(Array.from({ length: 20 }, () => refreshCuratedSnapshots(env.DB, { apiUrl: API, webUrl: "https://videos.test" }, videosApi(), { now, limit: 100 })));
      expect(results.every((r) => r.checked === 60)).toBe(true);
      // Exactly one write per changed row across all runs; the rest lost the compare-and-set.
      expect(results.reduce((n, r) => n + r.refreshed, 0)).toBe(50);
      expect(results.reduce((n, r) => n + r.hidden, 0)).toBe(5);
      for (let i = 0; i < 50; i++) {
         expect(await snap(`v-${i}`)).toEqual({
            title: `Title v-${i}`,
            // A signed URL is never stored; with no video UUID to make a /thumb from, no image.
            thumbnail_url: null,
            channel_name: "Ch",
            handle: null,
            description: "Desc",
            titles: { ar: `عنوان v-${i}` },
            descriptions: {},
            duration_seconds: 125,
            upload_date: "2026-01-02T03:04:05Z",
            video_count: null,
            width: null,
            height: null,
            channel_names: {},
            public: true,
            refreshed_at: now.toISOString(),
         });
      }
      for (let i = 0; i < 5; i++) {
         expect(await snap(`gone-${i}`)).toEqual({ title: "Old", thumbnail_url: null, channel_name: "Ch", public: false, refreshed_at: now.toISOString() });
         expect(await snap(`flaky-${i}`)).toEqual(JSON.parse(OLD));
      }
   });

   it("never overwrites a snapshot written while the lookup was in flight", async () => {
      await seed(["v-1"]);
      const run = refreshCuratedSnapshots(env.DB, { apiUrl: API, webUrl: "https://videos.test" }, videosApi([], 50), { limit: 10 });
      const edited = JSON.stringify({ title: "Edited meanwhile", thumbnail_url: null, channel_name: null });
      await env.DB.prepare("UPDATE curated_videos SET snapshot = ?1 WHERE ref_id = 'v-1'").bind(edited).run();
      const r = await run;
      expect(r.skipped).toBe(1);
      expect(await snap("v-1")).toEqual(JSON.parse(edited));
   });

   it("refreshes the oldest snapshots first, a batch at a time", async () => {
      await seed(Array.from({ length: 30 }, (_, i) => `v-${i}`));
      const calls: string[] = [];
      await refreshCuratedSnapshots(env.DB, { apiUrl: API, webUrl: "https://videos.test" }, videosApi(calls), { now: new Date("2026-11-09T12:00:00Z"), limit: 20 });
      await refreshCuratedSnapshots(env.DB, { apiUrl: API, webUrl: "https://videos.test" }, videosApi(calls), { now: new Date("2026-11-09T12:30:00Z"), limit: 20 });
      // Run 2 takes the 10 never-refreshed rows first, then the 10 oldest of run 1.
      expect(calls).toHaveLength(40);
      expect(new Set(calls.slice(20, 30))).toEqual(new Set(Array.from({ length: 10 }, (_, i) => `/api/videos/v-${20 + i}`)));
   });

   it("the public API hides rows found not public and serves the refreshed fields", async () => {
      await seed(["v-1", "gone-1"]);
      await refreshCuratedSnapshots(env.DB, { apiUrl: API, webUrl: "https://videos.test" }, videosApi());
      const res = await makeWorker()("/api/public/v1/home?locale=en");
      const { videos } = (await res.json()) as { videos: { ref_id: string; snapshot: Record<string, unknown> }[] };
      expect(videos.map((v) => v.ref_id)).toEqual(["v-1"]);
      expect(videos[0].snapshot).toMatchObject({ title: "Title v-1", duration_seconds: 125, titles: { ar: "عنوان v-1" }, refreshed_at: expect.any(String) });
   });
});
