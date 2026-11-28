import { Hono } from "hono";
import { mockUrl } from "../lib/ai/config.ts";
import { isTestAccount } from "../lib/slug-suggest.ts";
import { callQaf, normalQuery, searchBody } from "../lib/qaf/client.ts";
import { UUID } from "../lib/qaf/model.ts";
import { qafStatus, saveQafKey, sealQafKey } from "../lib/qaf/settings.ts";
import type { AppEnv, Ctx, Deps } from "../types.ts";

export function qafRoutes(deps: Pick<Deps, "fetch">) {
   const r = new Hono<AppEnv>();
   r.use("*", async (c, next) => {
      c.header("Cache-Control", "no-store");
      const user = c.get("user");
      if (user.role !== "admin" && user.role !== "editor") return c.json({ error: "forbidden" }, 403);
      return next();
   });

   const proxy = async (c: Ctx, op: Parameters<typeof callQaf>[1], retryCredential = false) => {
      if (c.env.ENVIRONMENT !== "local" && isTestAccount(c.get("user").email)) return c.json({ error: "not_configured" }, 503);
      const mock = mockUrl(c.env);
      const r = await callQaf({
         db: c.env.DB,
         secret: c.get("cfg").jwtSecret,
         base: mock ? `${mock}/qaf/v1` : "https://api.qaf.ai/v1",
         fetch: deps.fetch,
         retryCredential,
      }, op);
      if (r.requestId) c.header("X-Request-Id", r.requestId);
      if (r.ok) {
         if (r.cached) c.header("X-Qaf-Cache", "hit");
         return c.json(r.data);
      }
      if (r.retryAfter !== undefined) c.header("Retry-After", String(r.retryAfter));
      return c.json({ error: r.error, retryAfter: r.retryAfter }, r.status);
   };

   r.put("/settings", async (c) => {
      if (c.get("user").role !== "admin") return c.json({ error: "forbidden" }, 403);
      const b = await c.req.json<{ key?: unknown }>().catch(() => null);
      const key = b?.key;
      if (key !== null && (typeof key !== "string" || !/^qaf_sk_[A-Za-z0-9_-]{1,512}$/.test(key))) return c.json({ error: "validation" }, 422);
      await saveQafKey(c.env.DB, key === null ? null : await sealQafKey(c.get("cfg").jwtSecret, key));
      return c.json(await qafStatus(c.env.DB));
   });

   r.post("/settings/retry", async (c) => {
      if (c.get("user").role !== "admin") return c.json({ error: "forbidden" }, 403);
      return proxy(c, { path: "/catalog/lookup?type=author&query=Ibn%20Hajar" }, true);
   });

   r.post("/search", async (c) => {
      const body = searchBody(await c.req.json().catch(() => null));
      return body ? proxy(c, { search: body }) : c.json({ error: "validation" }, 422);
   });

   r.get("/catalog", async (c) => {
      const { type, query, locale = "en" } = c.req.query();
      if ((type !== "author" && type !== "book") || (locale !== "en" && locale !== "ar") || !query || query.length > 200 || !normalQuery(query)) return c.json({ error: "validation" }, 422);
      return proxy(c, { path: `/catalog/lookup?${new URLSearchParams({ type, query: normalQuery(query), locale })}` });
   });

   r.get("/passages/:id", async (c) => {
      const id = c.req.param("id");
      const { radius = "2", locale = "en" } = c.req.query();
      if (!UUID.test(id) || !/^[0-5]$/.test(radius) || (locale !== "en" && locale !== "ar")) return c.json({ error: "validation" }, 422);
      return proxy(c, { path: `/passages/${encodeURIComponent(id)}?${new URLSearchParams({ radius, locale })}` });
   });
   return r;
}
