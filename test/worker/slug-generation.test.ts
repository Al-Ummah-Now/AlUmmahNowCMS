/** Pages and posts created without a slug get one from the title (src/lib/content-rules.ts, src/lib/slug.ts). */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

const ORIGIN = "https://cms.test";

async function session(id: string) {
   const { callback } = await signIn(["Admin"], { id, email: `${id}@example.com` });
   return cookiesOf(callback);
}

async function create(f: ReturnType<typeof makeWorker>, cookie: string, entity: string, body: Record<string, unknown>): Promise<{ id: number; slug: string }> {
   const res = await f(`/api/data/entity/${entity}`, { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });
   expect(res.status, await res.clone().text()).toBe(201);
   return ((await res.json()) as { data: { id: number; slug: string } }).data;
}

describe("slug generation on create", () => {
   it("makes the slug from an Arabic title, numbered when taken", async () => {
      const cookie = await session("slug-gen");
      const f = makeWorker();
      const title = "إن الدين عند الله الإسلام";
      const a = await create(f, cookie, "posts", { locale: "ar", title });
      expect(a.slug).toBe("inna-al-din-inda-allah-al-islam");
      const b = await create(f, cookie, "posts", { locale: "ar", title, slug: "" });
      expect(b.slug).toBe("inna-al-din-inda-allah-al-islam-2");
      const c = await create(f, cookie, "posts", { locale: "ar", title, slug: null });
      expect(c.slug).toBe("inna-al-din-inda-allah-al-islam-3");
      // Unique per language: the English side has the base slug free.
      const en = await create(f, cookie, "posts", { locale: "en", title });
      expect(en.slug).toBe("inna-al-din-inda-allah-al-islam");
      // Unique per content type: a page may share a post's slug.
      const page = await create(f, cookie, "pages", { locale: "ar", title });
      expect(page.slug).toBe("inna-al-din-inda-allah-al-islam");
      const stored = await env.DB.prepare("SELECT slug FROM posts WHERE id = ?1").bind(b.id).first<{ slug: string }>();
      expect(stored?.slug).toBe(b.slug);
   });

   it("uses the translation's (English) slug when the row joins one", async () => {
      const cookie = await session("slug-gen-tr");
      const f = makeWorker();
      await create(f, cookie, "posts", { locale: "en", title: "Fasting in Shawwal", slug: "fasting-in-shawwal", translation_key: "k-shawwal" });
      const ar = await create(f, cookie, "posts", { locale: "ar", title: "صيام الست من شوال", translation_key: "k-shawwal" });
      expect(ar.slug).toBe("fasting-in-shawwal");
   });

   it("falls back to post / page when the title has no letters to use, and keeps a given slug", async () => {
      const cookie = await session("slug-gen-fb");
      const f = makeWorker();
      expect((await create(f, cookie, "posts", { locale: "en", title: "🌙" })).slug).toMatch(/^post(-\d+)?$/);
      expect((await create(f, cookie, "pages", { locale: "en", title: "🌙" })).slug).toMatch(/^page(-\d+)?$/);
      expect((await create(f, cookie, "posts", { locale: "en", title: "Anything", slug: "chosen-by-hand" })).slug).toBe("chosen-by-hand");
      // "home" is reserved for pages: a page titled Home gets another address.
      expect((await create(f, cookie, "pages", { locale: "en", title: "Home" })).slug).toBe("home-page");
   });

   it("locks a live row's address in the editor and leaves drafts editable", async () => {
      const cookie = await session("slug-gen-ui");
      const f = makeWorker();
      const live = await create(f, cookie, "posts", { locale: "en", title: "Live one", status: "published" });
      const draft = await create(f, cookie, "posts", { locale: "en", title: "Draft one" });
      const slugTag = (html: string) => html.match(/<input[^>]*id="f-slug"[^>]*>/)![0];
      const liveHtml = await (await f(`/posts/${live.id}`, { headers: { cookie } })).text();
      expect(slugTag(liveHtml)).toContain("readonly");
      expect(liveHtml).toContain("data-slug-unlock");
      expect(liveHtml).toContain("data-slug-regen");
      const draftHtml = await (await f(`/posts/${draft.id}`, { headers: { cookie } })).text();
      expect(slugTag(draftHtml)).not.toContain("readonly");
      expect(draftHtml).not.toContain("data-slug-unlock");
      const fresh = await (await f("/posts/new?locale=ar", { headers: { cookie } })).text();
      expect(slugTag(fresh)).toContain('data-auto-slug="1"');
      expect(slugTag(fresh)).toContain('value=""');
   });
});
