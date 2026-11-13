/**
 * Stable thumbnails. The videos API hands out video images as signed URLs that expire after a few
 * hours: Bunny token URLs (path form `/bcdn_token=…&expires=…&token_path=%2F<id>%2F/<id>/file.jpg`
 * or query form `/<id>/file.jpg?token=…&expires=…`) and private R2 renditions
 * (`media….alummahnow.net/priv/<expires>.<sig>/<id>/…`). Stored as-is (snapshots in D1, the home
 * timeline in KV) they break as soon as a refresh is missed. The videos web app serves a
 * never-expiring image for every public video at `<VIDEOS_WEB_URL>/thumb/<videoId>.jpg`, so any
 * signed URL is swapped for that before it is stored or served.
 *
 * Unsigned URLs (custom thumbnails on images.alummahnow.net, R2 `/pub/`, avatars, covers, CMS
 * media) are returned unchanged. A signed URL whose video can't be told becomes null: the item then
 * shows its kind icon, never a link that stops working.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Obj = Record<string, unknown>;

export function isVideoUuid(v: unknown): v is string {
   return typeof v === "string" && v.length === 36 && UUID.test(v);
}

function parse(url: string): URL | null {
   try {
      return new URL(url);
   } catch {
      return null;
   }
}

/** Whether a URL carries an expiring signature (Bunny token, or a private R2 rendition). */
export function isSignedUrl(url: string): boolean {
   if (!/^https?:\/\//i.test(url)) return false;
   if (url.includes("bcdn_token=")) return true;
   const u = parse(url);
   if (!u) return false;
   if (u.searchParams.has("token") && u.searchParams.has("expires")) return true;
   const host = u.hostname.toLowerCase();
   return host.startsWith("media") && host.endsWith(".alummahnow.net") && u.pathname.startsWith("/priv/");
}

/** The video id in a signed URL's path (Bunny `/<id>/<file>`, R2 `/priv/<sig>/<id>/…`), or null. */
function videoIdIn(url: string): string | null {
   const u = parse(url);
   if (!u) return null;
   for (const seg of u.pathname.split("/")) {
      if (isVideoUuid(seg)) return seg.toLowerCase();
   }
   // Path-form Bunny token: the id sits in token_path=%2F<id>%2F inside the first segment.
   let path: string;
   try {
      path = decodeURIComponent(u.pathname);
   } catch {
      return null;
   }
   const m = /token_path=\/([0-9a-f-]{36})\//i.exec(path);
   return m && isVideoUuid(m[1]) ? m[1].toLowerCase() : null;
}

function httpsBase(webUrl: string): string | null {
   const u = parse(webUrl);
   if (!u || u.protocol !== "https:") return null;
   let end = webUrl.length;
   while (end > 0 && webUrl.charCodeAt(end - 1) === 47) end--;
   return webUrl.slice(0, end);
}

/**
 * `url` as a URL that never expires: unchanged when unsigned, else `<webUrl>/thumb/<videoId>.jpg`
 * (videoId = `ownerVideoId` for a video's own image, else the id in the URL's path), or null when
 * no video id can be told or `webUrl` isn't https.
 */
export function stableImageUrl(webUrl: string, url: string | null | undefined, ownerVideoId?: string | null): string | null {
   if (typeof url !== "string" || !url) return null;
   if (!isSignedUrl(url)) return url;
   const base = httpsBase(webUrl);
   if (!base) return null;
   const id = isVideoUuid(ownerVideoId) ? ownerVideoId.toLowerCase() : videoIdIn(url);
   return id ? `${base}/thumb/${id}.jpg` : null;
}

/**
 * A snapshot (stored or about to be) with its images made stable: `thumbnail_url` (a video's own
 * image is that video's /thumb; a playlist's or channel's is the video in the URL) and a channel's
 * `latest[]` (each one a video, by its id). Returns the same object when nothing changes.
 */
export function stableSnapshot<T extends Obj>(webUrl: string, snap: T, kind: string, refId: string): T {
   let out = snap;
   const thumb = snap.thumbnail_url;
   if (typeof thumb === "string") {
      const next = stableImageUrl(webUrl, thumb, kind === "video" ? refId : null);
      if (next !== thumb) out = { ...out, thumbnail_url: next };
   }
   if (Array.isArray(snap.latest)) {
      let changed = false;
      const latest = (snap.latest as unknown[]).map((v) => {
         if (!v || typeof v !== "object" || typeof (v as Obj).thumbnail_url !== "string") return v;
         const o = v as Obj;
         const next = stableImageUrl(webUrl, o.thumbnail_url as string, typeof o.id === "string" ? o.id : null);
         if (next === o.thumbnail_url) return v;
         changed = true;
         return { ...o, thumbnail_url: next };
      });
      if (changed) out = { ...out, latest };
   }
   return out;
}

/**
 * Every signed URL anywhere in a JSON value made stable (for stored documents whose layout varies:
 * trash copies, home timeline KV values). A `{ kind, ref_id, snapshot }` record is treated as
 * stableSnapshot does; any other signed string uses the video id in its own path. A string holding
 * JSON (a row copied with its snapshot column as text) is rewritten inside and kept as text.
 * `changed` counts the URLs rewritten, `dropped` those of them that became null (no video id).
 */
export function stableDeep(webUrl: string, value: unknown): { value: unknown; changed: number; dropped: number } {
   let changed = 0;
   let dropped = 0;
   const walk = (v: unknown, owner: string | null): unknown => {
      if (typeof v === "string") {
         if (isSignedUrl(v)) {
            changed++;
            const next = stableImageUrl(webUrl, v, owner);
            if (next === null) dropped++;
            return next;
         }
         if ((v.startsWith("{") || v.startsWith("[")) && (v.includes("token=") || v.includes("/priv/"))) {
            let inner: unknown;
            try {
               inner = JSON.parse(v);
            } catch {
               return v;
            }
            const before = changed;
            const next = walk(inner, owner);
            return changed > before ? JSON.stringify(next) : v;
         }
         return v;
      }
      if (Array.isArray(v)) return v.map((x) => walk(x, null));
      if (!v || typeof v !== "object") return v;
      const o = v as Obj;
      const out: Obj = {};
      const snapOwner = o.kind === "video" && isVideoUuid(o.ref_id) ? o.ref_id : null;
      // A channel's latest[] item: a video with its own id and thumbnail.
      const ownId = isVideoUuid(o.id) && typeof o.thumbnail_url === "string" && !("kind" in o && o.kind !== "video") ? o.id : null;
      for (const [k, x] of Object.entries(o)) {
         if (k === "snapshot") out[k] = walk(x, snapOwner);
         else if (k === "thumbnail_url") out[k] = walk(x, owner ?? ownId);
         else out[k] = walk(x, null);
      }
      return out;
   };
   const out = walk(value, null);
   return { value: out, changed, dropped };
}
