/**
 * The CMS's service-to-service calls to api-videos (docs/SCHOLARS.md §4). Authenticated with
 * api-videos' internal key (`X-API-Key`, its `/internal/*` guard), always on behalf of one auth user
 * id that api-videos checks against the channel's owner. No user token is ever forwarded.
 *
 *   GET    /internal/scholars/:userId/channels                → { channels: [{ id, name, handle, avatarUrl, isPublic }] }
 *   PUT    /internal/scholars/:userId/articles/:externalId     { channelId, title, excerpt, coverUrl, url, locale, publishedAt }
 *                                                            → { postId, channelId }   (create or update; idempotent)
 *   DELETE /internal/scholars/:userId/articles/:externalId     → { hidden: boolean }     (hide; idempotent)
 */
import type { Env } from "../../env.ts";
import { trimSlash } from "../../env.ts";

export interface OwnedChannel {
   id: string;
   name: string;
   handle: string | null;
   avatarUrl: string | null;
   isPublic: boolean;
}

export interface ArticlePost {
   channelId: string;
   title: string;
   excerpt: string | null;
   coverUrl: string | null;
   url: string;
   locale: "en" | "ar";
   publishedAt: string | null;
}

export class VideosInternalError extends Error {
   constructor(
      readonly status: number,
      readonly code: string,
   ) {
      super(`videos internal API: ${status} ${code}`);
      this.name = "VideosInternalError";
   }
   /** 4xx other than 408/429 will not get better by retrying (wrong owner, missing channel). */
   get permanent(): boolean {
      return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429;
   }
}

const TIMEOUT_MS = 8000;

export async function internalKey(env: Env): Promise<string | null> {
   const b = env.VIDEOS_INTERNAL_API_KEY;
   if (!b) return null;
   try {
      const v = typeof b === "string" ? b : await b.get();
      return v && v.trim() ? v.trim() : null;
   } catch {
      return null;
   }
}

async function call<T>(env: Env, fetchImpl: typeof fetch, method: string, path: string, body?: unknown): Promise<T> {
   const key = await internalKey(env);
   if (!key) throw new VideosInternalError(503, "not_configured");
   const res = await fetchImpl(`${trimSlash(env.VIDEOS_API_URL)}${path}`, {
      method,
      headers: { "X-API-Key": key, accept: "application/json", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
   });
   const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
   if (!res.ok) throw new VideosInternalError(res.status, typeof json?.error === "string" ? json.error : "error");
   if (!json) throw new VideosInternalError(502, "bad_body");
   return json;
}

const enc = encodeURIComponent;

/** The channels this auth user owns on the videos platform (its ownership index), newest first. */
export async function ownedChannels(env: Env, userId: string, fetchImpl: typeof fetch = fetch): Promise<OwnedChannel[]> {
   const body = await call<{ channels?: unknown }>(env, fetchImpl, "GET", `/internal/scholars/${enc(userId)}/channels`);
   if (!Array.isArray(body.channels)) return [];
   return body.channels
      .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof (c as Record<string, unknown>).id === "string")
      .map((c) => ({
         id: String(c.id),
         name: typeof c.name === "string" && c.name ? c.name : String(c.id),
         handle: typeof c.handle === "string" ? c.handle : null,
         avatarUrl: typeof c.avatarUrl === "string" ? c.avatarUrl : null,
         isPublic: c.isPublic !== false,
      }));
}

export async function upsertArticlePost(env: Env, userId: string, externalId: string, post: ArticlePost, fetchImpl: typeof fetch = fetch): Promise<{ postId: string; channelId: string }> {
   const body = await call<{ postId?: unknown; channelId?: unknown }>(env, fetchImpl, "PUT", `/internal/scholars/${enc(userId)}/articles/${enc(externalId)}`, post);
   if (typeof body.postId !== "string" || !body.postId) throw new VideosInternalError(502, "bad_body");
   return { postId: body.postId, channelId: typeof body.channelId === "string" ? body.channelId : post.channelId };
}

export async function hideArticlePost(env: Env, userId: string, externalId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
   try {
      await call(env, fetchImpl, "DELETE", `/internal/scholars/${enc(userId)}/articles/${enc(externalId)}`);
   } catch (error) {
      // Never posted (or already gone): nothing to hide.
      if (error instanceof VideosInternalError && error.status === 404) return;
      throw error;
   }
}

/* ── PostV2 (docs/SCHOLARS.md §7–§8) ──────────────────────────────────────────────────────────── */

/** A community post as api-videos stores it (post-schema PostLike plus counters). */
export type CommunityPostJson = Record<string, unknown> & { id: string; channelId: string; type: string };

/** One community post for www's post page (never counts a view). Null = gone or not public. */
export async function communityPost(env: Env, channelId: string, postId: string, fetchImpl: typeof fetch = fetch): Promise<CommunityPostJson | null> {
   try {
      const body = await call<{ post?: CommunityPostJson }>(env, fetchImpl, "GET", `/internal/posts/${enc(channelId)}/${enc(postId)}`);
      return body.post && typeof body.post === "object" ? body.post : null;
   } catch (error) {
      if (error instanceof VideosInternalError && error.status === 404) return null;
      throw error;
   }
}

/** The conversion's body (AlUmmahNow apps/api-videos/src/lib/scholar-articles.ts parseConvert). */
export interface ConvertBody {
   channelId: string;
   kind: "article" | "cards";
   locale: "en" | "ar";
   translationKey?: string;
   title?: string;
   article?: { title: string; excerpt: string | null; body: string; cover: { url: string; alt: string | null; width: number | null; height: number | null } | null };
   slides?: { id: string; image: { url: string; alt: string | null; width: number | null; height: number | null }; heading: string | null; body: string | null; position: string }[];
   www: { url: string; slug: string; locale: "en" | "ar" };
   status: "published" | "draft";
   publishedAt: string | null;
}

/** Writes a CMS scholar post as a full community post (upgrades its mirror in place). Idempotent. */
export async function convertPost(env: Env, userId: string, externalId: string, body: ConvertBody, fetchImpl: typeof fetch = fetch): Promise<{ postId: string; channelId: string; created: boolean; upgraded: boolean; post: CommunityPostJson }> {
   return call(env, fetchImpl, "PUT", `/internal/scholars/${enc(userId)}/posts/${enc(externalId)}`, body);
}

/** What the conversion wrote for a CMS post (the check). Null = never converted. */
export async function convertedPost(env: Env, userId: string, externalId: string, fetchImpl: typeof fetch = fetch): Promise<{ postId: string; channelId: string; post: CommunityPostJson } | null> {
   try {
      return await call(env, fetchImpl, "GET", `/internal/scholars/${enc(userId)}/posts/${enc(externalId)}`);
   } catch (error) {
      if (error instanceof VideosInternalError && error.status === 404) return null;
      throw error;
   }
}

/** A channel's newest posts and whether each may have a www reference (the nightly check, #1217). */
export interface ChannelDigest {
   posts: { id: string; live: boolean; updatedAt: string | null }[];
   complete: boolean;
}

/** Null when the channel is gone (404). */
export async function channelDigest(env: Env, channelId: string, fetchImpl: typeof fetch = fetch): Promise<ChannelDigest | null> {
   try {
      const body = await call<Partial<ChannelDigest>>(env, fetchImpl, "GET", `/internal/posts/${enc(channelId)}?limit=200`);
      return { posts: Array.isArray(body.posts) ? body.posts.filter((p) => p && typeof p.id === "string") : [], complete: body.complete === true };
   } catch (error) {
      if (error instanceof VideosInternalError && error.status === 404) return null;
      throw error;
   }
}
