/**
 * Server-side client for the public videos API, used by the picker (SPEC §5). No token is
 * forwarded and nothing that is not public is ever returned to the browser.
 */
export type VideoKind = "video" | "playlist" | "channel";
export const VIDEO_KINDS: readonly VideoKind[] = ["video", "playlist", "channel"];

export interface PickerItem {
   kind: VideoKind;
   id: string;
   title: string;
   thumbnail_url: string | null;
   channel_name: string | null;
}

type Obj = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** False for anything the videos platform marks as not public (or a video that isn't ready). */
export function isPublicItem(kind: VideoKind, o: Obj | null | undefined): boolean {
   if (!o || typeof o !== "object") return false;
   if (o.isPublic === false || o.is_public === false || o.isPrivate === true || o.is_private === true) return false;
   if (typeof o.visibility === "string" && o.visibility.toLowerCase() !== "public") return false;
   if (typeof o.privacy === "string" && o.privacy.toLowerCase() !== "public") return false;
   if (o.deleted === true || o.isDeleted === true || o.removed === true) return false;
   const scheduled = o.scheduledAt ?? o.scheduled_at;
   if (typeof scheduled === "string" && Date.parse(scheduled) > Date.now()) return false;
   if (kind === "video" && typeof o.uploadStatus === "string" && o.uploadStatus !== "ready") return false;
   return true;
}

/** Normalizes one `/api/search` result; null when it is malformed or not public. */
export function fromSearchResult(r: Obj): PickerItem | null {
   const kind = r.type as VideoKind;
   if (!VIDEO_KINDS.includes(kind)) return null;
   const body = (r[kind] ?? null) as Obj | null;
   const channel = (r.channel ?? null) as Obj | null;
   if (!isPublicItem(kind, body)) return null;
   if (kind !== "channel" && channel && !isPublicItem("channel", channel)) return null;
   return toItem(kind, body as Obj, channel);
}

export function toItem(kind: VideoKind, o: Obj, channel?: Obj | null): PickerItem | null {
   const id = str(o.id);
   if (!id) return null;
   const title = kind === "video" ? str(o.title) : kind === "playlist" ? (str(o.name) ?? str(o.title)) : str(o.name);
   if (!title) return null;
   return {
      kind,
      id,
      title,
      thumbnail_url: kind === "video" ? str(o.thumbnailUrl) : (str(o.thumbnailUrl) ?? str(o.avatarUrl)),
      channel_name: kind === "channel" ? null : (str(o.channelName) ?? str(channel?.name)),
   };
}

export class VideosApiError extends Error {}

export async function searchVideos(
   apiUrl: string,
   kind: VideoKind,
   q: string,
   fetchImpl: typeof fetch = fetch,
): Promise<PickerItem[]> {
   const url = new URL(`${apiUrl}/api/search`);
   url.searchParams.set("q", q);
   url.searchParams.set("type", kind);
   url.searchParams.set("limit", "20");
   const res = await fetchImpl(url.toString(), { headers: { accept: "application/json" } });
   if (!res.ok) throw new VideosApiError(`videos search answered ${res.status}`);
   const body = (await res.json().catch(() => null)) as { results?: unknown } | null;
   const results = Array.isArray(body?.results) ? (body.results as Obj[]) : [];
   return results.map(fromSearchResult).filter((x): x is PickerItem => x !== null && x.kind === kind);
}

const DETAIL_PATH: Record<VideoKind, string> = { video: "videos", playlist: "playlists", channel: "channels" };

/** Looks one item up by id (to snapshot it at pick time); null when missing or not public. */
export async function lookupItem(
   apiUrl: string,
   kind: VideoKind,
   id: string,
   fetchImpl: typeof fetch = fetch,
): Promise<PickerItem | null> {
   if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
   const res = await fetchImpl(`${apiUrl}/api/${DETAIL_PATH[kind]}/${encodeURIComponent(id)}`, {
      headers: { accept: "application/json" },
   });
   if (res.status === 404) return null;
   if (!res.ok) throw new VideosApiError(`videos lookup answered ${res.status}`);
   const body = (await res.json().catch(() => null)) as Obj | null;
   const o = (body && typeof body.data === "object" && body.data ? body.data : body) as Obj | null;
   if (!isPublicItem(kind, o)) return null;
   return toItem(kind, o as Obj);
}
