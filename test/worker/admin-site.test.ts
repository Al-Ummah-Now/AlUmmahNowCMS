import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

const ORIGIN = "https://cms.test";
const json = (cookie: string) => ({ cookie, origin: ORIGIN, "content-type": "application/json" });

async function session(roles: string[], id: string) {
   const { callback } = await signIn(roles, { id, email: `${id}@example.com` });
   return cookiesOf(callback);
}

const videosApi = (url: URL) => {
   const video = (id: string, title: string) => Response.json({ id, title, thumbnailUrl: `https://cdn.test/${id}.jpg`, channelName: "Ch", isPublic: true, uploadStatus: "ready" });
   if (url.pathname === "/api/videos/v1") return video("v1", "First talk");
   if (url.pathname === "/api/videos/v2") return video("v2", "Second talk");
   if (url.pathname === "/api/videos/v3") return Response.json({ id: "v3", title: "Private", isPublic: false });
   return new Response("nf", { status: 404 });
};

describe("navigation screen", () => {
   it("lists a menu per language in sort order, with row controls; delete only for admins", async () => {
      const admin = await session(["Admin"], "nav-admin");
      const ed = await session(["Moderator"], "nav-ed");
      const f = makeWorker();
      for (const [label, sort] of [["Second", 20], ["First", 10]] as const) {
         const r = await f("/api/data/entity/nav_items", { method: "POST", headers: json(admin), body: JSON.stringify({ menu: "footer", locale: "ar", label, url: "/x", sort, status: "published" }) });
         expect(r.status).toBe(201);
      }
      const html = await (await f("/navigation?menu=footer&locale=ar", { headers: { cookie: admin } })).text();
      expect(html).toContain('data-rows="nav_items"');
      expect(html.indexOf('value="First"')).toBeLessThan(html.indexOf('value="Second"'));
      expect(html).toContain("data-row-delete");
      expect(html).toContain('name="menu" value="footer"');
      const asEd = await (await f("/navigation?menu=footer&locale=ar", { headers: { cookie: ed } })).text();
      expect(asEd).not.toContain("data-row-delete");
      const header = await (await f("/navigation?menu=header&locale=ar", { headers: { cookie: admin } })).text();
      expect(header).not.toContain('value="First"');
   });

   it("the reorder the screen performs (PATCH sort) is accepted for editors; bad URLs are refused by the content rules", async () => {
      const ed = await session(["Moderator"], "nav-ed2");
      const f = makeWorker();
      const r = await f("/api/data/entity/nav_items", { method: "POST", headers: json(ed), body: JSON.stringify({ menu: "header", locale: "en", label: "A", url: "/a", sort: 10 }) });
      const id = ((await r.json()) as { data: { id: number } }).data.id;
      expect((await f(`/api/data/entity/nav_items/${id}`, { method: "PATCH", headers: json(ed), body: JSON.stringify({ sort: 30 }) })).status).toBe(200);
      expect((await f(`/api/data/entity/nav_items/${id}`, { method: "PATCH", headers: json(ed), body: JSON.stringify({ url: "javascript:alert(1)" }) })).status).toBeGreaterThanOrEqual(400);
      expect((await f(`/api/data/entity/nav_items/${id}`, { method: "DELETE", headers: json(ed) })).status).toBe(403);
   });
});

