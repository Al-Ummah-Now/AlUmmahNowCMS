/**
 * Issue #50: a write that breaks a content rule answers a 4xx with a message, never a 500.
 * The (slug, locale) pair of a page or post is unique (migrations/0001); a second row with the same
 * pair used to reach D1's UNIQUE index and come back as an opaque 500.
 */
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { CMS, cookiesOf, makeWorker, signIn } from "./helpers.ts";

let cookie = "";
let f: ReturnType<typeof makeWorker>;

const send = (method: string, path: string, body: unknown) =>
   f(path, { method, headers: { cookie, origin: CMS, accept: "application/json", "content-type": "application/json" }, body: JSON.stringify(body) });
const message = async (res: Response) => JSON.stringify(await res.json());

describe("content-rule failures through the data API", () => {
   beforeAll(async () => {
      const { callback } = await signIn(["Moderator"], { id: "conflict-ed", email: "conflict@example.com" });
      cookie = cookiesOf(callback);
      f = makeWorker();
   });

   it("a second page with the same slug and locale is a 409 with a message, and nothing is written", async () => {
      const page = { slug: "dup-page", locale: "en", title: "One", body: "## Draft heading\n\nOnly in the draft.", status: "draft" };
      expect((await send("POST", "/api/data/entity/pages", page)).status).toBe(201);
      const again = await send("POST", "/api/data/entity/pages", { ...page, title: "Two" });
      expect(again.status).toBe(409);
      expect(await message(again)).toMatch(/already a page with the slug \\"dup-page\\" in English/);
      const rows = await env.DB.prepare("SELECT title FROM pages WHERE slug = 'dup-page'").all();
      expect(rows.results).toEqual([{ title: "One" }]);
   });

   it("the same slug in the other language is fine", async () => {
      const page = { slug: "dup-both", title: "One", body: "x", status: "draft" };
      expect((await send("POST", "/api/data/entity/pages", { ...page, locale: "en" })).status).toBe(201);
      expect((await send("POST", "/api/data/entity/pages", { ...page, locale: "ar" })).status).toBe(201);
   });

   it("renaming a page onto a taken slug is a 409; saving a page under its own slug is not", async () => {
      const a = await send("POST", "/api/data/entity/pages", { slug: "rename-a", locale: "en", title: "A", status: "draft" });
      const b = await send("POST", "/api/data/entity/pages", { slug: "rename-b", locale: "en", title: "B", status: "draft" });
      const idA = ((await a.json()) as { data: { id: number } }).data.id;
      const idB = ((await b.json()) as { data: { id: number } }).data.id;
      const clash = await send("PATCH", `/api/data/entity/pages/${idB}`, { slug: "rename-a" });
      expect(clash.status).toBe(409);
      expect(await message(clash)).toMatch(/rename-a/);
      expect((await send("PATCH", `/api/data/entity/pages/${idA}`, { slug: "rename-a", title: "A2" })).status).toBe(200);
      // Moving b to the other language where the slug is free also works.
      expect((await send("PATCH", `/api/data/entity/pages/${idB}`, { slug: "rename-a", locale: "ar" })).status).toBe(200);
   });

   it("posts: a duplicate slug and locale is a 409 too", async () => {
      const post = { slug: "dup-post", locale: "ar", title: "One", body: "x" };
      expect((await send("POST", "/api/data/entity/posts", post)).status).toBe(201);
      const again = await send("POST", "/api/data/entity/posts", post);
      expect(again.status).toBe(409);
      expect(await message(again)).toMatch(/already a post with the slug \\"dup-post\\" in Arabic/);
   });

   it("concurrent creates of the same pair: one 201, every other one a 409, never a 500", async () => {
      const page = { slug: "dup-race", locale: "en", title: "Race", body: "x", status: "draft" };
      const out = await Promise.all(Array.from({ length: 10 }, () => send("POST", "/api/data/entity/pages", page)));
      const statuses = out.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(9);
      // The same body whether the content rule or the UNIQUE-index backstop caught it.
      for (const res of out.filter((r) => r.status === 409)) expect(await res.json()).toEqual({ error: 'There is already a page with the slug "dup-race" in English. Choose another slug.', type: "SlugTakenError" });
      const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM pages WHERE slug = 'dup-race'").first();
      expect(rows).toEqual({ n: 1 });
   });

   it("other content rules answer 400 with their message", async () => {
      const home = await send("POST", "/api/data/entity/pages", { slug: "home", locale: "en", title: "Home" });
      expect(home.status).toBe(400);
      expect(await message(home)).toMatch(/reserved/);
      const blocks = await send("POST", "/api/data/entity/pages", { slug: "bad-blocks", locale: "en", title: "B", blocks: [{ id: "x", type: "nope" }] });
      expect(blocks.status).toBe(400);
   });
});
