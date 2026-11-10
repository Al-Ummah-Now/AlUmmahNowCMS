/** CMS media referenced inline in markdown bodies (CMS-10: www sizes them and offers variants). */

const MAX_BODY_IMAGES = 50;

/**
 * CMS media used inline in a markdown body (`![alt](<CMS media URL>)`), so www can size them and
 * offer variants. Matched by path; only files the media table knows.
 */
export function bodyImagePaths(publicUrl: string, body: string): string[] {
   const base = `${publicUrl.replace(/\/+$/, "")}/api/public/v1/media/`;
   const out = new Set<string>();
   for (const m of body.matchAll(/!\[[^\]\n]*\]\(\s*<?([^\s)>]+)>?/g)) {
      const src = m[1];
      if (!src.startsWith(base)) continue;
      try {
         const path = decodeURIComponent(new URL(src).pathname.slice(new URL(base).pathname.length));
         if (path && !path.includes("..")) out.add(path);
      } catch {
         /* not a URL */
      }
      if (out.size >= MAX_BODY_IMAGES) break;
   }
   return [...out];
}
