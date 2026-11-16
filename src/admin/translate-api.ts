/**
 * Staff "Translate" for localized fields (docs/LOCALIZED_FIELDS.md). Mounted at /admin/api/translate,
 * behind the session gate and the same-origin check; admins and editors only.
 *
 *   POST /   { text, from: "en"|"ar", to: "en"|"ar" } → 200 { text }
 *            | 422 { error: "quran", quranUrl }       (never machine-translated: use the official text)
 *            | 429 { error: "rate_limited", retryAfter } | 429 { error: "daily_cap" }
 *            | 503 { error: "budget_reached" | "not_configured" | … }
 *
 * The answer only fills the form: the editor reviews it and saves through the field's own route.
 */
import { Hono } from "hono";
import type { AppEnv, Deps } from "../types.ts";
import { FIELD_TEXT_MAX, translateField } from "../lib/field-translate.ts";

const staff = (role?: string) => role === "admin" || role === "editor";

export function translateApi(deps?: Pick<Deps, "fetch">): Hono<AppEnv> {
   const r = new Hono<AppEnv>();
   r.post("/", async (c) => {
      const user = c.get("user");
      if (!staff(user?.role)) return c.json({ error: "forbidden" }, 403);
      const b = (await c.req.json().catch(() => null)) as { text?: unknown; from?: unknown; to?: unknown } | null;
      const text = typeof b?.text === "string" ? b.text.trim() : "";
      const from = b?.from;
      const to = b?.to;
      if ((from !== "en" && from !== "ar") || (to !== "en" && to !== "ar") || from === to) return c.json({ error: "bad_request" }, 400);
      if (!text) return c.json({ error: "empty" }, 400);
      if (text.length > FIELD_TEXT_MAX) return c.json({ error: "too_long" }, 413);
      const out = await translateField(c.env, { text, from, to, userId: Number(user.id) || null, deps: { fetch: deps?.fetch } });
      const noStore = { "Cache-Control": "no-store" };
      if (out.ok) return c.json({ text: out.text }, 200, noStore);
      if (out.code === "quran") return c.json({ error: "quran", quranUrl: (out as { quranUrl: string }).quranUrl }, 422, noStore);
      if (out.code === "rate_limited") return c.json({ error: "rate_limited", retryAfter: (out as { retryAfter: number }).retryAfter }, 429, noStore);
      if (out.code === "daily_cap") return c.json({ error: "daily_cap" }, 429, noStore);
      return c.json({ error: out.code }, 503, noStore);
   });
   return r;
}
