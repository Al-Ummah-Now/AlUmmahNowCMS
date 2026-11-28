/**
 * Injection security audit Worker integration tests (CMS-1 through CMS-14).
 * Exercises the full Hono/bknd Worker stack against real Miniflare D1 and R2:
 * upload magic bytes, R2 traversal, Content-Disposition, bknd query/operator injection,
 * AI settings SSRF/model validation, SQL LIKE escaping & bound liteItems,
 * translation-flag quranUrl validation, scholar ref link filtering, and open redirects.
 */
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { Env } from "../../src/env.ts";
import { liteItems } from "../../src/lib/feed/source.ts";
import { loadSettings, saveSettings, defaultSettings } from "../../src/lib/ai/settings.ts";
import { shapeA } from "../support/fake-http-providers.ts";
import { CMS, cookiesOf, makeWorker, signIn } from "./helpers.ts";

const E = env as unknown as Env;
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

let adminCookie = "";
let writerCookie = "";

beforeAll(async () => {
   const admin = await signIn(["Admin"], { id: "inj-admin", email: "inj-admin@example.com" });
   adminCookie = cookiesOf(admin.callback);
   const writer = await signIn(["Scholar"], { id: "inj-writer", email: "inj-writer@example.com" });
   writerCookie = cookiesOf(writer.callback);
});

