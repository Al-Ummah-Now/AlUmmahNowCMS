import { describe, expect, it } from "vitest";
import { fromSearchResult, isPublicItem, lookupItem, searchVideos } from "../../src/lib/videos.ts";
import { embedUrl, watchUrl } from "../../src/lib/embeds.ts";

const video = (over: Record<string, unknown> = {}) => ({
   type: "video",
   id: "v1",
   video: { id: "v1", title: "Tafsir", thumbnailUrl: "https://cdn/t.jpg", channelName: "Lectures", isPublic: true, uploadStatus: "ready", ...over },
   channel: { id: "c1", name: "Lectures" },
});

describe("picker: public filter", () => {
   it("keeps public items", () => {
      expect(fromSearchResult(video())).toEqual({ kind: "video", id: "v1", title: "Tafsir", thumbnail_url: "https://cdn/t.jpg", channel_name: "Lectures" });
   });
   it.each([
      [{ isPublic: false }],
      [{ is_public: false }],
      [{ isPrivate: true }],
      [{ visibility: "private" }],
      [{ visibility: "unlisted" }],
      [{ privacy: "followers" }],
      [{ deleted: true }],
      [{ uploadStatus: "processing" }],
   ])("drops a non-public video %j", (over) => expect(fromSearchResult(video(over))).toBeNull());
   it("drops items from a non-public channel", () => {
      expect(fromSearchResult({ ...video(), channel: { id: "c1", name: "x", isPublic: false } })).toBeNull();
   });
   it("drops malformed results", () => {
      expect(fromSearchResult({ type: "user", id: "u" })).toBeNull();
      expect(fromSearchResult({ type: "video", id: "v" })).toBeNull();
      expect(fromSearchResult({ type: "video", video: { id: "v" } })).toBeNull();
   });
   it("normalizes playlists and channels", () => {
      expect(fromSearchResult({ type: "playlist", playlist: { id: "p1", name: "List", isPublic: true }, channel: { name: "Ch" } })).toEqual({
         kind: "playlist",
         id: "p1",
         title: "List",
         thumbnail_url: null,
         channel_name: "Ch",
      });
      expect(fromSearchResult({ type: "channel", channel: { id: "c1", name: "Ch" } })?.channel_name).toBeNull();
   });
   it("isPublicItem treats missing objects as not public", () => {
      expect(isPublicItem("video", null)).toBe(false);
   });
});

describe("searchVideos / lookupItem (proxy)", () => {
   it("queries the unified search and drops non-public results and other kinds", async () => {
      let called = "";
      const fake = (async (url: string) => {
         called = url;
         return Response.json({ results: [video(), video({ isPublic: false, id: "v2" }), { type: "channel", channel: { id: "c", name: "C" } }] });
      }) as unknown as typeof fetch;
      const items = await searchVideos("https://videos.api.test", "video", "taf", fake);
      expect(items.map((i) => i.id)).toEqual(["v1"]);
      const u = new URL(called);
      expect(u.pathname).toBe("/api/search");
      expect(u.searchParams.get("type")).toBe("video");
      expect(u.searchParams.get("q")).toBe("taf");
   });
   it("throws on upstream errors", async () => {
      const fake = (async () => new Response("x", { status: 500 })) as unknown as typeof fetch;
      await expect(searchVideos("https://v", "video", "ab", fake)).rejects.toThrow(/500/);
   });
   it("lookupItem returns null for missing or non-public items and rejects odd ids", async () => {
      const notPublic = (async () => Response.json({ id: "v1", title: "x", isPublic: false })) as unknown as typeof fetch;
      expect(await lookupItem("https://v", "video", "v1", notPublic)).toBeNull();
      const missing = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
      expect(await lookupItem("https://v", "playlist", "p1", missing)).toBeNull();
      expect(await lookupItem("https://v", "video", "../admin", notPublic)).toBeNull();
      const ok = (async (url: string) => {
         expect(url).toBe("https://v/api/playlists/p1");
         return Response.json({ id: "p1", name: "List", isPublic: true, channelName: "Ch" });
      }) as unknown as typeof fetch;
      expect(await lookupItem("https://v", "playlist", "p1", ok)).toEqual({ kind: "playlist", id: "p1", title: "List", thumbnail_url: null, channel_name: "Ch" });
   });
});

describe("embeds adapter (placeholder contract)", () => {
   it("builds video and playlist embed URLs with lang/start", () => {
      expect(embedUrl("https://videos.test/", "video", "v1", { lang: "ar", start: 12.7 })).toBe("https://videos.test/embed/v/v1?lang=ar&start=12");
      expect(embedUrl("https://videos.test", "playlist", "p1", { lang: "en", start: 5 })).toBe("https://videos.test/embed/p/p1?lang=en");
   });
   it("has no embed for channels or unsafe ids", () => {
      expect(embedUrl("https://videos.test", "channel", "c1")).toBeNull();
      expect(embedUrl("https://videos.test", "video", "a/b")).toBeNull();
   });
   it("builds watch URLs", () => expect(watchUrl("https://videos.test", "channel", "c 1")).toBe("https://videos.test/channel/c%201"));
});
