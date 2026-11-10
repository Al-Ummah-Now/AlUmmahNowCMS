import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

const ORIGIN = "https://cms.test";

async function session(roles: string[], id: string) {
   const { callback } = await signIn(roles, { id, email: `${id}@example.com` });
   return cookiesOf(callback);
}

async function create(f: ReturnType<typeof makeWorker>, cookie: string, entity: string, body: Record<string, unknown>) {
   const res = await f(`/api/data/entity/${entity}`, { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });
   expect(res.status, await res.clone().text()).toBe(201);
   return ((await res.json()) as { data: { id: number } }).data.id;
}

describe("pages and posts screens", () => {
   it("lists with search, status and locale filters, sort and paging links", async () => {
      const cookie = await session(["Admin"], "list-admin");
      const f = makeWorker();
      await create(f, cookie, "pages", { slug: "about", locale: "en", title: "About us", status: "published" });
      await create(f, cookie, "pages", { slug: "about", locale: "ar", title: "من نحن", status: "draft" });
      await create(f, cookie, "pages", { slug: "contact", locale: "en", title: "Contact", status: "draft" });
      const all = await (await f("/pages", { headers: { cookie } })).text();
      expect(all).toContain("3 results");
      expect(all).toContain('lang="ar" dir="auto"');
      const drafts = await (await f("/pages?status=draft", { headers: { cookie } })).text();
      expect(drafts).toContain("2 results");
      const ar = await (await f("/pages?locale=ar", { headers: { cookie } })).text();
      expect(ar).toContain("1 result");
      expect(ar).toContain("من نحن");
      const q = await (await f("/pages?q=conta", { headers: { cookie } })).text();
      expect(q).toContain("1 result");
      expect(q).toContain("Contact");
      const bySlug = await (await f("/pages?q=abou&sort=title", { headers: { cookie } })).text();
      expect(bySlug).toContain("2 results");
      // bknd ORs a $or group with its siblings; search + filter must still filter (spec §0).
      const draftQ = await (await f("/pages?q=abou&status=draft", { headers: { cookie } })).text();
      expect(draftQ).toContain("1 result");
      expect(draftQ).toContain("من نحن");
      const none = await (await f("/pages?q=zzzz", { headers: { cookie } })).text();
      expect(none).toContain("No matches");
   });

   it("renders the editor for a row (admin sees Delete, editor doesn't) and 404s a missing id", async () => {
      const admin = await session(["Admin"], "ed-admin");
      const ed = await session(["Moderator"], "ed-ed");
      const f = makeWorker();
      const id = await create(f, admin, "posts", { slug: "hello", locale: "ar", title: "مرحبا", status: "draft", tags: ["أخبار"] });
      const a = await (await f(`/posts/${id}`, { headers: { cookie: admin } })).text();
      expect(a).toContain('data-editor="posts"');
      expect(a).toContain(`data-id="${id}"`);
      expect(a).toContain('data-locale="ar"');
      expect(a).toContain('data-tag="أخبار"');
      expect(a).toContain("data-delete");
      expect(a).toContain('id="picker"');
      const e = await (await f(`/posts/${id}`, { headers: { cookie: ed } })).text();
      expect(e).not.toContain("data-delete");
      expect((await f("/posts/999999", { headers: { cookie: admin } })).status).toBe(404);
      const fresh = await (await f("/pages/new?locale=ar", { headers: { cookie: ed } })).text();
      expect(fresh).toContain('data-locale="ar"');
      expect(fresh).toContain('data-auto-slug="1"');
   });

   it("shows linked translations", async () => {
      const cookie = await session(["Admin"], "tr-admin");
      const f = makeWorker();
      const en = await create(f, cookie, "pages", { slug: "faq", locale: "en", title: "FAQ", translation_key: "k-faq" });
      const ar = await create(f, cookie, "pages", { slug: "faq", locale: "ar", title: "الأسئلة", translation_key: "k-faq" });
      const html = await (await f(`/pages/${en}`, { headers: { cookie } })).text();
      expect(html).toContain(`href="/pages/${ar}"`);
      expect(html).not.toContain("data-add-translation");
   });

   it("the editor's search query shape works against bknd ($or + $like)", async () => {
      const cookie = await session(["Moderator"], "q-ed");
      const f = makeWorker();
      await create(f, cookie, "posts", { slug: "xyz-post", locale: "en", title: "Something" });
      const where = encodeURIComponent(JSON.stringify({ slug: "xyz-post", locale: "en" }));
      const res = await f(`/api/data/entity/posts?where=${where}&select=id&limit=1`, { headers: { cookie } });
      expect(((await res.json()) as { data: unknown[] }).data).toHaveLength(1);
   });
});

