import { describe, expect, it } from "vitest";
import { cookiesOf, makeWorker, signIn } from "./helpers.ts";

const ORIGIN = "https://cms.test";

async function session(id: string) {
   const { callback } = await signIn(["Admin"], { id, email: `${id}@example.com` });
   return cookiesOf(callback);
}

/** The opening tag of the element with this id. */
function tagOf(html: string, id: string): string {
   const m = html.match(new RegExp(`<(?:input|textarea)[^>]*\\bid="${id}"[^>]*>`));
   expect(m, `#${id} is on the page`).not.toBeNull();
   return m![0];
}

describe("spell checking in the admin", () => {
   it("checks prose fields and never addresses or slugs", async () => {
      const cookie = await session("spell-admin");
      const f = makeWorker();
      const page = await (await f("/pages/new?locale=ar", { headers: { cookie } })).text();
      for (const id of ["f-title", "f-summary", "f-body", "f-seo-title", "f-seo-desc"]) {
         expect(tagOf(page, id), id).toContain('spellcheck="true"');
         expect(tagOf(page, id), id).toContain('lang="ar"');
      }
      expect(tagOf(page, "f-slug")).toContain('spellcheck="false"');
      expect(tagOf(page, "f-slug")).toContain('autocorrect="off"');
      const post = await (await f("/posts/new?locale=en", { headers: { cookie } })).text();
      expect(tagOf(post, "f-tag-input")).toContain('spellcheck="true"');

      const r = await f("/api/data/entity/nav_items", { method: "POST", headers: { cookie, origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ menu: "header", locale: "en", label: "About", url: "/about", sort: 10, status: "published" }) });
      expect(r.status).toBe(201);
      const { data } = (await r.json()) as { data: { id: number } };
      const nav = await (await f("/navigation?menu=header&locale=en", { headers: { cookie } })).text();
      expect(tagOf(nav, "new-label")).toContain('spellcheck="true"');
      expect(tagOf(nav, `nl-${data.id}`)).toContain('spellcheck="true"');
      for (const id of ["new-url", `nu-${data.id}`]) {
         expect(tagOf(nav, id), id).toContain('spellcheck="false"');
         expect(tagOf(nav, id), id).toContain('autocapitalize="off"');
      }

      const site = await (await f("/site?locale=en", { headers: { cookie } })).text();
      for (const id of ["s-title", "s-tagline", "s-hero-title", "s-hero-body"]) expect(tagOf(site, id), id).toContain('spellcheck="true"');
      const social = site.match(/<input[^>]*name="social_url"[^>]*>/g) ?? [];
      expect(social.length, "the social link template").toBeGreaterThan(0);
      for (const tag of social) expect(tag).toContain('spellcheck="false"');
   });
});
