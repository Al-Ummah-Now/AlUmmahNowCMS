/**
 * /internal/refs/* — api-videos' reference outbox (docs/SCHOLARS.md §7; AlUmmahNow
 * apps/processor/src/handlers/scholar-refs.ts). Service-to-service only: `X-API-Key` must equal the
 * shared internal key (the CMS holds it as VIDEOS_INTERNAL_API_KEY, the same secret it uses to call
 * api-videos). No session, no CORS, never cached.
 *
 *   PUT    /internal/refs/:postId  { channelId, post }  → { status: 'ok', slug, locale, url, created } | { status: 'ignored' }
 *   DELETE /internal/refs/:postId?channelId=…           → { status: 'ok' | 'ignored' }
 *
 * `ignored`: the channel is no scholar's primary channel (most channels), or the post is a CMS article
 * mirror the conversion has not reached yet.
 */
import { Hono } from "hono";
import type { Env } from "../env.ts";
import { internalKey } from "../lib/scholars/videos-internal.ts";
import { ID_RE, parseRefBody, RefError, removeRef, upsertRef } from "../lib/scholars/refs.ts";
import { errText, log } from "../lib/log.ts";

/** Constant-time string comparison (equal lengths compared byte by byte). */
export function sameKey(a: string, b: string): boolean {
   const x = new TextEncoder().encode(a);
   const y = new TextEncoder().encode(b);
   let diff = x.length ^ y.length;
   for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
   return diff === 0;
}

export function internalRefsApi(): Hono<{ Bindings: Env }> {
   const api = new Hono<{ Bindings: Env }>();

   api.use("*", async (c, next) => {
      const expected = await internalKey(c.env);
      const given = c.req.header("X-API-Key") ?? "";
      if (!expected || !given || !sameKey(given, expected)) return c.json({ error: "unauthorized" }, 401, { "Cache-Control": "no-store" });
      await next();
      c.header("Cache-Control", "no-store");
   });

   api.put("/:postId", async (c) => {
      try {
         const { channelId, post } = parseRefBody(c.req.param("postId"), await c.req.json().catch(() => null));
         const out = await upsertRef(c.env, c.req.param("postId"), channelId, post);
         return c.json(out.status === "ok" ? { status: "ok", slug: out.slug, locale: out.locale, url: out.url, created: out.created } : out);
      } catch (error) {
         if (error instanceof RefError) return c.json({ error: error.code }, error.status);
         log.error("internal refs: upsert failed", { postId: c.req.param("postId"), error: errText(error) });
         return c.json({ error: "internal_error" }, 500);
      }
   });

   api.delete("/:postId", async (c) => {
      const channelId = c.req.query("channelId") ?? null;
      if (channelId !== null && !ID_RE.test(channelId)) return c.json({ error: "bad_request" }, 400);
      try {
         return c.json(await removeRef(c.env, c.req.param("postId"), channelId));
      } catch (error) {
         if (error instanceof RefError) return c.json({ error: error.code }, error.status);
         log.error("internal refs: remove failed", { postId: c.req.param("postId"), error: errText(error) });
         return c.json({ error: "internal_error" }, 500);
      }
   });

   return api;
}
