/**
 * The public API www reads must not change (docs/ADMIN_UI_SPEC.md §1.3, §8). Content is written
 * exactly the way the staff screens write it (bknd's data API, the picker endpoint, the cover
 * upload and the alt endpoint), then every public response is compared with a committed snapshot
 * (fixtures/public-api-contract.json) after replacing ids, dates and generated file names.
 */
import { describe, expect, it } from "vitest";
import expected from "./fixtures/public-api-contract.json";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

const ORIGIN = "https://cms.test";
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

const videosApi = (url: URL) => {
   if (url.pathname === "/api/videos/vid-1") return Response.json({ id: "vid-1", title: "Talk one", thumbnailUrl: "https://cdn.test/1.jpg", channelName: "Channel", isPublic: true, uploadStatus: "ready" });
   if (url.pathname === "/api/playlists/pl-1") return Response.json({ id: "pl-1", title: "Series", thumbnailUrl: null, channelName: "Channel", isPublic: true, visibility: "public" });
   return new Response("nf", { status: 404 });
};

/** Stable form of a response: ids, timestamps and generated media names replaced. */
export function normalize(value: unknown): unknown {
   const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
   const walk = (v: unknown, key?: string): unknown => {
      if (Array.isArray(v)) return v.map((x) => walk(x));
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
      if (typeof v === "string" && ISO.test(v)) return "<iso-date>";
      if (typeof v === "string" && key === "url" && v.includes("/api/public/v1/media/")) return v.replace(/media\/[^/]+$/, "media/<file>");
      if (typeof v === "number" && key === "id") return "<id>";
      return v;
   };
   return walk(value);
}

describe("public API contract (www)", () => {
   it("returns the same shapes and values for content written through the staff screens", async () => {
      const { callback } = await signIn(["Admin"], { id: "contract", email: "contract@example.com" });
      const cookie = cookiesOf(callback);
      const f = makeWorker(videosApi);
      const send = async (method: string, path: string, body?: unknown) => {
         const res = await f(path, {
            method,
            headers: { cookie, origin: ORIGIN, ...(body instanceof FormData ? {} : { "content-type": "application/json" }) },
            body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body),
         });
         expect(res.status, `${method} ${path}: ${await res.clone().text()}`).toBeLessThan(300);
         return (await res.json()) as { data: { id: number } };
      };

      // Pages: en published with a cover + alt, ar translation published, a draft that must never show.
      const about = await send("POST", "/api/data/entity/pages", { slug: "about", locale: "en", title: "About", summary: "Who we are", body: "# About\n\n::video[vid-1]\n", seo_title: "About us", seo_description: "Desc", show_in_sitemap: true, status: "published", translation_key: "k-about" });
      await send("POST", "/api/data/entity/pages", { slug: "about", locale: "ar", title: "من نحن", body: "نص", status: "published", translation_key: "k-about", show_in_sitemap: true });
      await send("POST", "/api/data/entity/pages", { slug: "secret", locale: "en", title: "Draft page", status: "draft" });
      const fd = new FormData();
      fd.append("file", new File([PNG], "cover.png", { type: "image/png" }));
      const up = (await send("POST", `/api/media/entity/pages/${about.data.id}/cover?overwrite=true`, fd)) as unknown as { result: { id: number } };
      await send("PATCH", `/admin/api/media/${up.result.id}/alt`, { alt: "A lantern" });
      await send("PATCH", `/api/data/entity/pages/${about.data.id}`, { title: "About Al Ummah Now", status: "published" });

      // Posts: two published (tags, author), one draft.
      await send("POST", "/api/data/entity/posts", { slug: "first", locale: "en", title: "First", excerpt: "One", body: "Body", author_name: "Editorial", tags: ["news"], status: "published" });
      await send("POST", "/api/data/entity/posts", { slug: "second", locale: "en", title: "Second", body: "Body 2", tags: [], status: "published" });
      await send("POST", "/api/data/entity/posts", { slug: "hidden", locale: "en", title: "Hidden", body: "x", status: "draft" });
      // Scheduled (#7): published with a publish_at ahead must not show anywhere yet.
      const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString();
      await send("POST", "/api/data/entity/posts", { slug: "scheduled", locale: "en", title: "Scheduled", body: "x", tags: [], status: "published", publish_at: tomorrow });
      await send("POST", "/api/data/entity/pages", { slug: "launch", locale: "en", title: "Launch", body: "x", status: "published", publish_at: tomorrow, show_in_sitemap: true });

      // Navigation, settings, curated videos (the picker endpoint), as the screens do.
      await send("POST", "/api/data/entity/nav_items", { menu: "header", locale: "en", label: "Videos", url: "/videos", sort: 10, status: "published" });
      await send("POST", "/api/data/entity/nav_items", { menu: "footer", locale: "en", label: "Contact", url: "https://example.org/contact", sort: 10, status: "published" });
      await send("POST", "/api/data/entity/nav_items", { menu: "header", locale: "en", label: "Hidden link", url: "/x", sort: 20, status: "draft" });
      await send("POST", "/api/data/entity/site_settings", { locale: "en", site_title: "Al Ummah Now", tagline: "Tag", hero_title: "Hero", hero_body: "Body", social: [{ kind: "youtube", url: "https://youtube.com/@x" }] });
      const v1 = await send("POST", "/picker/api/items", { kind: "video", ref_id: "vid-1", placement: "home", locale: "all", status: "draft", sort: 10 });
      await send("PATCH", `/api/data/entity/curated_videos/${v1.data.id}`, { status: "published", title_override: "Featured talk" });
      await send("POST", "/picker/api/items", { kind: "playlist", ref_id: "pl-1", placement: "videos", locale: "en", status: "published", sort: 10 });

      const out: Record<string, unknown> = {};
      for (const path of [
         "/api/public/v1/site?locale=en",
         "/api/public/v1/site?locale=ar",
         "/api/public/v1/home?locale=en",
         "/api/public/v1/pages/about?locale=en",
         "/api/public/v1/pages/about?locale=ar",
         "/api/public/v1/pages/secret?locale=en",
         "/api/public/v1/posts?locale=en",
         "/api/public/v1/posts?locale=en&page=2&limit=1",
         "/api/public/v1/posts/first?locale=en",
         "/api/public/v1/posts/hidden?locale=en",
         "/api/public/v1/posts/scheduled?locale=en",
         "/api/public/v1/pages/launch?locale=en",
         "/api/public/v1/videos?locale=en&placement=videos",
         "/api/public/v1/videos?locale=ar&placement=home",
         "/api/public/v1/sitemap",
         "/api/public/v1/site?locale=fr",
      ]) {
         const res = await f(path);
         out[path] = { status: res.status, cache: res.headers.get("cache-control"), etag: res.headers.has("etag"), body: normalize(await res.json()) };
      }
      if (Object.keys(expected).length === 0) console.log(`@@CONTRACT@@${JSON.stringify(out)}@@END@@`);
      expect(out).toEqual(expected);
   });
});
