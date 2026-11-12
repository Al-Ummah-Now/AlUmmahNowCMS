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

/**
 * An image URL from the videos API as an absolute https URL, or null. Imported legacy videos store
 * their thumbnail without a scheme and unencoded ("images.alummahnow.net/<title>.jpg"); those load
 * fine as https with the path percent-encoded, so they are normalised here instead of making a
 * curated row (or its whole add) invalid. Anything that still isn't https becomes null: the row
 * then shows its kind icon, never an error.
 */
export function imageUrl(v: unknown): string | null {
   const raw = str(v)?.trim();
   if (!raw) return null;
   const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : raw.startsWith("//") ? `https:${raw}` : /^[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\//i.test(raw) ? `https://${raw}` : null;
   if (!withScheme) return null;
   try {
      const url = new URL(withScheme);
      if (url.protocol === "http:" && (url.hostname === "alummahnow.net" || url.hostname.endsWith(".alummahnow.net"))) url.protocol = "https:";
      if (url.protocol !== "https:") return null;
      const out = url.href;
      return out.length <= 2048 ? out : null;
   } catch {
      return null;
   }
}

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
      thumbnail_url: kind === "video" ? imageUrl(o.thumbnailUrl) : (imageUrl(o.thumbnailUrl) ?? imageUrl(o.avatarUrl)),
      channel_name: kind === "channel" ? null : (str(o.channelName) ?? str(channel?.name)),
   };
}

/** What www renders for a curated item, so a render needs no per-item videos API call (audit UI-1). */
export interface ItemDetail extends PickerItem {
   handle: string | null;
   description: string | null;
   titles: Partial<Record<"en" | "ar", string>>;
   descriptions: Partial<Record<"en" | "ar", string>>;
   duration_seconds: number | null;
   upload_date: string | null;
   video_count: number | null;
   /** Videos: the encoded size, so www sizes the player frame to the video (Shorts, square); null when unknown. */
   width: number | null;
   height: number | null;
   /** Videos: their channel's name per language (the videos API puts only one name on the video). */
   channel_names: Partial<Record<"en" | "ar", string>>;
}

const MAX_TEXT = 2000;
const text = (v: unknown): string | null => {
   const t = str(v);
   return t === null ? null : t.trim().slice(0, MAX_TEXT);
};
const positive = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
function localized(v: unknown): Partial<Record<"en" | "ar", string>> {
   const out: Partial<Record<"en" | "ar", string>> = {};
   if (v && typeof v === "object") {
      for (const l of ["en", "ar"] as const) {
         const t = text((v as Obj)[l]);
         if (t) out[l] = t;
      }
   }
   return out;
}

export function toDetail(kind: VideoKind, o: Obj): ItemDetail | null {
   const base = toItem(kind, o);
   if (!base) return null;
   return {
      ...base,
      thumbnail_url: base.thumbnail_url ?? imageUrl(o.coverUrl),
      handle: kind === "channel" ? str(o.handle) : null,
      description: text(o.description),
      titles: localized(kind === "channel" ? o.nameLocalized : o.titleLocalized),
      descriptions: localized(o.descriptionLocalized),
      duration_seconds: kind === "video" ? positive(o.duration) : null,
      upload_date: str(o.dateCreated),
      video_count: kind === "playlist" ? (positive(o.videosCount) ?? (Array.isArray(o.videos) ? o.videos.length : null)) : null,
      width: kind === "video" ? positive(o.width) : null,
      height: kind === "video" ? positive(o.height) : null,
      channel_names: {},
   };
}

/**
 * A channel's name per language (`GET /api/channels/:id` nameLocalized, else its plain name as
 * English), cached per isolate for CHANNEL_NAMES_TTL_MS: one channel serves many videos, and a
 * refresh run looks up many of them. {} on any failure (the video keeps its one channel_name).
 */
