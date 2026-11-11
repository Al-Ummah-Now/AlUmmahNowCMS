import { createExecutionContext, env } from "cloudflare:test";
import { createWorker } from "../../src/index.ts";
import { describe, expect, it } from "vitest";
import { CMS, cookiesOf, makeWorker, signIn } from "./helpers.ts";

const videosApi = (url: URL) => {
   if (url.pathname === "/api/search" && !url.searchParams.get("q")) {
      // A picker opening: no query, newest first, paged
      const second = url.searchParams.get("cursor") === "20";
      return Response.json({
         results: second ? [] : [{ type: "video", id: "v1", video: { id: "v1", title: "Public talk", isPublic: true } }, { type: "video", id: "v2", video: { id: "v2", title: "Private", isPublic: false } }],
         nextCursor: second ? null : "20",
         sort: url.searchParams.get("sort"),
      });
   }
   if (url.pathname === "/api/search") {
      return Response.json({
         results: [
            { type: "video", id: "v1", video: { id: "v1", title: "Public talk", thumbnailUrl: "https://cdn/1.jpg", channelName: "Ch", isPublic: true } },
            { type: "video", id: "v2", video: { id: "v2", title: "Private talk", isPublic: false } },
            { type: "video", id: "v3", video: { id: "v3", title: "Unlisted", visibility: "unlisted" } },
         ],
      });
   }
   if (url.pathname === "/api/videos/v1") return Response.json({ id: "v1", title: "Public talk", thumbnailUrl: "https://cdn/1.jpg", channelName: "Ch", isPublic: true, uploadStatus: "ready" });
   if (url.pathname === "/api/videos/v4") return Response.json({ id: "v4", title: "Second talk", thumbnailUrl: "https://cdn/4.jpg", channelName: "Ch", isPublic: true, uploadStatus: "ready" });
   if (url.pathname === "/api/videos/v2") return Response.json({ id: "v2", title: "Private talk", isPublic: false });
   return new Response("nf", { status: 404 });
};

async function session() {
   const { callback } = await signIn(["Moderator"], { id: "picker-ed", email: "picker@example.com" });
   return cookiesOf(callback);
}