describe("curated videos re-pick API", () => {
   it("changes a row's video with a fresh server snapshot", async () => {
      const ed = await session(["Moderator"], "vid-ed");
      const f = makeWorker(videosApi);
      const add = await f("/picker/api/items", { method: "POST", headers: json(ed), body: JSON.stringify({ kind: "video", ref_id: "v1", placement: "videos", locale: "all", status: "draft", sort: 10 }) });
      expect(add.status).toBe(201);
      const id = ((await add.json()) as { data: { id: number } }).data.id;
      // The curated shelves' screen is gone (docs/specs/WWW-PAGES.md): /videos is the CMS video library
      // now (test/worker/www-pages.test.ts). The picker's row API stays for www releases still reading it.
      const put = await f(`/picker/api/items/${id}`, { method: "PUT", headers: json(ed), body: JSON.stringify({ kind: "video", ref_id: "v2" }) });
      expect(put.status).toBe(200);
      const row = await env.DB.prepare("SELECT ref_id, snapshot FROM curated_videos WHERE id = ?1").bind(id).first<{ ref_id: string; snapshot: string }>();
      expect(row?.ref_id).toBe("v2");
      expect(JSON.parse(row!.snapshot).title).toBe("Second talk");
   });

   it("re-pick refuses non-public videos, duplicates in the same shelf and cross-origin calls", async () => {
      const ed = await session(["Moderator"], "vid-ed2");
      const f = makeWorker(videosApi);
      const mk = async (ref: string) =>
         ((await (await f("/picker/api/items", { method: "POST", headers: json(ed), body: JSON.stringify({ kind: "video", ref_id: ref, placement: "home", locale: "en", status: "draft", sort: 0 }) })).json()) as { data: { id: number } }).data.id;
      const a = await mk("v1");
      await mk("v2");
      expect((await f(`/picker/api/items/${a}`, { method: "PUT", headers: json(ed), body: JSON.stringify({ kind: "video", ref_id: "v3" }) })).status).toBe(404);
      expect((await f(`/picker/api/items/${a}`, { method: "PUT", headers: json(ed), body: JSON.stringify({ kind: "video", ref_id: "v2" }) })).status).toBe(409);
      expect((await f(`/picker/api/items/${a}`, { method: "PUT", headers: { ...json(ed), origin: "https://evil.example" }, body: JSON.stringify({ kind: "video", ref_id: "v2" }) })).status).toBe(403);
      expect((await f("/picker/api/items/99999999", { method: "PUT", headers: json(ed), body: JSON.stringify({ kind: "video", ref_id: "v2" }) })).status).toBe(404);
   });
});

describe("site settings screen", () => {
   it("renders an empty form per language and then the saved values, with social rows", async () => {
      const ed = await session(["Moderator"], "site-ed");
      const f = makeWorker();
      const empty = await (await f("/site?locale=ar", { headers: { cookie: ed } })).text();
      expect(empty).toContain('data-site=""');
      expect(empty).toContain('data-locale="ar"');
      const r = await f("/api/data/entity/site_settings", { method: "POST", headers: json(ed), body: JSON.stringify({ locale: "ar", site_title: "الأمة الآن", social: [{ kind: "youtube", url: "https://youtube.com/@x" }] }) });
      expect(r.status).toBe(201);
      const html = await (await f("/site?locale=ar", { headers: { cookie: ed } })).text();
      expect(html).toContain('value="الأمة الآن"');
      expect(html).toContain('value="https://youtube.com/@x"');
      expect(html).not.toContain('data-site=""');
   });
});

describe("library screen", () => {
   it("lists media with usage; delete only for admins; uploads go through the wrapper's image policy", async () => {
      const admin = await session(["Admin"], "lib-admin");
      const ed = await session(["Moderator"], "lib-ed");
      const f = makeWorker();
      const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
      const fd = new FormData();
      fd.append("file", new File([PNG], "lib.png", { type: "image/png" }));
      expect((await f("/api/media/upload", { method: "POST", headers: { cookie: ed, origin: ORIGIN }, body: fd })).status).toBeLessThan(300);
      const bad = new FormData();
      bad.append("file", new File(["<svg/>"], "x.svg", { type: "image/svg+xml" }));
      expect((await f("/api/media/upload", { method: "POST", headers: { cookie: ed, origin: ORIGIN }, body: bad })).status).toBe(415);
      const asAdmin = await (await f("/library", { headers: { cookie: admin } })).text();
      expect(asAdmin).toContain("data-media-delete");
      expect(asAdmin).toContain("data-media-alt");
      const asEd = await (await f("/library", { headers: { cookie: ed } })).text();
      expect(asEd).toContain("data-media=");
      expect(asEd).not.toContain("data-media-delete");
   });
});
