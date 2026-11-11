/**
 * The search boxes' live suggestions (staff session, same-origin; src/index.ts gates /admin/api/*).
 *
 *   GET /admin/api/suggest?kind=content|pages|posts|scholars|scholar-posts&q=&locale=
 *     → { items: [{ kind, id, label, secondary, imageUrl, href, lang }] }
 *
 * Reads through bknd with the editor's own cookie (Data), so a suggestion never shows a row the
 * editor could not open, and it matches what the list's search matches (title or address, the same
 * AND-only branches as screens/content.tsx). A number matches that row's id first. Reads only: no
 * revision or log row.
 */
import { listLibrary } from "../lib/library.ts";
import { scopeWhere, subOfUser } from "../lib/scholars/ownership.ts";
import { listScholars, scholarName } from "../lib/scholars/profiles.ts";
import { articleCandidates } from "../lib/scholars/featuring.ts";
import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv, Deps } from "../types.ts";
import { publishState } from "../lib/schedule.ts";
import { Data, listUrl, type Row } from "./data.ts";
import { ADMIN_STRINGS } from "./i18n.ts";
import { LANG_COOKIE } from "./prefs.ts";
import { listWheres, type ContentKind } from "./screens/content.tsx";

type C = Context<AppEnv>;

export const SUGGEST_LIMIT = 8;
const MAX_QUERY = 100;
const SELECT = ["id", "title", "slug", "locale", "status", "publish_at", "updated_at"];

export interface SuggestItem {
   kind: ContentKind;
   id: string;
   label: string;
   secondary: string | null;
   imageUrl: string | null;
   href: string;
   lang: string | null;
}

const staff = (c: C) => {
   const role = c.get("user")?.role;
   return role === "admin" || role === "editor" || role === "writer";
};

