/**
 * What www (AlUmmahNowUI) needs from the public API, written from www's side: its types
 * (src/lib/cms-types.ts), its request paths (cmsPaths in src/lib/cms.ts) and the value rules its
 * pages rely on. Keep in step with www, not with this repo's responses.
 *
 * Used by test/worker/public-api-www-contract.test.ts (the committed contract snapshot must
 * satisfy it, so a regenerated snapshot cannot silently break www) and e2e/public-api.spec.ts
 * (the deployed CMS, at exactly the paths www requests).
 *
 * www's loader: 200 + valid JSON → content; 404 → "not found" (cached); anything else, or JSON
 * that fails its shape check → treated as a CMS outage (fallback content).
 */

export type Locale = "en" | "ar";
export const LOCALES: Locale[] = ["en", "ar"];
/** Page sizes www requests (ARTICLES_PAGE_SIZE and RSS_ITEMS in www's src/lib/cms.ts). */
export const ARTICLES_PAGE_SIZE = 10;
export const RSS_ITEMS = 20;

const q = (params: Record<string, string | number>) => `?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`;
/** www's cmsPaths, relative to /api/public/v1. */
export const wwwPaths = {
   site: (l: Locale) => `/site${q({ locale: l })}`,
   home: (l: Locale) => `/home${q({ locale: l })}`,
   page: (l: Locale, slug: string) => `/pages/${encodeURIComponent(slug)}${q({ locale: l })}`,
   posts: (l: Locale, page: number, limit: number) => `/posts${q({ locale: l, page, limit })}`,
   post: (l: Locale, slug: string) => `/posts/${encodeURIComponent(slug)}${q({ locale: l })}`,
   videos: (l: Locale, placement: "home" | "videos") => `/videos${q({ locale: l, placement })}`,
   sitemap: () => "/sitemap",
   cards: (l: Locale, page: number, limit: number, tag?: string) => `/cards${q({ locale: l, page, limit, ...(tag ? { tag } : {}) })}`,
};

type Check = (v: unknown, path: string, out: string[]) => void;

const kind = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const fail = (out: string[], path: string, want: string, v: unknown) => out.push(`${path}: expected ${want}, got ${kind(v)}${typeof v === "string" ? ` "${v.slice(0, 80)}"` : ""}`);

const str: Check = (v, p, o) => void (typeof v !== "string" && fail(o, p, "string", v));
const nonEmpty: Check = (v, p, o) => void ((typeof v !== "string" || v.trim() === "") && fail(o, p, "non-empty string", v));
const int: Check = (v, p, o) => void (!Number.isInteger(v) && fail(o, p, "integer", v));
const iso: Check = (v, p, o) => void ((typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(v) || Number.isNaN(Date.parse(v))) && fail(o, p, "ISO date-time", v));
const oneOf = (...values: string[]): Check => (v, p, o) => void (!values.includes(v as string) && fail(o, p, values.join("|"), v));
const locale = oneOf(...LOCALES);
const nullable = (c: Check): Check => (v, p, o) => void (v !== null && c(v, p, o));
const optional = (c: Check): Check => (v, p, o) => void (v !== undefined && c(v, p, o));
const arrayOf = (c: Check): Check => (v, p, o) => {
   if (!Array.isArray(v)) return fail(o, p, "array", v);
   v.forEach((x, i) => c(x, `${p}[${i}]`, o));
};
/** Every key www reads must be present (undefined is not null); extra keys are allowed (additive changes). */
const object = (shape: Record<string, Check>): Check => (v, p, o) => {
   if (kind(v) !== "object") return fail(o, p, "object", v);
   const rec = v as Record<string, unknown>;
   // An absent key reads as undefined, which every check but optional() rejects
   for (const [key, c] of Object.entries(shape)) c(rec[key], `${p}.${key}`, o);
};

/** Relative to www ("/…", not "//…") or absolute https: www's navHref takes nothing else. */
const navUrl: Check = (v, p, o) => void ((typeof v !== "string" || !(/^\/(?!\/)/.test(v) || /^https:\/\/[^/]/.test(v))) && fail(o, p, 'www-relative "/…" or https URL', v));
const httpsUrl: Check = (v, p, o) => void ((typeof v !== "string" || !/^https:\/\/[^/]/.test(v)) && fail(o, p, "https URL", v));