const CHANNEL_NAMES_TTL_MS = 30 * 60_000;
const channelNamesCache = new Map<string, { at: number; names: Partial<Record<"en" | "ar", string>> }>();
export async function channelNames(apiUrl: string, channelId: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<Partial<Record<"en" | "ar", string>>> {
   if (!/^[A-Za-z0-9_-]{1,128}$/.test(channelId)) return {};
   const key = `${apiUrl}|${channelId}`;
   const hit = channelNamesCache.get(key);
   if (hit && now - hit.at < CHANNEL_NAMES_TTL_MS) return hit.names;
   try {
      const res = await fetchImpl(`${apiUrl}/api/channels/${encodeURIComponent(channelId)}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
      if (!res.ok) return {};
      const body = (await res.json().catch(() => null)) as Obj | null;
      const o = (body && typeof body.data === "object" && body.data ? body.data : body) as Obj | null;
      if (!o || typeof o !== "object") return {};
      const names = localized(o.nameLocalized);
      if (!names.en && !names.ar && str(o.name)) names.en = text(o.name)!;
      channelNamesCache.set(key, { at: now, names });
      if (channelNamesCache.size > 500) channelNamesCache.delete(channelNamesCache.keys().next().value!);
      return names;
   } catch {
      return {};
   }
}
/** Tests only. */
export const clearChannelNamesCache = () => channelNamesCache.clear();

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

/**
 * A picker's page before anything is typed (owner rule 2026-11-11: pickers open with content):
 * the unified search with no query, public items only. Videos and playlists newest first,
 * channels most viewed first; `cursor` is the search's nextCursor (null after the last page).
 */
export async function browseVideos(
   apiUrl: string,
   kind: VideoKind,
   cursor: string | null,
   fetchImpl: typeof fetch = fetch,
): Promise<{ items: PickerItem[]; nextCursor: string | null }> {
   const url = new URL(`${apiUrl}/api/search`);
   url.searchParams.set("type", kind);
   url.searchParams.set("sort", kind === "channel" ? "popular" : "date");
   url.searchParams.set("limit", "20");
   if (cursor) url.searchParams.set("cursor", cursor);
   const res = await fetchImpl(url.toString(), { headers: { accept: "application/json" } });
   if (!res.ok) throw new VideosApiError(`videos browse answered ${res.status}`);
   const body = (await res.json().catch(() => null)) as { results?: unknown; nextCursor?: unknown } | null;
   const results = Array.isArray(body?.results) ? (body.results as Obj[]) : [];
   return {
      items: results.map(fromSearchResult).filter((x): x is PickerItem => x !== null && x.kind === kind),
      nextCursor: typeof body?.nextCursor === "string" && body.nextCursor ? body.nextCursor : null,
   };
}

const DETAIL_PATH: Record<VideoKind, string> = { video: "videos", playlist: "playlists", channel: "channels" };

/**
 * Looks one item up by id (to snapshot it at pick time and on every refresh); null when missing
 * or not public. Throws VideosApiError on an upstream failure (callers keep what they have).
 */
export async function lookupItem(
   apiUrl: string,
   kind: VideoKind,
   id: string,
   fetchImpl: typeof fetch = fetch,
   timeoutMs = 5_000,
): Promise<ItemDetail | null> {
   if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
   const res = await fetchImpl(`${apiUrl}/api/${DETAIL_PATH[kind]}/${encodeURIComponent(id)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
   });
   if (res.status === 404) return null;
   if (!res.ok) throw new VideosApiError(`videos lookup answered ${res.status}`);
   const body = (await res.json().catch(() => null)) as Obj | null;
   const o = (body && typeof body.data === "object" && body.data ? body.data : body) as Obj | null;
   if (!isPublicItem(kind, o)) return null;
   const detail = toDetail(kind, o as Obj);
   const channelId = kind === "video" ? str((o as Obj).channelId) : null;
   if (detail && channelId) detail.channel_names = await channelNames(apiUrl, channelId, fetchImpl);
   return detail;
}

/**
 * A channel's latest public videos (`GET /api/channels/:id/videos?sort=latest&cursor=`), for the
 * Featuring screen's scholar videos. `cursor` is the videos API's own; "" = no more pages.
 */
export async function channelVideos(
   apiUrl: string,
   channelId: string,
   opts: { cursor?: string | null; limit?: number } = {},
   fetchImpl: typeof fetch = fetch,
): Promise<{ items: ItemDetail[]; cursor: string }> {
   if (!/^[A-Za-z0-9_-]{1,128}$/.test(channelId)) return { items: [], cursor: "" };
   const url = new URL(`${apiUrl}/api/channels/${encodeURIComponent(channelId)}/videos`);
   url.searchParams.set("sort", "latest");
   url.searchParams.set("limit", String(Math.min(Math.max(opts.limit ?? 12, 1), 50)));
   if (opts.cursor) url.searchParams.set("cursor", opts.cursor);
   const res = await fetchImpl(url.toString(), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5_000) });
   if (res.status === 404) return { items: [], cursor: "" };
   if (!res.ok) throw new VideosApiError(`channel videos answered ${res.status}`);
   const body = (await res.json().catch(() => null)) as { data?: unknown; cursor?: unknown } | null;
   const rows = Array.isArray(body?.data) ? (body.data as Obj[]) : [];
   return {
      items: rows.filter((o) => isPublicItem("video", o)).map((o) => toDetail("video", o)).filter((x): x is ItemDetail => x !== null),
      cursor: typeof body?.cursor === "string" ? body.cursor : "",
   };
}
