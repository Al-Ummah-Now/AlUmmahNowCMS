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
/** Page sizes www requests (NEWS_PAGE_SIZE and RSS_ITEMS in www's src/lib/cms.ts). */
export const NEWS_PAGE_SIZE = 10;
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
   });

const settings = object({
   locale,
   site_title: nonEmpty,
   tagline: nullable(str),
   hero_title: nullable(str),
   hero_body: nullable(str),
   social: arrayOf(object({ kind: nonEmpty, url: httpsUrl })),
});

const alternates = arrayOf(object({ locale, slug: nonEmpty }));

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
});

const curated = object({
   id: int,
   kind: oneOf("video", "playlist", "channel"),
   ref_id: nonEmpty,
   title_override: nullable(str),
   snapshot: nullable(snapshot),
   sort: int,
});

/** Body checks per endpoint (www's response types). `cms` is the CMS's public origin. */
export function wwwSchemas(cms: string) {
   return {
      site: object({ settings: nullable(settings), nav: object({ header: arrayOf(object({ label: nonEmpty, url: navUrl })), footer: arrayOf(object({ label: nonEmpty, url: navUrl })) }) }),
      home: object({ settings: nullable(settings), videos: arrayOf(curated), posts: arrayOf(object(postSummary(cms))) }),
      page: object({ slug: nonEmpty, locale, title: nonEmpty, summary: nullable(str), body: str, seo_title: nullable(str), seo_description: nullable(str), cover: nullable(media(cms)), published_at: iso, updated_at: iso, alternates }),
      posts: object({ items: arrayOf(object(postSummary(cms))), page: int, limit: int, total: int }),
      post: object({ ...postSummary(cms), body: str, seo_title: nullable(str), seo_description: nullable(str), alternates }),
      videos: object({ items: arrayOf(curated) }),
      sitemap: object({ items: arrayOf(object({ type: oneOf("page", "post"), locale, slug: nonEmpty, updated_at: iso })) }),
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
   if (/^\/pages\/[^/]+$/.test(p)) return "page";
   if (/^\/posts\/[^/]+$/.test(p)) return "post";
   return null;
}