/**
 * A cover image: www's CSP img-src allows only the CMS's own public origin for CMS media, so the
 * URL must be absolute on `cmsOrigin`.
 */
const media = (cmsOrigin: string): Check =>
   object({
      url: (v, p, o) => void ((typeof v !== "string" || !v.startsWith(`${cmsOrigin}/`)) && fail(o, p, `URL on ${cmsOrigin}`, v)),
      alt: nullable(str),
      width: nullable(int),
      height: nullable(int),
      // Image variants (CMS-10): optional for www (older CMS builds lack it); when present, every
      // srcset candidate is on the CMS origin (www's CSP) and carries a "<n>w" descriptor.
      variants: optional(nullable(object({ widths: arrayOf(int), fallback_type: oneOf("image/jpeg", "image/png"), avif: srcset(cmsOrigin), webp: srcset(cmsOrigin), fallback: srcset(cmsOrigin) }))),
   });

const srcset = (cmsOrigin: string): Check => (v, p, o) => {
   if (typeof v !== "string" || !v) return fail(o, p, "srcset string", v);
   for (const part of v.split(", ")) {
      const [url, w, extra] = part.split(" ");
      if (!url?.startsWith(`${cmsOrigin}/`) || !/^\d+w$/.test(w ?? "") || extra !== undefined) return fail(o, p, `srcset of "<${cmsOrigin} URL> <n>w"`, v);
   }
};

const settings = object({
   locale,
   site_title: nonEmpty,
   tagline: nullable(str),
   hero_title: nullable(str),
   hero_body: nullable(str),
   social: arrayOf(object({ kind: nonEmpty, url: httpsUrl })),
});

const alternates = arrayOf(object({ locale, slug: nonEmpty }));

/** A card post's slide: real text over an image (www renders it, never burned into the image). */
const slide = (cms: string) =>
   object({ id: nonEmpty, image: media(cms), heading: nullable(str), body: nullable(str), position: oneOf("top", "middle", "bottom") });

const postSummary = (cms: string) => ({
   slug: nonEmpty,
   locale,
   title: nonEmpty,
   excerpt: nullable(str),
   cover: nullable(media(cms)),
   author_name: nullable(str),
   tags: arrayOf(str),
   published_at: iso,
   updated_at: iso,
   // Card posts (additive; absent from a CMS that predates them, which www reads as an article)
   kind: optional(oneOf("article", "cards")),
   slide_count: optional(int),
   first_slide: optional(nullable(slide(cms))),
   /** Added: a card post's first slides (at most 10; slide_count counts them all), [] for articles. */
   slides: optional(arrayOf(slide(cms))),
});

const localized = (c: Check): Check => (v, p, o) => {
   if (kind(v) !== "object") return fail(o, p, "object", v);
   for (const [k, x] of Object.entries(v as object)) {
      locale(k, `${p} key`, o);
      c(x, `${p}.${k}`, o);
   }
};

const snapshot = object({
   title: str,
   thumbnail_url: nullable(str),
   channel_name: nullable(str),
   refreshed_at: optional(iso),
   handle: optional(nullable(str)),
   description: optional(nullable(str)),
   titles: optional(localized(str)),
   descriptions: optional(localized(str)),
   duration_seconds: optional(nullable(int)),
   upload_date: optional(nullable(str)),
   video_count: optional(nullable(int)),
   width: optional(nullable(int)),
   height: optional(nullable(int)),
   channel_names: optional(localized(str)),
});

const curated = object({
   id: int,
   kind: oneOf("video", "playlist", "channel"),
   ref_id: nonEmpty,
   title_override: nullable(str),
   snapshot: nullable(snapshot),
   sort: int,
});

const blockItem = (cms: string) => object({ image: media(cms), caption: nullable(str) });
const blockVideo = object({ kind: oneOf("video", "playlist", "channel"), ref_id: nonEmpty, title_override: nullable(str), snapshot: nullable(snapshot) });

