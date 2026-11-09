import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { CURATED_MAX } from "../../src/routes/public-api.ts";
import { CMS, cookiesOf, makeWorker, signIn } from "./helpers.ts";

const videosApi = (url: URL) =>
   url.pathname === "/api/videos/v1"
      ? Response.json({ id: "v1", title: "Public talk", thumbnailUrl: "https://cdn/1.jpg", channelName: "Ch", isPublic: true })
      : new Response("nf", { status: 404 });

async function editor() {
   const { callback } = await signIn(["Moderator"], { id: "curated-ed", email: "curated@example.com" });
   return cookiesOf(callback);
}

const count = async (where = "1") => Number((await env.DB.prepare(`SELECT COUNT(*) AS n FROM curated_videos WHERE ${where}`).first<{ n: number }>())?.n);

describe("curated videos under concurrency", () => {
   beforeEach(async () => {
      await env.DB.prepare("DELETE FROM curated_videos").run();
   });

   it("100 parallel picker adds of one video to one placement/locale create exactly one row", async () => {
      const cookie = await editor();
      const f = makeWorker(videosApi);
      const headers = { cookie, "content-type": "application/json", origin: CMS };
      const body = JSON.stringify({ kind: "video", ref_id: "v1", placement: "home", locale: "all", sort: 1, status: "published" });
      const out = await Promise.all(Array.from({ length: 100 }, () => f("/picker/api/items", { method: "POST", headers, body })));
      const statuses = out.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 200)).toHaveLength(99);
      const datas = await Promise.all(out.map((r) => r.json() as Promise<{ data: { id: number; snapshot: unknown } }>));
      expect(new Set(datas.map((d) => d.data.id)).size).toBe(1);
      expect(datas[0].data.snapshot).toMatchObject({ title: "Public talk", thumbnail_url: "https://cdn/1.jpg", channel_name: "Ch", public: true });
      expect(await count()).toBe(1);
      const row = await env.DB.prepare("SELECT status, sort, created_at, updated_at FROM curated_videos").first<Record<string, unknown>>();
      expect(row).toMatchObject({ status: "published", sort: 1 });
      expect(row!.created_at).toBe(row!.updated_at);
   });

   it("the same video in another placement or locale is a separate row", async () => {
      const cookie = await editor();
      const f = makeWorker(videosApi);
      const headers = { cookie, "content-type": "application/json", origin: CMS };
      const combos = [
         ["home", "all"],
         ["home", "en"],
         ["videos", "all"],
         ["videos", "ar"],
      ];
      await Promise.all(
         combos.flatMap(([placement, locale]) =>
            Array.from({ length: 10 }, () => f("/picker/api/items", { method: "POST", headers, body: JSON.stringify({ kind: "video", ref_id: "v1", placement, locale }) })),
         ),
      );
      expect(await count()).toBe(4);
   });

   it("parallel admin-API creates of the same video keep one row (unique index); a NULL locale is stored as 'all'", async () => {
      const cookie = await editor();
      const f = makeWorker();
      const headers = { cookie, "content-type": "application/json", origin: CMS };
      const body = JSON.stringify({ kind: "video", ref_id: "v9", placement: "videos", snapshot: { title: "t", thumbnail_url: null, channel_name: null } });
      const out = await Promise.all(Array.from({ length: 20 }, () => f("/api/data/entity/curated_videos", { method: "POST", headers, body })));
      expect(out.filter((r) => r.status === 201)).toHaveLength(1);
      expect(out.every((r) => r.status === 201 || r.status >= 400)).toBe(true);
      expect(await count()).toBe(1);
      expect(await count("locale = 'all'")).toBe(1);
   });

   it(`the public API serves at most ${CURATED_MAX} curated rows per placement`, async () => {
      const stmt = env.DB.prepare("INSERT INTO curated_videos (kind, ref_id, placement, locale, sort, status) VALUES ('video', ?1, ?2, 'all', ?3, 'published')");
      await env.DB.batch(Array.from({ length: 120 }, (_, i) => stmt.bind(`v${i}`, i % 2 ? "videos" : "home", i)));
      const api = makeWorker();
      const home = (await (await api("/api/public/v1/home?locale=en")).json()) as { videos: { ref_id: string; sort: number }[] };
      expect(home.videos).toHaveLength(CURATED_MAX);
      expect(home.videos[0].sort).toBe(0);
      const videos = (await (await api("/api/public/v1/videos?locale=ar")).json()) as { items: unknown[] };
      expect(videos.items).toHaveLength(CURATED_MAX);
   });
});
