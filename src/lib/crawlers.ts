/**
 * Crawler rules for the CMS host (wiki: AUN-SEO, "robots rules"). Nothing here is a page for
 * search engines, except the public media files www uses as article and share images, which
 * stay crawlable (Google Images, og:image fetches) and carry no noindex.
 */

export const NOINDEX = "noindex, nofollow";

/** Public media (images on www articles and share cards): crawlable, no noindex. */
export const PUBLIC_MEDIA_PREFIX = "/api/public/v1/media/";

export const ROBOTS_TXT = ["User-agent: *", `Allow: ${PUBLIC_MEDIA_PREFIX}`, "Disallow: /", ""].join("\n");

/** robots.txt for the host, or null for any other path. */
export function robotsTxtResponse(request: Request): Response | null {
   if (new URL(request.url).pathname !== "/robots.txt") return null;
   return new Response(ROBOTS_TXT, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
   });
}

/** Every response but public media gets X-Robots-Tag: noindex (copied first when its headers are immutable). */
export function withCrawlerRules(request: Request, response: Response): Response {
   if (response.status === 101) return response;
   if (new URL(request.url).pathname.startsWith(PUBLIC_MEDIA_PREFIX)) return response;
   if (response.headers.get("X-Robots-Tag")) return response;
   try {
      response.headers.set("X-Robots-Tag", NOINDEX);
      return response;
   } catch {
      const copy = new Response(response.body, response);
      copy.headers.set("X-Robots-Tag", NOINDEX);
      return copy;
   }
}
