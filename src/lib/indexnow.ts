/**
 * IndexNow (wiki AUN-SEO, phase 3): tells Bing, Yandex and the other IndexNow engines which www
 * addresses changed, so they recrawl them within minutes instead of waiting for the sitemap.
 * Google does not use IndexNow; it reads the sitemap's lastmod.
 *
 * Stateless: the 30-minute cron sends every live post and page that changed or went live in the
 * last 35 minutes (the overlap makes a missed run harmless; resubmitting a URL is allowed).
 * Production only. The key is public by design: www serves it at /<key>.txt (AlUmmahNowUI public/).
 */
import { trimSlash, type Env } from "../env.ts";
import { log } from "./log.ts";

export const INDEXNOW_KEY = "9e1b0c3eec45ae20f6d905e0d4c5b004";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
export const INDEXNOW_WINDOW_MS = 35 * 60_000;
/** The protocol's limit per request. */
const MAX_URLS = 10_000;
/** Static sections www lists itself (no page of their own at /{locale}/{slug}/). */
const SECTION_SLUGS = new Set(["home", "articles", "videos", "scholars"]);

type Row = { slug: string; locale: string };

/** The www addresses of changed posts and pages. */
export function indexNowUrls(wwwUrl: string, posts: Row[], pages: Row[]): string[] {
   const base = trimSlash(wwwUrl);
   const ok = (r: Row) => (r.locale === "en" || r.locale === "ar") && /^[a-z0-9-]{1,120}$/.test(r.slug);
   const urls = [
      ...posts.filter(ok).map((r) => `${base}/${r.locale}/articles/${r.slug}/`),
      ...pages.filter((r) => ok(r) && !SECTION_SLUGS.has(r.slug)).map((r) => `${base}/${r.locale}/${r.slug}/`),
   ];
   return [...new Set(urls)].slice(0, MAX_URLS);
}

export async function pingIndexNow(env: Env, now = Date.now(), fetcher: typeof fetch = fetch): Promise<{ sent: number; status?: number }> {
   if (env.ENVIRONMENT !== "production" || !env.WWW_URL) return { sent: 0 };
   const since = new Date(now - INDEXNOW_WINDOW_MS).toISOString();
   const nowIso = new Date(now).toISOString();
   // The window is (since, now]: a row changed after `now` belongs to the next ping.
   // julianday(): the rows mix ISO (T…Z) and SQL (space) timestamps
   // Live at `now` (not the database clock), so a run for a given instant always sees the same rows
   const live = `status = 'published' AND (publish_at IS NULL OR julianday(publish_at) <= julianday(?2))`;
   const changed = `${live} AND ((julianday(updated_at) > julianday(?1) AND julianday(updated_at) <= julianday(?2)) OR (julianday(publish_at) > julianday(?1) AND julianday(publish_at) <= julianday(?2)))`;
   const [posts, pages] = await Promise.all([
      env.DB.prepare(`SELECT slug, locale FROM posts WHERE ${changed}`).bind(since, nowIso).all<Row>(),
      env.DB.prepare(`SELECT slug, locale FROM pages WHERE ${changed}`).bind(since, nowIso).all<Row>(),
   ]);
   const urlList = indexNowUrls(env.WWW_URL, posts.results, pages.results);
   if (urlList.length === 0) return { sent: 0 };
   const host = new URL(env.WWW_URL).host;
   const res = await fetcher(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host, key: INDEXNOW_KEY, keyLocation: `${trimSlash(env.WWW_URL)}/${INDEXNOW_KEY}.txt`, urlList }),
   });
   // 200/202: accepted. 4xx: our request or key; never retried in a loop (the next run resends)
   if (!res.ok) log.warn("indexnow refused", { status: res.status, urls: urlList.length });
   return { sent: urlList.length, status: res.status };
}