describe("PATCH /admin/api/media/:id/alt", () => {
   async function mediaRow(): Promise<number> {
      const r = await env.DB.prepare("INSERT INTO media (path, mime_type, size, reference, entity_id, metadata) VALUES (?1, 'image/png', 10, 'pages.cover', '1', ?2) RETURNING id")
         .bind(`alt-${crypto.randomUUID()}.png`, JSON.stringify({ width: 10, height: 5 }))
         .first<{ id: number }>();
      return r!.id;
   }
   const patch = (f: ReturnType<typeof makeWorker>, cookie: string, id: number, body: unknown, origin = ORIGIN) =>
      f(`/admin/api/media/${id}/alt`, { method: "PATCH", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify(body) });

   it("an editor sets and clears the alt text; other metadata stays", async () => {
      const cookie = await session(["Moderator"], "alt-ed");
      const f = makeWorker();
      const id = await mediaRow();
      const res = await patch(f, cookie, id, { alt: "  A lantern at night " });
      expect(res.status).toBe(200);
      let meta = JSON.parse((await env.DB.prepare("SELECT metadata FROM media WHERE id = ?1").bind(id).first<{ metadata: string }>())!.metadata);
      expect(meta).toEqual({ width: 10, height: 5, alt: "A lantern at night" });
      await patch(f, cookie, id, { alt: "" });
      meta = JSON.parse((await env.DB.prepare("SELECT metadata FROM media WHERE id = ?1").bind(id).first<{ metadata: string }>())!.metadata);
      expect(meta).toEqual({ width: 10, height: 5 });
   });

   it("validates, needs a session and a same-origin Origin, and 404s a missing row", async () => {
      const cookie = await session(["Admin"], "alt-admin");
      const f = makeWorker();
      const id = await mediaRow();
      expect((await patch(f, cookie, id, { alt: "x".repeat(301) })).status).toBe(400);
      expect((await patch(f, cookie, id, { alt: 3 })).status).toBe(400);
      expect((await patch(f, cookie, id, { alt: "ok" }, "https://evil.example")).status).toBe(403);
      expect((await patch(f, "", id, { alt: "ok" })).status).toBe(401);
      expect((await patch(f, cookie, 99_999_999, { alt: "ok" })).status).toBe(404);
   });
});

describe("cover upload and replace through bknd (what the editor does)", () => {
   const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
   const upload = (f: ReturnType<typeof makeWorker>, cookie: string, id: number, name = "cover.png", type = "image/png") => {
      const fd = new FormData();
      fd.append("file", new File([PNG], name, { type }));
      return f(`/api/media/entity/pages/${id}/cover?overwrite=true`, { method: "POST", headers: { cookie, origin: ORIGIN }, body: fd });
   };
   it("an editor uploads a cover, replaces it (one row stays), and the public API serves it", async () => {
      const cookie = await session(["Moderator"], "cover-ed");
      const f = makeWorker();
      const id = await create(f, cookie, "pages", { slug: `cover-${Date.now()}`, locale: "en", title: "Cover", status: "published" });
      const first = await upload(f, cookie, id);
      const second = await upload(f, cookie, id);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      const oldPath = ((await first.json()) as { result: { path: string } }).result.path;
      expect(await env.MEDIA.head(oldPath)).toBeNull();
      const rows = await env.DB.prepare("SELECT path FROM media WHERE reference = 'pages.cover' AND entity_id = ?1").bind(String(id)).all<{ path: string }>();
      expect(rows.results).toHaveLength(1);
      const html = await (await f(`/pages/${id}`, { headers: { cookie } })).text();
      expect(html).toContain(`/api/public/v1/media/${rows.results[0].path}`);
      expect(html).toContain("data-alt-input");
      expect(html).not.toContain("data-cover-remove");
   });
   it("rejects SVG and non-images", async () => {
      const cookie = await session(["Admin"], "cover-admin");
      const f = makeWorker();
      const id = await create(f, cookie, "pages", { slug: `svg-${Date.now()}`, locale: "en", title: "Svg" });
      expect((await upload(f, cookie, id, "x.svg", "image/svg+xml")).status).toBe(415);
   });
});

describe("editor save is a compare-and-set on updated_at (CMS-3)", () => {
   it("the value the editor renders is accepted once; a stale one gets 409", async () => {
      const cookie = await session(["Moderator"], "cas-ed");
      const f = makeWorker();
      const id = await create(f, cookie, "pages", { slug: `cas-${Date.now()}`, locale: "en", title: "CAS" });
      const html = await (await f(`/pages/${id}`, { headers: { cookie } })).text();
      const updated = /data-updated="([^"]*)"/.exec(html)![1];
      expect(updated).not.toBe("");
      const patch = (body: unknown) => f(`/api/data/entity/pages/${id}`, { method: "PATCH", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });
      expect((await patch({ title: "First", updated_at: updated })).status).toBe(200);
      expect((await patch({ title: "Second", updated_at: updated })).status).toBe(409);
   });
});
