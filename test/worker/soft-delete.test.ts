/** Admin soft delete, restore, "Delete permanently now" and the 30-day cleanup (docs/SOFT_DELETE.md). */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../../src/env.ts";
import { CLAIM_MS, daysLeft, listTrash, purgeDue, RETENTION_MS, restore, softDelete } from "../../src/lib/trash.ts";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

const ORIGIN = "https://cms.test";
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const E = env as unknown as Env;
const ADMIN = { id: 1, email: "admin@example.com" };

async function session(roles: string[], id: string) {
   const { callback } = await signIn(roles, { id, email: `${id}@example.com` });
   return cookiesOf(callback);
}

function client(cookie: string) {
   const f = makeWorker();
   const call = (method: string, path: string, body?: unknown) =>
      f(path, { method, headers: { cookie, origin: ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
   return { f, call };
}

async function createPost(call: ReturnType<typeof client>["call"], slug: string, entity = "posts"): Promise<number> {
   const r = await call("POST", `/api/data/entity/${entity}`, { slug, locale: "en", title: `Title ${slug}`, status: "published", ...(entity === "posts" ? { tags: [] } : {}) });
   expect(r.status).toBe(201);
   return ((await r.json()) as { data: { id: number } }).data.id;
}

async function uploadCover(f: ReturnType<typeof makeWorker>, cookie: string, entity: string, id: number): Promise<string> {
   const fd = new FormData();
   fd.append("file", new File([PNG], "cover.png", { type: "image/png" }));
   const r = await f(`/api/media/entity/${entity}/${id}/cover?overwrite=true`, { method: "POST", headers: { cookie, origin: ORIGIN }, body: fd });
   expect(r.status).toBe(201);
   return ((await r.json()) as { result: { path: string } }).result.path;
}

const trashOf = (kind: string, id: number) => env.DB.prepare("SELECT * FROM trash WHERE kind = ?1 AND item_id = ?2").bind(kind, id).first<Record<string, unknown>>();
const dirty = async () => (await env.DB.prepare("SELECT item FROM feed_dirty").all<{ item: string }>()).results.map((r) => r.item);

beforeEach(async () => {
   await env.DB.batch(["trash", "trash_events", "feed_dirty"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

describe("admin delete is a soft delete", () => {
   it("a post leaves every public reader at once, with its cover; history and files stay; restore brings it all back", async () => {
      const cookie = await session(["Admin"], "sd-admin");
      const { f, call } = client(cookie);
      const slug = `sd-${Date.now()}`;
      const id = await createPost(call, slug);
      const cover = await uploadCover(f, cookie, "posts", id);
      expect((await f(`/api/public/v1/posts/${slug}?locale=en`)).status).toBe(200);
      await env.DB.prepare("DELETE FROM feed_dirty").run();

      const del = await call("DELETE", `/api/data/entity/posts/${id}`, { reason: "Duplicate of another post" });
      expect(del.status).toBe(200);
      expect(await del.json()).toMatchObject({ data: { id, deleted: "soft" } });
      // Hidden: gone from its table, the public API (post, list), the cover's media route; the timeline rebuilds.
      expect(await env.DB.prepare("SELECT 1 FROM posts WHERE id = ?1").bind(id).first()).toBeNull();
      expect((await f(`/api/public/v1/posts/${slug}?locale=en`)).status).toBe(404);
      expect(JSON.stringify(await (await f("/api/public/v1/posts?locale=en")).json())).not.toContain(slug);
      expect((await f(`/api/public/v1/media/${cover}`)).status).toBe(404);
      expect(await dirty()).toContain(`p${id}`);
      // Hidden from the staff list too (bknd reads the live table).
      expect(await (await f("/posts", { headers: { cookie } })).text()).not.toContain(`Title ${slug}`);
      // Kept: the row (as JSON) with who/when/why, the cover's file, the content history.
      const t = await trashOf("posts", id);
      expect(t).toMatchObject({ deleted_by: "sd-admin@example.com", reason: "Duplicate of another post", label: `Title ${slug}`, purge_requested_at: null });
      expect(await env.MEDIA.head(cover)).not.toBeNull();
      expect(await trashOf("media", Number((await env.DB.prepare("SELECT item_id FROM trash WHERE kind = 'media' AND ref = ?1").bind(cover).first<{ item_id: number }>())!.item_id))).toMatchObject({ parent_id: t!.id });
      const revs = await env.DB.prepare("SELECT count(*) AS n FROM content_revisions WHERE entity = 'posts' AND entity_id = ?1").bind(id).first<{ n: number }>();
      expect(revs!.n).toBeGreaterThan(0);

      // Recently deleted lists the post (not its cover separately), with days left.
      const listed = (await (await call("GET", "/admin/api/trash")).json()) as { data: { id: number; kind: string; days_left: number }[] };
      expect(listed.data).toHaveLength(1);
      expect(listed.data[0]).toMatchObject({ id: t!.id, kind: "posts", days_left: 30 });
      const screen = await (await f("/deleted", { headers: { cookie } })).text();
      expect(screen).toContain(`Title ${slug}`);
      expect(screen).toContain("30 days left");
      expect(screen).toContain("Duplicate of another post");
      expect(screen).toContain('id="trash-purge"');

      await env.DB.prepare("DELETE FROM feed_dirty").run();
      const back = await call("POST", `/admin/api/trash/${t!.id}/restore`);
      expect(back.status).toBe(200);
      expect((await f(`/api/public/v1/posts/${slug}?locale=en`)).status).toBe(200);
      expect((await f(`/api/public/v1/media/${cover}`)).status).toBe(200);
      expect(await dirty()).toContain(`p${id}`);
      expect((await env.DB.prepare("SELECT count(*) AS n FROM trash").first<{ n: number }>())!.n).toBe(0);
      const log = (await env.DB.prepare("SELECT action, kind, actor_email FROM trash_events ORDER BY id").all<{ action: string; kind: string; actor_email: string }>()).results;
      expect(log.filter((x) => x.kind === "posts").map((x) => x.action)).toEqual(["delete", "restore"]);
   });

   it("only admins delete, restore and purge; bulk deletes and other entities are refused", async () => {
      const admin = await session(["Admin"], "sd-admin2");
      const ed = await session(["Moderator"], "sd-ed");
      const a = client(admin);
      const e = client(ed);
      const id = await createPost(a.call, `sd2-${Date.now()}`);
      expect((await e.call("DELETE", `/api/data/entity/posts/${id}`)).status).toBe(403);
      expect((await a.f(`/api/data/entity/posts/${id}`, { method: "DELETE" })).status).toBe(403); // no Origin: CSRF check
      expect((await a.call("DELETE", "/api/data/entity/posts")).status).toBe(405);
      expect((await a.call("DELETE", "/api/data/entity/users/1")).status).toBe(405);
      expect((await a.call("DELETE", "/api/data/entity/posts/99999999")).status).toBe(404);
      expect((await a.call("DELETE", `/api/data/entity/posts/${id}`)).status).toBe(200);
      const t = await trashOf("posts", id);
      expect((await e.call("GET", "/admin/api/trash")).status).toBe(403);
      expect((await e.call("POST", `/admin/api/trash/${t!.id}/restore`)).status).toBe(403);
      expect((await e.call("POST", `/admin/api/trash/${t!.id}/purge`, { confirm: "purge" })).status).toBe(403);
      expect((await e.f("/deleted", { headers: { cookie: ed } })).status).toBe(403);
      expect(await (await e.f("/", { headers: { cookie: ed } })).text()).not.toContain('href="/deleted"');
      expect(await (await a.f("/", { headers: { cookie: admin } })).text()).toContain('href="/deleted"');
   });

   it("pages leave the sitemap; menu links leave the menu; site settings and videos are soft too", async () => {
      const cookie = await session(["Admin"], "sd-admin3");
      const { f, call } = client(cookie);
      const slug = `sdp-${Date.now()}`;
      const page = await createPost(call, slug, "pages");
      expect(await (await f("/api/public/v1/sitemap")).text()).toContain(slug);
      expect((await call("DELETE", `/api/data/entity/pages/${page}`)).status).toBe(200);
      expect(await (await f("/api/public/v1/sitemap")).text()).not.toContain(slug);
      expect((await f(`/api/public/v1/pages/${slug}?locale=en`)).status).toBe(404);

      const nav = await call("POST", "/api/data/entity/nav_items", { menu: "header", locale: "en", label: `Gone ${slug}`, url: "/gone", sort: 1, status: "published" });
      const navId = ((await nav.json()) as { data: { id: number } }).data.id;
      expect(JSON.stringify(await (await f("/api/public/v1/site?locale=en")).json())).toContain(`Gone ${slug}`);
      expect((await call("DELETE", `/api/data/entity/nav_items/${navId}`)).status).toBe(200);
      expect(JSON.stringify(await (await f("/api/public/v1/site?locale=en")).json())).not.toContain(`Gone ${slug}`);
      expect(await trashOf("nav_items", navId)).toMatchObject({ label: `Gone ${slug}` });
   });

   it("a restore whose slug was taken meanwhile is refused (409) and stays in the trash", async () => {
      const cookie = await session(["Admin"], "sd-admin4");
      const { call } = client(cookie);
      const slug = `sdc-${Date.now()}`;
      const id = await createPost(call, slug);
      expect((await call("DELETE", `/api/data/entity/posts/${id}`)).status).toBe(200);
      await createPost(call, slug);
      const t = await trashOf("posts", id);
      const r = await call("POST", `/admin/api/trash/${t!.id}/restore`);
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ error: "conflict" });
      expect(await trashOf("posts", id)).not.toBeNull();
   });

   it("a home timeline video entry is soft-deleted from the Timeline screen and comes back on restore", async () => {
      const cookie = await session(["Admin"], "sd-admin5");
      const { call } = client(cookie);
      const at = new Date().toISOString();
      const row = await env.DB.prepare(
         "INSERT INTO timeline_entries (kind, video_kind, ref_id, locale, entry_date, hidden, created_at, updated_at) VALUES ('video', 'video', ?1, 'all', ?2, 0, ?2, ?2) RETURNING id",
      )
         .bind(`sd-v-${Date.now()}`, at)
         .first<{ id: number }>();
      expect((await call("DELETE", `/admin/api/timeline/entries/v${row!.id}`, { reason: "Wrong video" })).status).toBe(200);
      expect(await env.DB.prepare("SELECT 1 FROM timeline_entries WHERE id = ?1").bind(row!.id).first()).toBeNull();
      expect(await dirty()).toContain(`v${row!.id}`);
      const t = await trashOf("timeline_entries", row!.id);
      expect(t).toMatchObject({ reason: "Wrong video", ref: `v${row!.id}` });
      await env.DB.prepare("DELETE FROM feed_dirty").run();
      await restore(E, Number(t!.id), ADMIN);
      expect(await env.DB.prepare("SELECT 1 FROM timeline_entries WHERE id = ?1").bind(row!.id).first()).not.toBeNull();
      expect(await dirty()).toContain(`v${row!.id}`);
   });
});

describe("Delete permanently now and the cleanup (the only hard delete)", () => {
   it("promote needs the typed confirmation, only queues the item (still restorable), and the cleanup purges it with its files and history", async () => {
      const cookie = await session(["Admin"], "sd-admin6");
      const { f, call } = client(cookie);
      const slug = `sdq-${Date.now()}`;
      const id = await createPost(call, slug);
      const cover = await uploadCover(f, cookie, "posts", id);
      expect((await call("DELETE", `/api/data/entity/posts/${id}`)).status).toBe(200);
      const t = await trashOf("posts", id);
      expect((await call("POST", `/admin/api/trash/${t!.id}/purge`, {})).status).toBe(400);
      const q = await call("POST", `/admin/api/trash/${t!.id}/purge`, { confirm: "purge" });
      expect(q.status).toBe(202);
      // Not deleted yet: listed as queued, file still there, restorable.
      expect(await env.MEDIA.head(cover)).not.toBeNull();
      const listed = (await listTrash(env.DB)).items;
      expect(listed[0]).toMatchObject({ id: t!.id, days_left: null, purge_requested_by: "sd-admin6@example.com" });
      expect(await (await f("/deleted", { headers: { cookie } })).text()).toContain("Queued for permanent deletion");

      const res = await purgeDue(E);
      expect(res.purged).toEqual({ posts: 1 });
      expect(res.failed).toEqual({});
      expect(await trashOf("posts", id)).toBeNull();
      expect(await env.DB.prepare("SELECT count(*) AS n FROM trash").first<{ n: number }>()).toEqual({ n: 0 });
      expect(await env.MEDIA.head(cover)).toBeNull();
      expect(await env.DB.prepare("SELECT 1 FROM content_revisions WHERE entity = 'posts' AND entity_id = ?1").bind(id).first()).toBeNull();
      const log = (await env.DB.prepare("SELECT action, kind FROM trash_events ORDER BY id").all<{ action: string; kind: string }>()).results.map((x) => `${x.kind}:${x.action}`);
      expect(log).toEqual(expect.arrayContaining(["posts:delete", "posts:purge_requested", "posts:purged", "media:purged"]));
      // Idempotent: nothing left to do.
      expect((await purgeDue(E)).purged).toEqual({});
   });

   it("purges only items past 30 days or queued, oldest first, bounded per run", async () => {
      const now = Date.now();
      const ids: number[] = [];
      for (let i = 0; i < 4; i++) {
         const r = await env.DB.prepare("INSERT INTO nav_items (menu, locale, label, url, sort, status) VALUES ('footer', 'en', ?1, '/x', 0, 'published') RETURNING id").bind(`n${i}`).first<{ id: number }>();
         ids.push(r!.id);
         await softDelete(E, "nav_items", r!.id, ADMIN);
      }
      const age = (id: number, ms: number) => env.DB.prepare("UPDATE trash SET deleted_at = ?2 WHERE kind = 'nav_items' AND item_id = ?1").bind(id, new Date(now - ms).toISOString()).run();
      await age(ids[0], RETENTION_MS + 60_000); // expired
      await age(ids[1], RETENTION_MS + 120_000); // expired, older
      await age(ids[2], RETENTION_MS - 60_000); // 1 minute to go
      expect(daysLeft(new Date(now - RETENTION_MS + 60_000).toISOString(), now)).toBe(1);
      const first = await purgeDue(E, now, 1);
      expect(first).toMatchObject({ purged: { nav_items: 1 }, remaining: true });
      expect(await trashOf("nav_items", ids[1])).toBeNull(); // the oldest went first
      const second = await purgeDue(E, now, 10);
      expect(second.purged).toEqual({ nav_items: 1 });
      expect(await trashOf("nav_items", ids[0])).toBeNull();
      expect(await trashOf("nav_items", ids[2])).not.toBeNull();
      expect(await trashOf("nav_items", ids[3])).not.toBeNull();
      // A minute later the third is due too.
      expect((await purgeDue(E, now + 120_000, 10)).purged).toEqual({ nav_items: 1 });
   });

   it("a failed purge keeps the item, records the error and retries next run; a claimed item can't be restored", async () => {
      await env.MEDIA.put("sd-fail.png", PNG);
      const m = await env.DB.prepare("INSERT INTO media (path, mime_type, size) VALUES ('sd-fail.png', 'image/png', 10) RETURNING id").first<{ id: number }>();
      const trashId = await softDelete(E, "media", m!.id, ADMIN);
      await env.DB.prepare("UPDATE trash SET purge_requested_at = ?2 WHERE id = ?1").bind(trashId, new Date().toISOString()).run();
      const broken = {
         ...E,
         MEDIA: {
            ...E.MEDIA,
            delete: async () => {
               throw new Error("R2 down");
            },
            list: E.MEDIA.list.bind(E.MEDIA),
         } as unknown as R2Bucket,
      };
      const r = await purgeDue(broken);
      expect(r).toMatchObject({ purged: {}, failed: { media: 1 } });
      const kept = await env.DB.prepare("SELECT purge_attempts, purge_error, purging_at FROM trash WHERE id = ?1").bind(trashId).first();
      expect(kept).toMatchObject({ purge_attempts: 1, purging_at: null });
      expect(String((kept as { purge_error: string }).purge_error)).toContain("R2 down");
      expect(await env.MEDIA.head("sd-fail.png")).not.toBeNull();

      // Claimed by a running cleanup: restore refuses (409 purging); a stale claim is taken over.
      await env.DB.prepare("UPDATE trash SET purging_at = ?2 WHERE id = ?1").bind(trashId, new Date().toISOString()).run();
      await expect(restore(E, trashId, ADMIN)).rejects.toMatchObject({ status: 409, code: "purging" });
      expect((await purgeDue(E)).purged).toEqual({}); // claimed: skipped
      await env.DB.prepare("UPDATE trash SET purging_at = ?2 WHERE id = ?1").bind(trashId, new Date(Date.now() - CLAIM_MS - 1000).toISOString()).run();
      expect((await purgeDue(E)).purged).toEqual({ media: 1 });
      expect(await env.MEDIA.head("sd-fail.png")).toBeNull();
   });
});
