import { describe, expect, it } from "vitest";
import { fromSearchResult, imageUrl, isPublicItem, lookupItem, searchVideos, toItem } from "../../src/lib/videos.ts";
import { applyRules } from "../../src/lib/content-rules.ts";
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
   it("isPublicItem hides items scheduled for the future", () => {
      const future = new Date(Date.now() + 86_400_000).toISOString();
      const past = new Date(Date.now() - 86_400_000).toISOString();
      expect(isPublicItem("video", { scheduledAt: future, uploadStatus: "ready" })).toBe(false);
      expect(isPublicItem("playlist", { scheduled_at: future })).toBe(false);
      expect(isPublicItem("video", { scheduledAt: past, uploadStatus: "ready" })).toBe(true);
      expect(isPublicItem("video", { scheduledAt: null, uploadStatus: "ready" })).toBe(true);
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
      expect(await lookupItem("https://v", "playlist", "p1", ok)).toMatchObject({ kind: "playlist", id: "p1", title: "List", thumbnail_url: null, channel_name: "Ch", video_count: null });
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

describe("imageUrl (thumbnails from the videos API)", () => {
   it("keeps https URLs, including signed ones", () => {
      expect(imageUrl("https://vz-1.b-cdn.net/v/thumbnail.jpg?token=abc&expires=1")).toBe("https://vz-1.b-cdn.net/v/thumbnail.jpg?token=abc&expires=1");
   });
   it("adds https and encodes legacy scheme-less thumbnails", () => {
      const out = imageUrl("images.alummahnow.net/مواقف من السيرة ｜ (٤).jpg");
      expect(out).toMatch(/^https:\/\/images\.alummahnow\.net\/%D9%85/);
      expect(out).not.toContain(" ");
      expect(imageUrl("//images.alummahnow.net/a b.jpg")).toBe("https://images.alummahnow.net/a%20b.jpg");
   });
   it("upgrades our own http images and drops anything else", () => {
      expect(imageUrl("http://images.alummahnow.net/x.jpg")).toBe("https://images.alummahnow.net/x.jpg");
      expect(imageUrl("http://elsewhere.example/x.jpg")).toBeNull();
      expect(imageUrl("http://evilalummahnow.net/x.jpg")).toBeNull();
      expect(imageUrl("http://alummahnow.net/x.jpg")).toBe("https://alummahnow.net/x.jpg");
      expect(imageUrl("/relative/x.jpg")).toBeNull();
      expect(imageUrl("javascript:alert(1)")).toBeNull();
      expect(imageUrl("")).toBeNull();
      expect(imageUrl(null)).toBeNull();
      expect(imageUrl(`https://a.example/${"x".repeat(2100)}`)).toBeNull();
   });
   it("a legacy video is pickable: its snapshot passes the curated rules", () => {
      const item = toItem("video", { id: "v1", title: "Legacy", thumbnailUrl: "images.alummahnow.net/legacy talk.jpg" });
      expect(item?.thumbnail_url).toBe("https://images.alummahnow.net/legacy%20talk.jpg");
      expect(() => applyRules("curated_videos", { kind: "video", ref_id: "v1", snapshot: { title: item!.title, thumbnail_url: item!.thumbnail_url, channel_name: null } }, "create")).not.toThrow();
   });
});
