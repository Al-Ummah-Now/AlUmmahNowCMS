/**
 * Snapshots stored with signed (expiring) thumbnail URLs, from before they were made stable, are
 * never served as such: every public response and the home timeline items (what KV stores) carry
 * the videos web app's stable /thumb URL instead (src/lib/stable-thumb.ts).
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { toItems } from "../../src/lib/feed/source.ts";
import { snapshotOf } from "../../src/routes/public-api.ts";
import type { Env } from "../../src/env.ts";
import { makeWorker } from "./helpers.ts";
import { resetFeed } from "./feed-helpers.ts";

const WEB = "https://videos.test"; // VIDEOS_WEB_URL in vitest.config.ts
const V1 = "1c06ffcf-fc42-4c6a-b47f-e9305aaac674";
const V2 = "180d892c-cf14-4318-974d-2eee0e0ed022";
const V3 = "fe2800a9-171c-440f-acbc-575c216935c2";
const PL = "43bed321-475f-4080-815c-c7bca47c85c2";
const CH = "dc111d0f-2cc5-43af-b8d4-967eb39cbf1f";
const PATH_FORM = (id: string) => `https://vz-215a1ffd-a5a.b-cdn.net/bcdn_token=abc&expires=1794589200&token_path=%2F${id}%2F/${id}/thumbnail.jpg`;
const QUERY_FORM = (id: string) => `https://vz-215a1ffd-a5a.b-cdn.net/${id}/thumbnail_3.jpg?token=nud&expires=1794589200`;
const R2_PRIV = (id: string) => `https://media.alummahnow.net/priv/1794589200.c2ln/${id}/thumb.jpg`;

/** Fails when a value carries an expiring URL anywhere. */
function expectNoSigned(value: unknown): void {
   const text = JSON.stringify(value);
   expect(text).not.toContain("bcdn_token");
   expect(text).not.toMatch(/[?&]token=[^"]*expires=/);
   expect(text).not.toContain("/priv/");
}

const at = "2026-11-10T10:00:00.000Z";
const snap = (title: string, thumbnail_url: string | null, extra: Record<string, unknown> = {}) => JSON.stringify({ title, thumbnail_url, channel_name: "Chan", public: true, refreshed_at: at, ...extra });

async function seed() {
   await resetFeed();
   await env.DB.batch(["curated_videos", "pages"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
   const rows: [string, string, string][] = [
      ["video", V1, snap("One", PATH_FORM(V1))],
      ["video", V2, snap("Two", QUERY_FORM(V2))],
      ["playlist", PL, snap("Series", QUERY_FORM(V3))],
      ["channel", CH, snap("Channel", "https://images.alummahnow.net/avatars/c.webp", { latest: [{ id: V1, title: "a", thumbnail_url: R2_PRIV(V1), duration_seconds: 5 }, { id: V3, title: "b", thumbnail_url: PATH_FORM(V3), duration_seconds: 6 }] })],
   ];
   for (const [kind, ref, s] of rows) {
      await env.DB.prepare("INSERT INTO video_snapshots (kind, ref_id, snapshot, attempts, created_at, updated_at) VALUES (?1, ?2, ?3, 0, ?4, ?4)").bind(kind, ref, s, at).run();
      await env.DB.prepare("INSERT INTO timeline_entries (kind, video_kind, ref_id, locale, entry_date, hidden, created_at, updated_at) VALUES ('video', ?1, ?2, 'all', ?3, 0, ?3, ?3)").bind(kind, ref, at).run();
      await env.DB.prepare("INSERT INTO curated_videos (kind, ref_id, placement, locale, sort, status, snapshot) VALUES (?1, ?2, 'home', 'all', 0, 'published', ?3)").bind(kind, ref, s).run();
   }
   await env.DB.prepare("INSERT INTO posts (slug, locale, title, status, published_at, created_at, updated_at, kind, body, tags) VALUES ('p', 'en', 'Post', 'published', ?1, ?1, ?1, 'article', ?2, '[]')")
      .bind(at, `Watch\n\n::video[${V2}]\n`)
      .run();
   const blocks = [
      { id: "shelf", type: "videos", heading: "Watch", items: rows.map(([kind, ref_id]) => ({ kind, ref_id })) },
      { id: "embed", type: "video", kind: "video", ref_id: V1, caption: "Talk" },
   ];
   await env.DB.prepare("INSERT INTO pages (slug, locale, title, blocks, status, published_at, created_at, updated_at) VALUES ('watch', 'en', 'Watch', ?1, 'published', ?2, ?2, ?2)").bind(JSON.stringify(blocks), at).run();
}

describe("stable thumbnails in public output", () => {
   beforeEach(seed);

   it("snapshotOf never serves a signed URL, even when the stored snapshot has one", () => {
      const out = snapshotOf(JSON.parse(snap("One", PATH_FORM(V1))), { videosWebUrl: WEB, kind: "video", refId: V1 });
      expect(out?.thumbnail_url).toBe(`${WEB}/thumb/${V1}.jpg`);
      const ch = snapshotOf(JSON.parse(snap("C", null, { latest: [{ id: V2, title: "x", thumbnail_url: QUERY_FORM(V2) }] })), { videosWebUrl: WEB, kind: "channel", refId: CH });
      expect((ch?.latest as { thumbnail_url: string }[])[0].thumbnail_url).toBe(`${WEB}/thumb/${V2}.jpg`);
      // Unknown video and no web URL: no image rather than an expiring one.
      expect(snapshotOf(JSON.parse(snap("U", "https://vz-x.b-cdn.net/x/thumbnail.jpg?token=a&expires=1")), { videosWebUrl: WEB, kind: "playlist", refId: PL })?.thumbnail_url).toBeNull();
      expectNoSigned([out, ch]);
   });

   it("home, videos, pages and timeline answers carry /thumb URLs only", async () => {
      const f = makeWorker();
      for (const path of ["/api/public/v1/home?locale=en", "/api/public/v1/videos?locale=en&placement=home", "/api/public/v1/pages/watch?locale=en", "/api/public/v1/timeline?locale=en"]) {
         const res = await f(path);
         expect(res.status, path).toBe(200);
         const body = await res.json();
         expectNoSigned(body);
         expect(JSON.stringify(body), path).toContain(`${WEB}/thumb/`);
      }
      const home = (await (await f("/api/public/v1/home?locale=en")).json()) as { videos: { kind: string; ref_id: string; snapshot: { thumbnail_url: string | null; latest?: { thumbnail_url: string }[] } }[] };
      const byRef = new Map(home.videos.map((v) => [v.ref_id, v.snapshot]));
      expect(byRef.get(V1)?.thumbnail_url).toBe(`${WEB}/thumb/${V1}.jpg`);
      expect(byRef.get(V2)?.thumbnail_url).toBe(`${WEB}/thumb/${V2}.jpg`);
      // A playlist cover from a video's thumbnail is that video's /thumb.
      expect(byRef.get(PL)?.thumbnail_url).toBe(`${WEB}/thumb/${V3}.jpg`);
      expect(byRef.get(CH)?.thumbnail_url).toBe("https://images.alummahnow.net/avatars/c.webp");
      expect(byRef.get(CH)?.latest?.map((v) => v.thumbnail_url)).toEqual([`${WEB}/thumb/${V1}.jpg`, `${WEB}/thumb/${V3}.jpg`]);
   });

   it("home timeline items (what the KV feed stores) carry /thumb URLs only", async () => {
      const posts = (await env.DB.prepare("SELECT * FROM posts").all()).results;
      const videos = (await env.DB.prepare("SELECT te.*, vs.snapshot FROM timeline_entries te JOIN video_snapshots vs ON vs.kind = te.video_kind AND vs.ref_id = te.ref_id").all()).results;
      const items = await toItems(env as unknown as Env, posts, videos);
      expect(items).toHaveLength(5);
      expectNoSigned(items);
      const post = items.find((i) => i.type === "post");
      expect(JSON.stringify(post)).toContain(`${WEB}/thumb/${V2}.jpg`);
   });
});
