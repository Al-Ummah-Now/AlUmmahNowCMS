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
