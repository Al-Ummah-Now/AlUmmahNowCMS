import { Hono } from "hono";
import { subOfUser } from "../lib/scholars/ownership.ts";
import { scholarOfSub } from "../lib/scholars/profiles.ts";
import { internalKey } from "../lib/scholars/videos-internal.ts";
import { trimSlash } from "../env.ts";
import type { AppEnv, Deps } from "../types.ts";

export function cardsApi(deps: Pick<Deps, "fetch">) {
   const r = new Hono<AppEnv>();
   r.all("/:action", async (c) => {
      c.header("Cache-Control", "private, no-store");
      const action = c.req.param("action");
      const get = c.req.method === "GET";
      if (get ? !["availability", "status"].includes(action) : c.req.method !== "POST" || !["preview", "publish"].includes(action)) return c.notFound();
      const sub = await subOfUser(c.env.DB, c.get("user").id);
      const scholar = await scholarOfSub(c.env.DB, sub);
      if (!sub || !scholar?.primary_channel_id) return action === "availability" ? c.json({ enabled: false }) : c.notFound();
      const key = await internalKey(c.env);
      if (!key) return action === "availability" ? c.json({ enabled: false }) : c.json({ error: "unavailable" }, 503);
      const jobId = c.req.query("job");
      if (action === "status" && !/^[a-f0-9-]{36}$/i.test(jobId ?? "")) return c.notFound();
      const path = action === "status" ? `jobs/${encodeURIComponent(jobId!)}` : action;
      const body = get ? undefined : await c.req.text();
      if (body && body.length > 8000) return c.json({ error: "invalid_request" }, 413);
      try {
         const segments = [sub, scholar.primary_channel_id].map(encodeURIComponent).join("/");
         const response = await deps.fetch(`${trimSlash(c.env.VIDEOS_API_URL)}/internal/scholar-cards/${segments}/${path}`, {
            method: c.req.method, body,
            headers: { "X-API-Key": key, ...(get ? {} : { "Content-Type": "application/json" }) },
            signal: AbortSignal.timeout(75_000),
         });
         return new Response(response.body, { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "private, no-store" } });
      } catch {
         return c.json({ error: "unavailable" }, 503);
      }
   });
   return r;
}
