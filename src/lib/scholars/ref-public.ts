/**
 * How the public API serves a scholar post reference (docs/SCHOLARS.md §7): lists, the home timeline
 * and search render from the ref's summary cache; the post itself (GET /posts/:slug) reads the community
 * post from api-videos, cached 60 s, so an edit in Studio shows on www within a minute.
 *
 * Additive fields on PostSummary/Post (www ignores what it does not know):
 *   ref     { post_id, channel_id, videos_url }   the community post (likes, votes and comments live there)
 *   v2      the PostV2 summary (kind-specific: images, poll, quiz, link, video_id, gif, text)
 *   community (Post only)  the community post's public fields, for the kinds www renders from it
 */
import type { Env } from "../../env.ts";
import { trimSlash } from "../../env.ts";
import type { MediaRef } from "../media-ref.ts";
import type { PublicSlide } from "../blocks-public.ts";
import type { PostMedia, PostSummaryV2 } from "../post-schema.generated.ts";
import { communityPost, type CommunityPostJson } from "./videos-internal.ts";

type Row = Record<string, unknown>;

export const REF_POST_CACHE_SECONDS = 60;

export const mediaOf = (m: PostMedia | null | undefined): MediaRef | null =>
   m && typeof m.url === "string" ? { url: m.url, alt: m.alt ?? null, width: m.width ?? null, height: m.height ?? null, variants: null } : null;

export function slidesOf(slides: PostSummaryV2["slides"] | unknown): PublicSlide[] {
   if (!Array.isArray(slides)) return [];
   const out: PublicSlide[] = [];
   for (const s of slides as Record<string, unknown>[]) {
      const image = mediaOf(s?.image as PostMedia);
      if (!image || typeof s.id !== "string") continue;
      const position = s.position === "top" || s.position === "middle" ? s.position : "bottom";
      out.push({ id: s.id, image, heading: typeof s.heading === "string" && s.heading ? s.heading : null, body: typeof s.body === "string" && s.body ? s.body : null, position });
   }
   return out;
}

/** Where the post lives on the videos site (its channel's Community tab). */
export function videosPostUrl(env: Env, locale: string, channelId: string): string {
   return `${trimSlash(env.VIDEOS_WEB_URL)}/${locale === "ar" ? "ar" : "en"}/channels/${encodeURIComponent(channelId)}?tab=community`;
}

export function refInfo(env: Env, row: Row) {
   const postId = String(row.ref_post_id);
   const channelId = String(row.ref_channel_id ?? "");
   return { post_id: postId, channel_id: channelId, videos_url: videosPostUrl(env, String(row.locale ?? "en"), channelId) };
}

/** The fields of a community post www may show (never viewer state or moderation fields). */
export function publicCommunity(p: CommunityPostJson): Record<string, unknown> {
   const pick = ["id", "channelId", "type", "content", "images", "videoId", "gif", "poll", "quiz", "article", "slides", "link", "title", "locale", "translationKey", "likes", "comments", "commentsEnabled", "createdAt", "updatedAt", "channelName", "channelNameLocalized", "channelAvatar"];
   const out: Record<string, unknown> = {};
   for (const k of pick) if (p[k] !== undefined) out[k] = p[k];
   // A quiz's answer is revealed on the videos site after answering, never in www's HTML.
   if (out.quiz && typeof out.quiz === "object") {
      const { correctOptionId: _c, explanation: _e, ...quiz } = out.quiz as Record<string, unknown>;
      out.quiz = quiz;
   }
   return out;
}

/**
 * The community post behind a ref, through the Cache API (60 s per post). "missing" = gone or not public
 * (www answers 404 until the outbox drafts the ref); "unavailable" = api-videos did not answer (www shows
 * the summary).
 */
export async function loadRefPost(env: Env, row: Row, fetchImpl: typeof fetch = fetch): Promise<CommunityPostJson | "missing" | "unavailable"> {
   const channelId = String(row.ref_channel_id ?? "");
   const postId = String(row.ref_post_id ?? "");
   const cache = typeof caches !== "undefined" ? (caches as unknown as { default?: Cache }).default : undefined;
   const key = new Request(`https://cms-ref-cache.invalid/${encodeURIComponent(channelId)}/${encodeURIComponent(postId)}`);
   const hit = cache ? await cache.match(key).catch(() => undefined) : undefined;
   if (hit) {
      const body = (await hit.json().catch(() => null)) as { post: CommunityPostJson | null } | null;
      if (body) return body.post ?? "missing";
   }
   let post: CommunityPostJson | null;
   try {
      post = await communityPost(env, channelId, postId, fetchImpl);
   } catch {
      return "unavailable";
   }
   if (cache) {
      const res = new Response(JSON.stringify({ post }), { headers: { "content-type": "application/json", "cache-control": `max-age=${REF_POST_CACHE_SECONDS}` } });
      await cache.put(key, res).catch(() => undefined);
   }
   return post ?? "missing";
}
