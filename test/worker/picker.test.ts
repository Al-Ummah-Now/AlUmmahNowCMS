import { createExecutionContext, env } from "cloudflare:test";
import { createWorker } from "../../src/index.ts";
import { describe, expect, it } from "vitest";
import { CMS, cookiesOf, makeWorker, signIn } from "./helpers.ts";

const videosApi = (url: URL) => {
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
   if (url.pathname === "/api/videos/v2") return Response.json({ id: "v2", title: "Private talk", isPublic: false });
   return new Response("nf", { status: 404 });
};

async function session() {
   const { callback } = await signIn(["Moderator"], { id: "picker-ed", email: "picker@example.com" });
   return cookiesOf(callback);
}

describe("picker", () => {
   it("the page renders en and ar (rtl) for a signed-in editor, with the embed origin allowed to frame", async () => {
      const cookie = await session();
      const f = makeWorker(videosApi);
      const en = await f("/picker", { headers: { cookie } });
      expect(en.status).toBe(200);
      const html = await en.text();
      expect(html).toContain('<html lang="en" dir="ltr">');
      expect(html).toContain('<label for="q">');
      expect(html).toContain('href="/sso/accounts?return=%2Fpicker"');
      expect(en.headers.get("content-security-policy")).toContain("frame-src https://videos.test");
      const ar = await (await f("/picker?lang=ar", { headers: { cookie } })).text();
      expect(ar).toContain('<html lang="ar" dir="rtl">');
      expect(ar).toContain("منتقي الفيديو");
   });

   it("search proxies the videos API and drops non-public items", async () => {
      const cookie = await session();
      const res = await makeWorker(videosApi)("/picker/api/search?kind=video&q=talk", { headers: { cookie } });
      expect(res.status).toBe(200);
      const { items } = (await res.json()) as { items: { id: string; embed_url: string }[] };
      expect(items.map((i) => i.id)).toEqual(["v1"]);
      expect(items[0].embed_url).toBe("https://videos.test/embed/v/v1");
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
      expect(JSON.parse(String(row!.snapshot))).toEqual({ title: "Public talk", thumbnail_url: "https://cdn/1.jpg", channel_name: "Ch" });

      const priv = await f("/picker/api/items", { method: "POST", headers, body: JSON.stringify({ ...body, ref_id: "v2" }) });
      expect(priv.status).toBe(404);
      const cross = await f("/picker/api/items", { method: "POST", headers: { ...headers, origin: "https://evil.example" }, body: JSON.stringify(body) });
      expect(cross.status).toBe(403);
      const bad = await f("/picker/api/items", { method: "POST", headers, body: JSON.stringify({ ...body, placement: "sidebar" }) });
      expect(bad.status).toBe(400);
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
