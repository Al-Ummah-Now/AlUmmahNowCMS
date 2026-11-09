import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { CMS, cookiesOf, makeWorker, signIn } from "./helpers.ts";

type Post = { id: number; title: string; body: string | null; updated_at: string };
let cookie = "";
let f: ReturnType<typeof makeWorker>;
const headers = () => ({ cookie, origin: CMS, "content-type": "application/json" });

async function create(slug: string): Promise<Post> {
   const res = await f("/api/data/entity/posts", { method: "POST", headers: headers(), body: JSON.stringify({ slug, locale: "en", title: "Original", body: "old body" }) });
   expect(res.status).toBe(201);
   return ((await res.json()) as { data: Post }).data;
}

const patch = (id: number, body: Record<string, unknown>) =>
   f(`/api/data/entity/posts/${id}`, { method: "PATCH", headers: headers(), body: JSON.stringify(body) });

describe("optimistic lock on content updates (updated_at)", () => {
   beforeAll(async () => {
      const { callback } = await signIn(["Moderator"], { id: "lock-ed", email: "lock@example.com" });
      cookie = cookiesOf(callback);
      f = makeWorker();
   });

   it("two editors with the same stale form: the second save gets 409 and the first edit survives", async () => {
      const post = await create("two-editors");
      const a = await patch(post.id, { title: "Original", body: "fixed typo", updated_at: post.updated_at });
      expect(a.status).toBe(200);
      const b = await patch(post.id, { title: "New title", body: "old body", updated_at: post.updated_at });
      expect(b.status).toBe(409);
      expect(((await b.json()) as { error: string }).error).toMatch(/changed by someone else/);
      const row = await env.DB.prepare("SELECT title, body FROM posts WHERE id = ?1").bind(post.id).first();
      expect(row).toEqual({ title: "Original", body: "fixed typo" });
   });

   it("100 concurrent saves from the same stale version: exactly one wins, the row holds its data", async () => {
      const post = await create("concurrent");
      const N = 100;
      const out = await Promise.all(Array.from({ length: N }, (_, i) => patch(post.id, { title: `Title ${i}`, updated_at: post.updated_at })));
      const statuses = out.map((r) => r.status);
      expect(statuses.filter((s) => s === 200)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(N - 1);
      const winner = statuses.indexOf(200);
      const won = ((await out[winner].json()) as { data: Post }).data;
      const row = await env.DB.prepare("SELECT title, updated_at FROM posts WHERE id = ?1").bind(post.id).first<Post>();
      expect(row).toEqual({ title: `Title ${winner}`, updated_at: won.updated_at });
   });

   it("saving with the updated_at from the previous save works (sequential editing)", async () => {
      let post = await create("sequential");
      for (let i = 0; i < 5; i++) {
         const res = await patch(post.id, { title: `Step ${i}`, updated_at: post.updated_at });
         expect(res.status).toBe(200);
         post = ((await res.json()) as { data: Post }).data;
      }
      expect(post.title).toBe("Step 4");
   });

   it("an update without updated_at is unchanged (last writer wins, backwards compatible)", async () => {
      const post = await create("no-lock");
      expect((await patch(post.id, { title: "One" })).status).toBe(200);
      expect((await patch(post.id, { title: "Two" })).status).toBe(200);
      const row = await env.DB.prepare("SELECT title FROM posts WHERE id = ?1").bind(post.id).first();
      expect(row).toEqual({ title: "Two" });
   });

   it("an invalid locked save is rejected without moving updated_at", async () => {
      const res = await f("/api/data/entity/nav_items", {
         method: "POST",
         headers: headers(),
         body: JSON.stringify({ menu: "header", locale: "en", label: "A", url: "/a" }),
      });
      const nav = ((await res.json()) as { data: { id: number; updated_at: string } }).data;
      const bad = await f(`/api/data/entity/nav_items/${nav.id}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ url: "javascript:x", updated_at: nav.updated_at }) });
      expect(bad.status).toBeGreaterThanOrEqual(400);
      const ok = await f(`/api/data/entity/nav_items/${nav.id}`, { method: "PATCH", headers: headers(), body: JSON.stringify({ label: "B", updated_at: nav.updated_at }) });
      expect(ok.status).toBe(200);
   });
});
