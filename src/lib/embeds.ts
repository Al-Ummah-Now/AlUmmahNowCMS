/**
 * Embeds adapter (SPEC §5). The single place that knows the videos platform's embed URL scheme.
 * PLACEHOLDER until AlUmmahNow `docs/embeds/README.md` publishes the contract:
 *   video:    `${VIDEOS_WEB_URL}/embed/{id}`
 *   playlist: `${VIDEOS_WEB_URL}/embed/playlist/{id}`
 *   params:   lang (en|ar), start (seconds, videos only)
 * Channels have no embed; link to the channel page instead.
 */
export type EmbedKind = "video" | "playlist" | "channel";

export interface EmbedOptions {
   lang?: "en" | "ar";
   start?: number;
}

export function embedUrl(videosWebUrl: string, kind: EmbedKind, id: string, opts: EmbedOptions = {}): string | null {
   if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
   const base = videosWebUrl.replace(/\/+$/, "");
   let url: URL;
   if (kind === "video") url = new URL(`${base}/embed/${id}`);
   else if (kind === "playlist") url = new URL(`${base}/embed/playlist/${id}`);
   else return null;
   if (opts.lang) url.searchParams.set("lang", opts.lang);
   if (kind === "video" && opts.start && Number.isFinite(opts.start) && opts.start > 0) {
      url.searchParams.set("start", String(Math.floor(opts.start)));
   }
   return url.toString();
}

export function watchUrl(videosWebUrl: string, kind: EmbedKind, id: string): string {
   const base = videosWebUrl.replace(/\/+$/, "");
   const path = kind === "video" ? "watch" : kind === "playlist" ? "playlist" : "channel";
   return `${base}/${path}/${encodeURIComponent(id)}`;
}
