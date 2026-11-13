import { describe, expect, it } from "vitest";
import { isSignedUrl, stableDeep, stableImageUrl, stableSnapshot } from "../../src/lib/stable-thumb.ts";
import { snapshotOf } from "../../src/lib/snapshots.ts";
import { toDetail } from "../../src/lib/videos.ts";

const WEB = "https://videos.test";
const V1 = "1c06ffcf-fc42-4c6a-b47f-e9305aaac674";
const V2 = "180d892c-cf14-4318-974d-2eee0e0ed022";
const PATH_FORM = `https://vz-215a1ffd-a5a.b-cdn.net/bcdn_token=abcDEF_123&expires=1794589200&token_path=%2F${V1}%2F/${V1}/thumbnail.jpg`;
const QUERY_FORM = `https://vz-215a1ffd-a5a.b-cdn.net/${V2}/thumbnail_3.jpg?token=nudkLIAWByCB&expires=1794589200`;
const R2_PRIV = `https://media.qa.alummahnow.net/priv/1794589200.c2lnbmF0dXJl/${V1}/thumb.jpg`;

describe("stableImageUrl", () => {
   it("swaps a path-form Bunny token URL for the video's /thumb", () => {
      expect(stableImageUrl(WEB, PATH_FORM)).toBe(`${WEB}/thumb/${V1}.jpg`);
   });

   it("swaps a query-form Bunny token URL for the video's /thumb", () => {
      expect(stableImageUrl(WEB, QUERY_FORM)).toBe(`${WEB}/thumb/${V2}.jpg`);
   });

   it("swaps a private R2 rendition for the video's /thumb", () => {
      expect(stableImageUrl(WEB, R2_PRIV)).toBe(`${WEB}/thumb/${V1}.jpg`);
      expect(stableImageUrl(WEB, `https://media.alummahnow.net/priv/1.sig/${V2}/a.jpg`)).toBe(`${WEB}/thumb/${V2}.jpg`);
   });

   it("uses the owning video's id when given (a video's own image)", () => {
      expect(stableImageUrl(WEB, QUERY_FORM, V1)).toBe(`${WEB}/thumb/${V1}.jpg`);
      // An owner that isn't a video UUID is ignored: the id in the URL is used.
      expect(stableImageUrl(WEB, QUERY_FORM, "../admin")).toBe(`${WEB}/thumb/${V2}.jpg`);
   });

   it("finds the id in token_path when the path has no bare id segment", () => {
      expect(stableImageUrl(WEB, `https://vz-x.b-cdn.net/bcdn_token=a&expires=1&token_path=%2F${V2}%2F/thumb.jpg`)).toBe(`${WEB}/thumb/${V2}.jpg`);
   });

   it("leaves unsigned URLs alone", () => {
      for (const u of [
         `https://images.alummahnow.net/thumbnails/${V1}/custom.jpg?width=1280&quality=90`,
         `https://media.alummahnow.net/pub/${V1}/thumb.jpg`,
         "https://images.alummahnow.net/avatars/a.webp",
         "https://cms.alummahnow.net/api/public/v1/media/cover.png?w=320",
         // token without expires is not a signature we know
         `https://cdn.example/${V1}/x.jpg?token=abc`,
         // /priv/ on a host that isn't our media host
         `https://example.com/priv/1.sig/${V1}/x.jpg`,
      ]) {
         expect(isSignedUrl(u)).toBe(false);
         expect(stableImageUrl(WEB, u)).toBe(u);
      }
   });

   it("returns null for a signed URL whose video can't be told, or a non-https web URL", () => {
      expect(stableImageUrl(WEB, "https://vz-x.b-cdn.net/not-a-uuid/thumbnail.jpg?token=a&expires=1")).toBeNull();
      expect(stableImageUrl(WEB, `https://vz-x.b-cdn.net/${V1.slice(0, 35)}g/thumbnail.jpg?token=a&expires=1`)).toBeNull();
      expect(stableImageUrl("http://videos.test", PATH_FORM)).toBeNull();
      expect(stableImageUrl("", PATH_FORM)).toBeNull();
      expect(stableImageUrl("javascript:alert(1)", PATH_FORM)).toBeNull();
   });

   it("trims a trailing slash from the web URL and passes null through", () => {
      expect(stableImageUrl(`${WEB}/`, PATH_FORM)).toBe(`${WEB}/thumb/${V1}.jpg`);
      expect(stableImageUrl(WEB, null)).toBeNull();
   });
});