/** One page block: www renders each type; an unknown type is skipped by www, so it is allowed. */
const block = (cms: string): Check => (v, p, o) => {
   if (kind(v) !== "object") return fail(o, p, "object", v);
   const b = v as Record<string, unknown>;
   const shapes: Record<string, Record<string, Check>> = {
      markdown: { text: str },
      image: { image: media(cms), caption: nullable(str), size: oneOf("content", "wide") },
      gallery: { columns: (x, pp, oo) => void (![2, 3, 4].includes(x as number) && fail(oo, pp, "2|3|4", x)), items: arrayOf(blockItem(cms)) },
      posts: { heading: nullable(str), mode: oneOf("latest", "tag", "picked"), items: arrayOf(object(postSummary(cms))) },
      cards: { heading: nullable(str), tag: nullable(str), page_size: int, filter: (x, pp, oo) => void (typeof x !== "boolean" && fail(oo, pp, "boolean", x)) },
      videos: { heading: nullable(str), items: arrayOf(blockVideo) },
      video: { kind: oneOf("video", "playlist"), ref_id: nonEmpty, caption: nullable(str), snapshot: nullable(snapshot) },
      cta: { heading: nullable(str), text: nullable(str), label: nonEmpty, url: navUrl, tone: oneOf("primary", "quiet") },
      columns: { text: str, image: nullable(media(cms)), caption: nullable(str), image_side: oneOf("start", "end") },
      quote: { variant: oneOf("quote", "callout"), text: nonEmpty, cite: nullable(str) },
      divider: { style: oneOf("line", "space"), size: oneOf("s", "m", "l") },
   };
   nonEmpty(b.id, `${p}.id`, o);
   const shape = shapes[b.type as string];
   if (shape) object(shape)(v, `${p}<${String(b.type)}>`, o);
   else nonEmpty(b.type, `${p}.type`, o);
};

/** Body checks per endpoint (www's response types). `cms` is the CMS's public origin. */
export function wwwSchemas(cms: string) {
   return {
      site: object({ settings: nullable(settings), nav: object({ header: arrayOf(object({ label: nonEmpty, url: navUrl })), footer: arrayOf(object({ label: nonEmpty, url: navUrl })) }) }),
      home: object({ settings: nullable(settings), videos: arrayOf(curated), posts: arrayOf(object(postSummary(cms))) }),
      page: object({ slug: nonEmpty, locale, title: nonEmpty, summary: nullable(str), body: str, seo_title: nullable(str), seo_description: nullable(str), cover: nullable(media(cms)), published_at: iso, updated_at: iso, alternates, images: optional(arrayOf(media(cms))), blocks: optional(arrayOf(block(cms))) }),
      posts: object({ items: arrayOf(object(postSummary(cms))), page: int, limit: int, total: int }),
      post: object({ ...postSummary(cms), body: str, seo_title: nullable(str), seo_description: nullable(str), alternates, images: optional(arrayOf(media(cms))), slides: optional(arrayOf(slide(cms))) }),
      videos: object({ items: arrayOf(curated) }),
      sitemap: object({ items: arrayOf(object({ type: oneOf("page", "post"), locale, slug: nonEmpty, updated_at: iso })) }),
      cards: object({ items: arrayOf(object({ ...postSummary(cms), kind: oneOf("cards"), slide_count: int, first_slide: nullable(slide(cms)) })), page: int, limit: int, total: int, tags: arrayOf(nonEmpty) }),
   } satisfies Record<keyof typeof wwwPaths, Check>;
}
export type WwwEndpoint = keyof typeof wwwPaths;

/** The contract violations of `body` for `endpoint` (empty = www can render it). */
export function wwwViolations(endpoint: WwwEndpoint, body: unknown, cmsOrigin: string): string[] {
   const out: string[] = [];
   wwwSchemas(cmsOrigin)[endpoint](body, endpoint, out);
   return out;
}

/** Which endpoint a public path is (`/api/public/v1/pages/x?…` → "page"). */
export function endpointOf(path: string): WwwEndpoint | null {
   const p = new URL(path, "https://x").pathname.replace(/^\/api\/public\/v1/, "");
   if (p === "/site") return "site";
   if (p === "/home") return "home";
   if (p === "/posts") return "posts";
   if (p === "/videos") return "videos";
   if (p === "/sitemap") return "sitemap";
   if (p === "/cards") return "cards";
   if (/^\/pages\/[^/]+$/.test(p)) return "page";
   if (/^\/posts\/[^/]+$/.test(p)) return "post";
   return null;
}