export function suggestApi(deps: Deps): Hono<AppEnv> {
   const r = new Hono<AppEnv>();
   r.use("*", async (c, next) => (staff(c) ? next() : c.json({ error: "forbidden" }, 403)));

   r.get("/", async (c) => {
      const kind = c.req.query("kind") ?? "content";
      if (kind === "scholars" || kind === "scholar-posts") {
         // Scholars screen and the Featuring screen (staff only).
         if (c.get("user")?.role === "writer") return c.json({ error: "forbidden" }, 403);
         const q = (c.req.query("q") ?? "").trim().slice(0, MAX_QUERY);
         if (!q) return c.json({ items: [] }, 200, { "Cache-Control": "no-store" });
         const lang = getCookie(c, LANG_COOKIE) === "ar" ? "ar" : "en";
         const t = ADMIN_STRINGS[lang];
         if (kind === "scholars") {
            const { items } = await listScholars(c.env.DB, { q, limit: SUGGEST_LIMIT });
            return c.json(
               {
                  items: items.map((sch) => ({
                     kind: "scholars",
                     id: String(sch.id),
                     label: scholarName(sch, lang),
                     secondary: `/${sch.slug} · ${t.scholars.postsCount(sch.posts)}`,
                     imageUrl: null,
                     href: `/scholars/${sch.id}`,
                     lang: null,
                  })),
               },
               200,
               { "Cache-Control": "no-store" },
            );
         }
         const { items } = await articleCandidates(c.env, { q, limit: SUGGEST_LIMIT });
         return c.json(
            {
               items: items.map((a) => ({
                  kind: "posts",
                  id: String(a.id),
                  label: a.title || `#${a.id}`,
                  secondary: [a.scholar ? scholarName(a.scholar, lang) : null, a.featured_at ? t.featuring.featured : t.featuring.notFeatured, t.locales[a.locale]].filter(Boolean).join(" · "),
                  imageUrl: null,
                  href: `/posts/${a.id}`,
                  lang: a.locale,
               })),
            },
            200,
            { "Cache-Control": "no-store" },
         );
      }
      if (kind === "tags" || kind === "library") {
         // The filter editor's Tag field (opens with the most used tags) and the Videos screen's search.
         if (c.get("user")?.role === "writer") return c.json({ error: "forbidden" }, 403);
         const q = (c.req.query("q") ?? "").trim().slice(0, MAX_QUERY);
         const lang = getCookie(c, LANG_COOKIE) === "ar" ? "ar" : "en";
         const t = ADMIN_STRINGS[lang];
         if (kind === "tags") {
            const l = c.req.query("locale") === "ar" ? "ar" : "en";
            const { results } = await c.env.DB.prepare(
               `SELECT j.value AS tag, count(*) AS n FROM posts p, json_each(CASE WHEN json_valid(p.tags) THEN p.tags ELSE '[]' END) j
                WHERE p.locale = ?1 AND p.status = 'published' AND typeof(j.value) = 'text' AND (?2 = '' OR lower(j.value) LIKE '%' || lower(?2) || '%')
                GROUP BY j.value ORDER BY n DESC, j.value LIMIT ?3`,
            )
               .bind(l, q, SUGGEST_LIMIT)
               .all<{ tag: string; n: number }>();
            return c.json(
               { items: results.map((r) => ({ kind: "tags", id: r.tag, label: r.tag, secondary: t.pageList.tagCount(Number(r.n)), imageUrl: null, href: "", lang: l })) },
               200,
               { "Cache-Control": "no-store" },
            );
         }
         if (!q) return c.json({ items: [] }, 200, { "Cache-Control": "no-store" });
         const { items } = await listLibrary(c.env, { q });
         return c.json(
            {
               items: items.slice(0, SUGGEST_LIMIT).map((x) => ({
                  kind: "library",
                  id: String(x.id),
                  label: x.title,
                  secondary: [t.timeline[x.kind === "playlist" ? "kindPlaylist" : x.kind === "channel" ? "kindChannel" : "kindVideo"], x.channel].filter(Boolean).join(" · "),
                  imageUrl: x.thumb,
                  href: `/videos?q=${encodeURIComponent(x.title)}`,
                  lang: null,
               })),
            },
            200,
            { "Cache-Control": "no-store" },
         );
      }
      const writer = c.get("user")?.role === "writer";
      let kinds: ContentKind[] = kind === "pages" ? ["pages"] : kind === "posts" ? ["posts"] : kind === "content" ? ["pages", "posts"] : [];
      if (!kinds.length) return c.json({ error: "bad_request" }, 400);
      // A writer (auth "Scholar") only ever sees their own posts (docs/SCHOLARS.md §2).
      const sub = writer ? await subOfUser(c.env.DB, c.get("user").id) : null;
      if (writer) {
         kinds = kinds.filter((k) => k === "posts");
         if (!kinds.length || !sub) return c.json({ items: [] }, 200, { "Cache-Control": "no-store" });
      }
      const q = (c.req.query("q") ?? "").trim().slice(0, MAX_QUERY);
      if (!q) return c.json({ items: [] }, 200, { "Cache-Control": "no-store" });
      const l = c.req.query("locale");
      const locale = l === "en" || l === "ar" ? l : "";
      const saved = getCookie(c, LANG_COOKIE);
      const t = ADMIN_STRINGS[saved === "ar" ? "ar" : "en"];
      const data = new Data(c, deps);
      const now = Date.now();

      const perKind = await Promise.all(
         kinds.map(async (k) => {
            const branches = listWheres({ q, status: "", locale });
            if (/^[0-9]{1,12}$/.test(q)) branches.unshift({ where: { id: Number(q), ...(locale ? { locale } : {}) } });
            // data.get, not data.list: a suggestion needs no total (list() may count)
            const parts = await Promise.all(
               branches.map((b) => data.get<{ data: Row[] }>(listUrl(k, { limit: SUGGEST_LIMIT, sort: "-updated_at", where: sub ? scopeWhere(b.where, sub) : b.where, select: SELECT }))),
            );
            const seen = new Map<string, Row>();
            for (const row of parts.flatMap((p) => p.data)) if (!seen.has(String(row.id))) seen.set(String(row.id), row);
            return [...seen.values()].map((row) => ({ k, row }));
         }),
      );

      const items: SuggestItem[] = perKind
         .flat()
         .sort((a, b) => Number(String(b.row.id) === q) - Number(String(a.row.id) === q) || String(b.row.updated_at ?? "").localeCompare(String(a.row.updated_at ?? "")))
         .slice(0, SUGGEST_LIMIT)
         .map(({ k, row }) => {
            const lang = row.locale === "ar" || row.locale === "en" ? (row.locale as "ar" | "en") : null;
            const parts = [t.entities[k].one, t.status[publishState(row, now)], lang ? t.locales[lang] : null, row.slug ? `/${String(row.slug)}` : null];
            return {
               kind: k,
               id: String(row.id),
               label: String(row.title ?? "").trim() || `#${row.id}`,
               secondary: parts.filter(Boolean).join(" · "),
               imageUrl: null,
               href: `/${k}/${row.id}`,
               lang,
            };
         });
      return c.json({ items }, 200, { "Cache-Control": "no-store" });
   });
   return r;
}