describe("CMS-4, CMS-5, CMS-6: Upload magic bytes, R2 key traversal, and Content-Disposition", () => {
   it("rejects SVG/HTML disguised as PNG (multipart and raw) and rejects key traversal", async () => {
      const f = makeWorker();
      const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

      // Disguised SVG in raw upload
      const rawSpoof = await f("/api/media/upload/fake.png", {
         method: "POST",
         headers: { cookie: adminCookie, origin: CMS, "content-type": "image/png" },
         body: svgBytes,
      });
      expect(rawSpoof.status).toBe(415);

      // Disguised HTML in multipart upload
      const fd = new FormData();
      fd.append("file", new File(["<html><script>alert(1)</script></html>"], "fake.png", { type: "image/png" }));
      const mpSpoof = await f("/api/media/upload", {
         method: "POST",
         headers: { cookie: adminCookie, origin: CMS },
         body: fd,
      });
      expect(mpSpoof.status).toBe(415);

      // Key traversal on named upload
      const traversal = await f("/api/media/upload/..%2Fescape.png", {
         method: "POST",
         headers: { cookie: adminCookie, origin: CMS, "content-type": "image/png" },
         body: PNG,
      });
      expect(traversal.status).toBe(400);

      // Key traversal on variants retry endpoint
      const retryBad = await f("/admin/api/media/variants/retry", {
         method: "POST",
         headers: { cookie: adminCookie, origin: CMS, "content-type": "application/json" },
         body: JSON.stringify({ path: "../evil.png" }),
      });
      expect(retryBad.status).toBe(400);
   });

   it("serves valid uploads with sanitized Content-Disposition and sandbox CSP", async () => {
      const f = makeWorker();
      const up = await f("/api/media/upload/audit-safe.png", {
         method: "POST",
         headers: { cookie: adminCookie, origin: CMS, "content-type": "image/png" },
         body: PNG,
      });
      expect(up.status).toBe(201);
      const pub = await f("/api/public/v1/media/audit-safe.png");
      expect(pub.status).toBe(200);
      expect(pub.headers.get("Content-Type")).toBe("image/png");
      expect(pub.headers.get("Content-Disposition")).toBe('inline; filename="audit-safe.png"');
      expect(pub.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(pub.headers.get("Content-Security-Policy")).toContain("sandbox");
   });
});

describe("CMS-1 & CMS-2: AI settings SSRF & model validation in Worker", () => {
   it("rejects private/metadata URLs and invalid model ids on /admin/api/ai/settings/test", async () => {
      const f = makeWorker();
      const ssrf = await f("/admin/api/ai/settings/test", {
         method: "POST",
         headers: { cookie: adminCookie, origin: CMS, "content-type": "application/json" },
         body: JSON.stringify({ provider: shapeA({ url: "https://169.254.169.254/latest/meta-data/" }), model: "a-small" }),
      });
      expect(ssrf.status).toBe(400);

      const badModel = await f("/admin/api/ai/settings/test", {
         method: "POST",
         headers: { cookie: adminCookie, origin: CMS, "content-type": "application/json" },
         body: JSON.stringify({ provider: shapeA(), model: "../evil model" }),
      });
      expect(badModel.status).toBe(400);
      expect(await badModel.json()).toMatchObject({ error: "invalid", errors: expect.arrayContaining([{ path: "model", code: "invalid" }]) });

      // Stored loopback provider is rejected when loaded in non-local environment
      await env.DB.prepare("DELETE FROM ai_settings").run();
      await saveSettings(
         env.DB,
         { ...defaultSettings(), providers: [...defaultSettings().providers, shapeA({ url: "http://127.0.0.1:8788/v1/chat" })] },
         0,
         { id: 1, email: "inj-admin@example.com" },
         Date.now(),
         { local: true },
      );
      const nonLocal = await loadSettings(env.DB, { local: false });
      expect(nonLocal.settings.providers.map((p) => p.id)).toEqual(["workers-ai"]);
      await env.DB.prepare("DELETE FROM ai_settings").run();
   });
});

describe("CMS-7: bknd query operator injection & relation join blocking", () => {
   it("rejects relation joins, unknown operators, and scoped $or/count query smuggling", async () => {
      const f = makeWorker();
      const withJoin = await f("/api/data/entity/posts?with=users", { headers: { cookie: adminCookie } });
      expect(withJoin.status).toBe(400);

      const badOp = await f(`/api/data/entity/posts?where=${encodeURIComponent(JSON.stringify({ title: { $sql: "1=1" } }))}`, {
         headers: { cookie: adminCookie },
      });
      expect(badOp.status).toBe(400);

      const writerOr = await f(`/api/data/entity/posts?where=${encodeURIComponent(JSON.stringify({ $or: [{ id: 1 }] }))}`, {
         headers: { cookie: writerCookie },
      });
      expect(writerOr.status).toBe(400);

      const writerCountOr = await f("/api/data/entity/posts/fn/count", {
         method: "POST",
         headers: { cookie: writerCookie, origin: CMS, "content-type": "application/json" },
         body: JSON.stringify({ $or: [{ id: 1 }] }),
      });
      expect(writerCountOr.status).toBe(400);
   });
});

describe("CMS-10, CMS-11, CMS-13, CMS-14: Scholar ref links, quranUrl, LIKE escaping, liteItems, open redirect", () => {
   it("drops javascript: v2.link URLs in public post summaries", async () => {
      const at = new Date().toISOString();
      const summary = JSON.stringify({
         kind: "link",
         images: [],
         image_count: 0,
         video_id: null,
         link: { url: "javascript:alert(1)", title: "Bad", description: null, siteName: null, image: { url: "javascript:alert(2)" } },
         poll: null,
         quiz: null,
         gif: null,
         text: "hello",
         slide_count: 0,
         slides: [],
      });
      await env.DB.prepare(
         "INSERT INTO posts (slug, locale, title, body, status, published_at, kind, ref_post_id, ref_channel_id, summary_json, created_at, updated_at) VALUES ('inj-ref-link', 'en', 'Inj Ref', '', 'published', ?1, 'link', 'rp-inj', 'ch-inj', ?2, ?1, ?1)",
      )
         .bind(at, summary)
         .run();
      const f = makeWorker();
      const res = await f("/api/public/v1/posts?locale=en&limit=20");
      expect(res.status).toBe(200);
      const data = (await res.json()) as { items: { slug: string; v2?: { link: unknown } }[] };
      const item = data.items.find((i) => i.slug === "inj-ref-link");
      expect(item).toBeTruthy();
      expect(item?.v2?.link).toBeNull();
   });

   it("filters unsafe quran_url values in /admin/api/translation-flags", async () => {
      const at = new Date().toISOString();
      const post = await env.DB.prepare(
         "INSERT INTO posts (slug, locale, title, body, status, created_at, updated_at) VALUES ('inj-flag-post', 'en', 'Flag post', 'Some body text', 'draft', ?1, ?1) RETURNING id",
      )
         .bind(at)
         .first<{ id: number }>();
      await env.DB.prepare(
         `INSERT INTO translation_flags (id, kind, row_id, locale, field, quote, prefix, suffix, start_offset, end_offset, source_text, source_scope, reason, quran, quran_url, status, created_at, updated_at)
          VALUES ('inj-flag-1', 'posts', ?1, 'en', 'body', 'Some', '', ' body', 0, 4, 'src', 'body', 'quran_hadith', 1, 'javascript:alert(1)', 'open', 1000, 1000)`,
      )
         .bind(post!.id)
         .run();
      const f = makeWorker();
      const res = await f(`/admin/api/translation-flags?kind=posts&id=${post!.id}`, { headers: { cookie: adminCookie } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { flags: { id: string; quranUrl: string | null }[] };
      expect(body.flags.find((x) => x.id === "inj-flag-1")?.quranUrl).toBeNull();
   });

   it("escapes SQL LIKE wildcards in tags endpoints and binds post ids in liteItems", async () => {
      const at = new Date().toISOString();
      await env.DB.prepare(
         "INSERT INTO posts (slug, locale, title, body, status, published_at, tags, created_at, updated_at) VALUES ('inj-like-1', 'en', 'Like test', 'b', 'published', ?1, ?2, ?1, ?1)",
      )
         .bind(at, JSON.stringify(["100%_exact", "plain-tag"]))
         .run();
      const f = makeWorker();
      const listTags = await f("/admin/api/lists/tags?locale=en&q=%25_", { headers: { cookie: adminCookie } });
      expect(listTags.status).toBe(200);
      const tags1 = ((await listTags.json()) as { data: { items: { tag: string }[] } }).data.items.map((x) => x.tag);
      expect(tags1).toContain("100%_exact");
      expect(tags1).not.toContain("plain-tag");

      const sugTags = await f("/admin/api/suggest?kind=tags&locale=en&q=%25_", { headers: { cookie: adminCookie } });
      expect(sugTags.status).toBe(200);
      const tags2 = ((await sugTags.json()) as { items: { id: string }[] }).items.map((x) => x.id);
      expect(tags2).toContain("100%_exact");
      expect(tags2).not.toContain("plain-tag");

      // liteItems ignores non-integer values safely via bound params
      const rows = await liteItems(E, "en", { posts: ["1 OR 1=1" as unknown as number, -5] });
      expect(rows).toEqual([]);
   });

   it("sanitizes /auth/login?return= against external redirect URLs", async () => {
      const f = makeWorker();
      const res = await f("/auth/login?return=https://evil.example/phish");
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/sso/login?return=%2F");
   });
});