describe("picker", () => {
   it("/picker now redirects to the Videos screen, which may frame the embed origin", async () => {
      const cookie = await session();
      const f = makeWorker(videosApi);
      const res = await f("/picker", { headers: { cookie } });
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/videos");
      const videos = await f("/videos", { headers: { cookie } });
      expect(videos.status).toBe(200);
      expect(videos.headers.get("content-security-policy")).toContain("frame-src https://videos.test");
   });

   it("search proxies the videos API and drops non-public items", async () => {
      const cookie = await session();
      const res = await makeWorker(videosApi)("/picker/api/search?kind=video&q=talk", { headers: { cookie } });
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as { items: { id: string; embed_url: string }[] };
      expect(items.map((i) => i.id)).toEqual(["v1"]);
      expect(items[0].embed_url).toBe("https://videos.test/embed/v/v1");
   });

   it("an empty query lists the first page (public only) with a cursor for the next", async () => {
      const cookie = await session();
      const f = makeWorker(videosApi);
      const res = await f("/picker/api/search?kind=video&q=", { headers: { cookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: { id: string }[]; next_cursor: string | null };
      expect(body.items.map((i) => i.id)).toEqual(["v1"]);
      expect(body.next_cursor).toBe("20");
      const next = (await (await f("/picker/api/search?kind=video&cursor=20", { headers: { cookie } })).json()) as { items: unknown[]; next_cursor: string | null };
      expect(next.items).toEqual([]);
      expect(next.next_cursor).toBeNull();
   });

   it("validates the query", async () => {
      const cookie = await session();
      const f = makeWorker(videosApi);
      expect((await f("/picker/api/search?kind=video&q=a", { headers: { cookie } })).status).toBe(400);
      expect((await f("/picker/api/search?kind=user&q=abc", { headers: { cookie } })).status).toBe(400);
   });

   it("creates a curated_videos row with a server-side snapshot; refuses non-public and cross-origin", async () => {
      const cookie = await session();
      const f = makeWorker(videosApi);
      const headers = { cookie, "content-type": "application/json", origin: CMS };
      const body = { kind: "video", ref_id: "v1", placement: "home", locale: "all", sort: 3, status: "published", title_override: null };
      const res = await f("/picker/api/items", { method: "POST", headers, body: JSON.stringify(body) });
      expect(res.status).toBe(201);
      const row = await env.DB.prepare("SELECT kind, ref_id, placement, locale, sort, status, snapshot FROM curated_videos WHERE ref_id = 'v1'").first<Record<string, unknown>>();
      expect(row).toMatchObject({ kind: "video", placement: "home", locale: "all", sort: 3, status: "published" });
      expect(JSON.parse(String(row!.snapshot))).toMatchObject({ title: "Public talk", thumbnail_url: "https://cdn/1.jpg", channel_name: "Ch", public: true, refreshed_at: expect.any(String) });

      const priv = await f("/picker/api/items", { method: "POST", headers, body: JSON.stringify({ ...body, ref_id: "v2" }) });
      expect(priv.status).toBe(404);
      const cross = await f("/picker/api/items", { method: "POST", headers: { ...headers, origin: "https://evil.example" }, body: JSON.stringify(body) });
      expect(cross.status).toBe(403);
      const bad = await f("/picker/api/items", { method: "POST", headers, body: JSON.stringify({ ...body, placement: "sidebar" }) });
      expect(bad.status).toBe(400);
   });

   it("changes the video of a row with a fresh server-side snapshot", async () => {
      const cookie = await session();
      const f = makeWorker(videosApi);
      const headers = { cookie, "content-type": "application/json", origin: CMS };
      const created = await f("/picker/api/items", { method: "POST", headers, body: JSON.stringify({ kind: "video", ref_id: "v1", placement: "videos", locale: "all", sort: 1, status: "draft" }) });
      expect(created.status).toBe(201);
      const { data } = (await created.json()) as { data: { id: number } };
      const res = await f(`/picker/api/items/${data.id}`, { method: "PUT", headers, body: JSON.stringify({ kind: "video", ref_id: "v4" }) });
      expect(res.status, await res.clone().text()).toBe(200);
      const row = await env.DB.prepare("SELECT ref_id, snapshot FROM curated_videos WHERE id = ?1").bind(data.id).first<Record<string, unknown>>();
      expect(row!.ref_id).toBe("v4");
      expect(JSON.parse(String(row!.snapshot))).toMatchObject({ title: "Second talk", thumbnail_url: "https://cdn/4.jpg", channel_name: "Ch", public: true, refreshed_at: expect.any(String) });
   });
});

describe("curated row edits", () => {
   it("publishes, renames and re-localises a picked row through the data API", async () => {
      const cookie = await session();
      const f = makeWorker(videosApi);
      const headers = { cookie, "content-type": "application/json", origin: CMS };
      const created = await f("/picker/api/items", { method: "POST", headers, body: JSON.stringify({ kind: "video", ref_id: "v1", placement: "videos", locale: "all", sort: 1, status: "draft" }) });
      expect(created.status).toBe(201);
      const { data } = (await created.json()) as { data: { id: number } };
      for (const body of [{ status: "published" }, { title_override: "On the site" }, { locale: "ar" }, { sort: 20 }]) {
         const res = await f(`/api/data/entity/curated_videos/${data.id}`, { method: "PATCH", headers, body: JSON.stringify(body) });
         expect(res.status, `${JSON.stringify(body)}: ${await res.clone().text()}`).toBe(200);
      }
      const row = await env.DB.prepare("SELECT status, title_override, locale, sort FROM curated_videos WHERE id = ?1").bind(data.id).first();
      expect(row).toMatchObject({ status: "published", title_override: "On the site", locale: "ar", sort: 20 });
   });
});

describe("status pages", () => {
   it("unknown pages are a 404 page with security headers", async () => {
      const res = await makeWorker()("/does-not-exist");
      expect(res.status).toBe(404);
      expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
      expect(await res.text()).toContain("Page not found");
   });
   it("healthz", async () => {
      const res = await makeWorker()("/healthz?deep=1");
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ status: "ok", checks: { config: "ok", d1: "ok" } });
   });
});

describe("fail closed", () => {
   it("without BKND_JWT_SECRET a deployed Worker serves a 503 page, never the admin or SSO", async () => {
      const app = createWorker({ fetch, getApp: () => Promise.reject(new Error("must not boot")) });
      const broken = { ...env, BKND_JWT_SECRET: undefined, ENVIRONMENT: "production" };
      for (const path of ["/", "/sso/login", "/picker", "/api/data/entity/posts"]) {
         const res = await app.fetch(new Request(`${CMS}${path}`), broken, createExecutionContext());
         expect(res.status, path).toBe(503);
      }
      const health = await app.fetch(new Request(`${CMS}/healthz?deep=1`), broken, createExecutionContext());
      expect(health.status).toBe(503);
      expect(await health.json()).toMatchObject({ checks: { config: "BKND_JWT_SECRET is not set" } });
   });
});
