/**
 * Staff writers (auth "Writer" → CMS role staff_writer; owner decision SS18, 2026-11-13): they keep the
 * full CMS post editor for Al Ummah Now's own posts. Scholars (auth "Scholar") get "Write in Studio".
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

const ORIGIN = "https://cms.test";

async function as(roles: string[], id: string) {
   const { callback } = await signIn(roles, { id, email: `${id}@example.com` });
   const cookie = cookiesOf(callback);
   const w = makeWorker();
   const call = (method: string, path: string, body?: unknown) =>
      w(path, { method, headers: { cookie, origin: ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
   return { call, get: (path: string) => w(path, { headers: { cookie } }) };
}

describe("staff writers keep the CMS editor (SS18)", () => {
   it("write and edit Al Ummah Now's own posts; never a scholar's; no deletes, pages or editorial screens", async () => {
      const stamp = Date.now();
      // A scholar's post (and a reference) next to the staff ones
      const at = new Date().toISOString();
      const scholarPost = (await env.DB.prepare("INSERT INTO posts (slug, locale, title, body, status, kind, author_sub, created_at, updated_at) VALUES (?1, 'en', 'Scholar post', 'x', 'published', 'article', 'sch-sw', ?2, ?2) RETURNING id").bind(`sw-sch-${stamp}`, at).first<{ id: number }>())!.id;
      const sw = await as(["Writer"], `staff-writer-${stamp}`);
      expect((await env.DB.prepare("SELECT role FROM users WHERE email = ?1").bind(`staff-writer-${stamp}@example.com`).first<{ role: string }>())?.role).toBe("staff_writer");

      // Home is the posts list; the editor is theirs
      expect((await sw.get("/")).headers.get("location")).toBe("/posts");
      expect((await sw.get("/posts/new")).status).toBe(200);
      const created = await sw.call("POST", "/api/data/entity/posts", { slug: `sw-own-${stamp}`, locale: "en", title: "Staff post", status: "published", tags: [], author_sub: "sneaky", show_on_timeline: false });
      expect(created.status).toBe(201);
      const own = ((await created.json()) as { data: { id: number } }).data.id;
      expect(await env.DB.prepare("SELECT author_sub, show_on_timeline FROM posts WHERE id = ?1").bind(own).first()).toMatchObject({ author_sub: null });
      expect((await sw.call("PATCH", `/api/data/entity/posts/${own}`, { title: "Staff post, edited" })).status).toBe(200);
      const editor = await (await sw.get(`/posts/${own}`)).text();
      expect(editor).toContain("Staff post, edited");
      expect(editor).not.toContain('name="show_on_timeline"');

      // A scholar's post: not found, for reads, edits and the editor; and lists leave it out
      expect((await sw.call("GET", `/api/data/entity/posts/${scholarPost}`)).status).toBe(404);
      expect((await sw.call("PATCH", `/api/data/entity/posts/${scholarPost}`, { title: "hijack" })).status).toBe(404);
      expect((await sw.get(`/posts/${scholarPost}`)).status).toBe(404);
      const list = (await (await sw.call("GET", "/api/data/entity/posts?limit=100")).json()) as { data: { id: number }[] };
      expect(list.data.map((r) => r.id)).toContain(own);
      expect(list.data.map((r) => r.id)).not.toContain(scholarPost);

      // No deletes; nothing of editors'
      expect((await sw.call("DELETE", `/api/data/entity/posts/${own}`)).status).toBe(403);
      expect((await sw.call("POST", "/api/data/entity/pages", { slug: "x", locale: "en", title: "x" })).status).toBe(403);
      for (const path of ["/pages", "/timeline", "/featuring", "/navigation", "/site", "/scholars", "/write"]) {
         expect((await sw.get(path)).status, path).toBe(403);
      }
   });

   it("scholars still get Write in Studio, not the editor", async () => {
      const sch = await as(["Scholar"], `scholar-sw-${Date.now()}`);
      expect((await sch.get("/")).headers.get("location")).toBe("/write");
      expect((await sch.call("POST", "/api/data/entity/posts", { slug: "nope", locale: "en", title: "Nope" })).status).toBe(403);
   });
});
