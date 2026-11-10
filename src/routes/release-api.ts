/**
 * Server-to-server endpoints for the release pipeline (no session, no cookies, never cached).
 *
 *   POST /api/release/v1/feed-format   start the home timeline's format rebuild if the stored feed is in
 *                                  another format (src/lib/feed/auto-rebuild.ts); 202 + what it did
 *   GET  /api/release/v1/feed-format   the format stamp (code, heads, last full rebuild, rebuilding)
 *
 * Auth: `Authorization: Bearer <token>` where D1 system_tokens holds the token's SHA-256 for purpose
 * "feed-format", unexpired. Only someone who can write the env's D1 with Cloudflare credentials (the
 * release pipeline: scripts/release/feed-format.ts) can mint one, so this is exactly as privileged
 * as running a migration. The token is deleted by the pipeline afterwards and expires in 30 min.
 */
import { Hono, type Context } from "hono";
import type { Env } from "../env.ts";
import { ensureFeedFormat, feedFormatState } from "../lib/feed/auto-rebuild.ts";
import { bearer } from "../lib/preview.ts";

const PRIVATE_JSON = {
   "Cache-Control": "private, no-store",
   "X-Robots-Tag": "noindex, nofollow",
   "X-Content-Type-Options": "nosniff",
};

export const SYSTEM_TOKEN_PURPOSE = "feed-format";

async function sha256Hex(s: string): Promise<string> {
   const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
   return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A valid release-pipeline token for `purpose`? */
export async function systemTokenOk(env: Env, token: string | null, purpose: string, now = new Date()): Promise<boolean> {
   if (!token || token.length < 32 || token.length > 200) return false;
   const row = await env.DB.prepare("SELECT 1 AS ok FROM system_tokens WHERE token_hash = ?1 AND purpose = ?2 AND expires_at > ?3")
      .bind(await sha256Hex(token), purpose, now.toISOString())
      .first();
   return !!row;
}

export function releaseApi(): Hono<{ Bindings: Env }> {
   const api = new Hono<{ Bindings: Env }>();
   const gate = async (c: Context<{ Bindings: Env }>) => {
      // Expired rows are dropped on the way (the pipeline deletes its own; this catches a crash).
      await c.env.DB.prepare("DELETE FROM system_tokens WHERE expires_at <= ?1")
         .bind(new Date().toISOString())
         .run()
         .catch(() => {});
      return systemTokenOk(c.env, bearer(c.req.header("Authorization")), SYSTEM_TOKEN_PURPOSE);
   };

   api.get("/feed-format", async (c) => {
      if (!(await gate(c))) return c.json({ error: "unauthorized" }, 401, PRIVATE_JSON);
      return c.json({ data: await feedFormatState(c.env) }, 200, PRIVATE_JSON);
   });

   api.post("/feed-format", async (c) => {
      if (!(await gate(c))) return c.json({ error: "unauthorized" }, 401, PRIVATE_JSON);
      const result = await ensureFeedFormat(c.env, "release", { lock: false });
      return c.json({ data: { ...result, state: await feedFormatState(c.env) } }, 202, PRIVATE_JSON);
   });

   api.all("*", (c) => c.json({ error: "not_found" }, 404, PRIVATE_JSON));
   return api;
}