describe("stableSnapshot", () => {
   it("a playlist cover taken from a video's thumbnail is that video's /thumb", () => {
      const s = stableSnapshot(WEB, { title: "Series", thumbnail_url: QUERY_FORM }, "playlist", "43bed321-475f-4080-815c-c7bca47c85c2");
      expect(s.thumbnail_url).toBe(`${WEB}/thumb/${V2}.jpg`);
   });

   it("a channel's latest[] videos each get their own /thumb; its avatar is left alone", () => {
      const avatar = "https://images.alummahnow.net/avatars/c.webp";
      const s = stableSnapshot(
         WEB,
         {
            title: "Channel",
            thumbnail_url: avatar,
            latest: [
               { id: V1, title: "a", thumbnail_url: PATH_FORM, duration_seconds: 10 },
               { id: V2, title: "b", thumbnail_url: R2_PRIV, duration_seconds: null },
               { id: "x", title: "c", thumbnail_url: "https://images.alummahnow.net/t.jpg", duration_seconds: null },
            ],
         },
         "channel",
         "c1",
      );
      expect(s.thumbnail_url).toBe(avatar);
      expect((s.latest as { thumbnail_url: string }[]).map((v) => v.thumbnail_url)).toEqual([`${WEB}/thumb/${V1}.jpg`, `${WEB}/thumb/${V2}.jpg`, "https://images.alummahnow.net/t.jpg"]);
   });

   it("returns the same object when nothing is signed", () => {
      const snap = { title: "t", thumbnail_url: "https://images.alummahnow.net/t.jpg" };
      expect(stableSnapshot(WEB, snap, "video", V1)).toBe(snap);
   });
});

describe("write time", () => {
   it("snapshotOf stores a video's signed thumbnail as its /thumb", () => {
      const item = toDetail("video", { id: V1, title: "Talk", thumbnailUrl: QUERY_FORM })!;
      expect(snapshotOf(item, new Date(), WEB).thumbnail_url).toBe(`${WEB}/thumb/${V1}.jpg`);
   });
});

describe("stableDeep", () => {
   it("rewrites every signed URL in a stored document and counts them", () => {
      const doc = {
         items: [
            { key: "v1", video: { kind: "video", ref_id: V1, snapshot: { title: "a", thumbnail_url: QUERY_FORM } } },
            { key: "p1", post: { cover: { url: "https://cms.alummahnow.net/x.png" }, videos: [{ kind: "video", ref_id: V2, snapshot: { title: "b", thumbnail_url: PATH_FORM } }] } },
            { key: "v2", video: { kind: "channel", ref_id: "c", snapshot: { title: "c", latest: [{ id: V2, title: "d", thumbnail_url: R2_PRIV }] } } },
         ],
      };
      const { value, changed } = stableDeep(WEB, doc);
      expect(changed).toBe(3);
      const text = JSON.stringify(value);
      expect(text).not.toMatch(/bcdn_token|token=|\/priv\//);
      const items = (value as typeof doc).items;
      // A video's own snapshot uses its ref_id, even when the URL names another video.
      expect(items[0].video!.snapshot.thumbnail_url).toBe(`${WEB}/thumb/${V1}.jpg`);
      expect(items[1].post!.videos[0].snapshot.thumbnail_url).toBe(`${WEB}/thumb/${V2}.jpg`);
      expect(JSON.stringify(items[2])).toContain(`${WEB}/thumb/${V2}.jpg`);
      expect(stableDeep(WEB, { a: "https://images.alummahnow.net/x.jpg" }).changed).toBe(0);
   });

   it("rewrites inside a snapshot kept as JSON text (a trash copy of a row) and keeps it as text", () => {
      const data = { id: 4, kind: "video", ref_id: V1, snapshot: JSON.stringify({ title: "a", thumbnail_url: QUERY_FORM }) };
      const { value, changed, dropped } = stableDeep(WEB, data);
      expect([changed, dropped]).toEqual([1, 0]);
      const out = value as typeof data;
      expect(typeof out.snapshot).toBe("string");
      expect(JSON.parse(out.snapshot).thumbnail_url).toBe(`${WEB}/thumb/${V1}.jpg`);
      expect(stableDeep(WEB, { t: "https://vz-x.b-cdn.net/x/y.jpg?token=a&expires=1" })).toMatchObject({ changed: 1, dropped: 1, value: { t: null } });
   });
});
