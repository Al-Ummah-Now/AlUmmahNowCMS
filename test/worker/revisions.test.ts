/**
 * Content history (#8): every create/update of a page or post writes a revision (who, when, full
 * row, changed fields); the History screen lists and diffs them; restore is a locked update that is
 * itself recorded. Writes go through bknd's data API exactly as the editor sends them.
 */
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { CMS, cookiesOf, makeWorker, signIn } from "./helpers.ts";

type Row = Record<string, unknown> & { id: number; updated_at: string };
let editor = "";
let admin = "";
let f: ReturnType<typeof makeWorker>;
const json = { "content-type": "application/json" };

async function send(cookie: string, method: string, path: string, body?: unknown) {
   return f(path, { method, headers: { cookie, origin: CMS, ...json }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function ok(cookie: string, method: string, path: string, body?: unknown): Promise<Row> {
   const res = await send(cookie, method, path, body);
   expect(res.status, `${method} ${path}: ${await res.clone().text()}`).toBeLessThan(300);
   return ((await res.json()) as { data: Row }).data;
}
const revisions = async (entity: string, id: number) =>
   (await env.DB.prepare("SELECT * FROM content_revisions WHERE entity = ?1 AND entity_id = ?2 ORDER BY version").bind(entity, id).all<Record<string, unknown>>()).results;

describe("content history", () => {
   beforeAll(async () => {
      editor = cookiesOf((await signIn(["Moderator"], { id: "rev-ed", email: "rev-editor@example.com" })).callback);
      admin = cookiesOf((await signIn(["Admin"], { id: "rev-admin", email: "rev-admin@example.com" })).callback);
      f = makeWorker();
   });

   it("create and every update write a revision: who, when, full row, changed fields", async () => {
      let post = await ok(editor, "POST", "/api/data/entity/posts", { slug: "rev-a", locale: "en", title: "First", body: "one\ntwo", tags: ["a"], status: "draft" });
      post = await ok(editor, "PATCH", `/api/data/entity/posts/${post.id}`, { title: "Second", body: "one\nTWO\nthree", updated_at: post.updated_at });
      post = await ok(admin, "PATCH", `/api/data/entity/posts/${post.id}`, { status: "published", updated_at: post.updated_at });
      const revs = await revisions("posts", post.id);
      expect(revs.map((r) => [r.version, r.action, r.actor_email])).toEqual([
         [1, "create", "rev-editor@example.com"],
         [2, "update", "rev-editor@example.com"],
         [3, "update", "rev-admin@example.com"],
      ]);
      expect(JSON.parse(String(revs[1].changed))).toEqual(["body", "title"]);
      expect(JSON.parse(String(revs[2].changed))).toEqual(["published_at", "status"]);
      const snap = JSON.parse(String(revs[2].snapshot));
      expect(snap).toMatchObject({ id: post.id, slug: "rev-a", title: "Second", body: "one\nTWO\nthree", status: "published", updated_at: post.updated_at });
      expect(Date.parse(String(revs[0].created_at))).toBeGreaterThan(0);
   });

   it("the History screen lists versions and shows a line diff; the editor links to it (en, ar/RTL)", async () => {
      let page = await ok(editor, "POST", "/api/data/entity/pages", { slug: "rev-page", locale: "ar", title: "عنوان", body: "سطر أول\nسطر ثان", status: "draft" });
      page = await ok(editor, "PATCH", `/api/data/entity/pages/${page.id}`, { body: "سطر أول\nسطر جديد", updated_at: page.updated_at });
      const html = await (await f(`/pages/${page.id}/history?lang=ar`, { headers: { cookie: editor } })).text();
      expect(html).toContain('dir="rtl"');
      expect(html).toContain("النسخة 2");
      expect(html).toContain("<del>سطر ثان</del>");
      expect(html).toContain("<ins>سطر جديد</ins>");
      expect(html).toContain("هذه هي النسخة الحالية.");
      expect(html).toContain("rev-editor@example.com");
      const revs = await revisions("pages", page.id);
      const v1 = await (await f(`/pages/${page.id}/history?lang=en&rev=${revs[0].id}`, { headers: { cookie: editor } })).text();
      expect(v1).toContain("The first version");
      expect(v1).toContain(`data-restore="${revs[0].id}"`);
      const ed = await (await f(`/pages/${page.id}?lang=en`, { headers: { cookie: editor } })).text();
      expect(ed).toContain("data-history-card");
      expect(ed).toContain(`href="/pages/${page.id}/history"`);
      expect(ed).toContain("See all 2 versions");
      // Another row's revision id is not shown on this row's history.
      const other = await ok(editor, "POST", "/api/data/entity/pages", { slug: "rev-other", locale: "en", title: "Other" });
      const foreign = (await revisions("pages", other.id))[0].id;
      const wrong = await (await f(`/pages/${page.id}/history?rev=${foreign}`, { headers: { cookie: editor } })).text();
      expect(wrong).not.toContain(`data-revision="${foreign}"`);
      expect((await f("/pages/999999/history", { headers: { cookie: editor } })).status).toBe(404);
   });

   it("restore: back to an old version through the lock, recorded as a restore; status stays", async () => {
      let post = await ok(editor, "POST", "/api/data/entity/posts", { slug: "rev-r", locale: "en", title: "Old title", body: "old", tags: ["x"], status: "draft" });
      post = await ok(editor, "PATCH", `/api/data/entity/posts/${post.id}`, { title: "New title", body: "new", tags: [], status: "published", updated_at: post.updated_at });
      const [v1] = await revisions("posts", post.id);
      const stale = await send(editor, "POST", `/admin/api/revisions/${v1.id}/restore`, { updated_at: "2026-01-01T00:00:00.000Z" });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toEqual({ error: "conflict" });
      expect(await revisions("posts", post.id)).toHaveLength(2);
      const res = await send(editor, "POST", `/admin/api/revisions/${v1.id}/restore`, { updated_at: post.updated_at });
      expect(res.status).toBe(200);
      const row = await env.DB.prepare("SELECT title, body, tags, status FROM posts WHERE id = ?1").bind(post.id).first();
      expect(row).toEqual({ title: "Old title", body: "old", tags: '["x"]', status: "published" });
      const revs = await revisions("posts", post.id);
      expect(revs.at(-1)).toMatchObject({ version: 3, action: "restore", restored_from: v1.id, actor_email: "rev-editor@example.com" });
      // The restore shows on the history with a link to its source.
      const html = await (await f(`/posts/${post.id}/history?lang=en`, { headers: { cookie: editor } })).text();
      expect(html).toContain("Restored from version 1");
   });

   it("restore refuses: taken address, no session, cross-origin, missing revision", async () => {
      await ok(editor, "POST", "/api/data/entity/pages", { slug: "taken", locale: "en", title: "Taken" });
      let page = await ok(editor, "POST", "/api/data/entity/pages", { slug: "rev-slug", locale: "en", title: "S" });
      page = await ok(editor, "PATCH", `/api/data/entity/pages/${page.id}`, { slug: "rev-slug-2", updated_at: page.updated_at });
      // Make version 1's address taken by someone else, then restore it.
      const [v1] = await revisions("pages", page.id);
      await env.DB.prepare("UPDATE pages SET slug = 'rev-slug' WHERE slug = 'taken'").run();
      const taken = await send(editor, "POST", `/admin/api/revisions/${v1.id}/restore`, { updated_at: page.updated_at });
      expect(taken.status).toBe(409);
      expect(await taken.json()).toEqual({ error: "slug_taken" });
      expect((await f(`/admin/api/revisions/${v1.id}/restore`, { method: "POST", headers: { origin: CMS, ...json }, body: "{}" })).status).toBe(401);
      expect((await f(`/admin/api/revisions/${v1.id}/restore`, { method: "POST", headers: { cookie: editor, origin: "https://evil.example", ...json }, body: JSON.stringify({ updated_at: page.updated_at }) })).status).toBe(403);
      expect((await send(editor, "POST", "/admin/api/revisions/99999999/restore", { updated_at: page.updated_at })).status).toBe(404);
      expect((await send(editor, "POST", `/admin/api/revisions/${v1.id}/restore`, {})).status).toBe(400);
   });

   it("history can't be read or written through bknd's data API, and bulk writes that skip it are refused", async () => {
      expect((await f("/api/data/entity/content_revisions", { headers: { cookie: admin } })).status).toBeGreaterThanOrEqual(400);
      expect((await send(admin, "PATCH", "/api/data/entity/pages", { update: { title: "x" }, where: { id: 1 } })).status).toBe(404);
      expect((await send(admin, "PATCH", "/api/data/entity/nav_items", { update: { label: "x" }, where: { id: 1 } })).status).toBe(404);
      const bulk = await send(admin, "POST", "/api/data/entity/posts", [{ slug: "bulk-1", locale: "en", title: "B" }]);
      expect(bulk.status).toBe(400);
      expect(await env.DB.prepare("SELECT id FROM posts WHERE slug = 'bulk-1'").first()).toBeNull();
   });

   it("all versions are kept; the list pages 20 at a time", async () => {
      let page = await ok(editor, "POST", "/api/data/entity/pages", { slug: "rev-many", locale: "en", title: "v0" });
      for (let i = 1; i <= 24; i++) page = await ok(editor, "PATCH", `/api/data/entity/pages/${page.id}`, { title: `v${i}`, updated_at: page.updated_at });
      expect(await revisions("pages", page.id)).toHaveLength(25);
      const p1 = await (await f(`/pages/${page.id}/history?lang=en`, { headers: { cookie: editor } })).text();
      expect(p1).toContain("Page 1 of 2");
      expect(p1).toContain('rel="next"');
      const p2 = await (await f(`/pages/${page.id}/history?lang=en&page=2`, { headers: { cookie: editor } })).text();
      expect(p2).toContain('<span class="rev-n">1</span>');
      expect(p2).not.toContain('<span class="rev-n">25</span>');
   });
});
