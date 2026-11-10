# CMS public read API — contract v1 (`/api/public/v1`)

Served by the CMS Worker (`al-ummah-now-cms[-qa|-stage]`). Consumed by www server-side through the
service binding `CMS` (`env.CMS.fetch("https://cms.internal/api/public/v1/...")`; the host is ignored
on a binding) or over HTTPS at `CMS_PUBLIC_URL`. Published rows only; a scheduled page or post (`publish_at`
still ahead) is not published yet and is absent everywhere (404, lists, alternates, sitemap) until its time,
then appears with `published_at` = the scheduled time. No field was added. JSON, UTF-8.
Headers: `Cache-Control: public, s-maxage=60, stale-while-revalidate=600`, plus `ETag`.
Errors: `{ "error": "not_found" | "bad_request", "message"?: string }` with 404 or 400.
`locale` is required where listed: `en` | `ar`; anything else → 400.

```ts
type Locale = 'en' | 'ar';

interface MediaRef {
  url: string; alt: string | null;
  width: number | null; height: number | null;   // as displayed (EXIF orientation applied) once the variant job has read the file
  variants: MediaVariants | null;                 // added in CMS-10 (additive); null until the original's width is known
}
// url is absolute: `${CMS_PUBLIC_URL}/api/public/v1/media/<path>`

// Resized copies (see "Image variants" below). Each string is a ready `srcset`:
// "<url>?w=320&f=avif 320w, <url>?w=640&f=avif 640w, …".
interface MediaVariants {
  widths: number[];                         // ascending: 320, 640, 960, 1280, 1600 below the original's width, plus its own width (≤ 1600)
  fallback_type: 'image/jpeg' | 'image/png'; // PNG originals fall back to PNG (transparency); all others to JPEG
  avif: string; webp: string; fallback: string;
}

interface NavItem { label: string; url: string }   // url: relative "/..." (www-relative, no locale prefix) or absolute https

interface SiteSettings {
  locale: Locale;
  site_title: string; tagline: string | null;
  hero_title: string | null; hero_body: string | null;
  social: { kind: string; url: string }[];
}

interface Alternate { locale: Locale; slug: string }

interface Page {
  slug: string; locale: Locale; title: string; summary: string | null;
  body: string;                 // markdown, HTML must be ignored by the renderer; may contain ::video[ID] lines
  images: MediaRef[];           // CMS-10 (additive): CMS media used as `![alt](url)` in body, once each, in order; match by URL path
  seo_title: string | null; seo_description: string | null;
  cover: MediaRef | null;
  published_at: string;         // ISO 8601
  updated_at: string;
  alternates: Alternate[];      // other locales of the same translation_key (published only)
}

interface PostSummary {
  slug: string; locale: Locale; title: string; excerpt: string | null;
  cover: MediaRef | null; author_name: string | null; tags: string[];
  published_at: string; updated_at: string;
}
interface Post extends PostSummary {
  body: string; seo_title: string | null; seo_description: string | null; alternates: Alternate[];
  images: MediaRef[];           // as Page.images (CMS-10, additive)
}

interface CuratedVideo {
  id: number;
  kind: 'video' | 'playlist' | 'channel';
  ref_id: string;               // videos-platform id
  title_override: string | null;
  snapshot: CuratedSnapshot | null;
  sort: number;
}

// Taken by the picker and refreshed by the CMS every 30 minutes (src/lib/snapshots.ts), so www can
// render a curated item without calling the videos API. Fields after channel_name are present only
// once a row has been refreshed (refreshed_at set). Rows the refresh finds no longer public are
// not served at all.
interface CuratedSnapshot {
  title: string; thumbnail_url: string | null; channel_name: string | null;
  refreshed_at?: string;          // ISO; thumbnail_url is a signed URL valid ≥ 6 h after this
  handle?: string | null;         // channels
  description?: string | null;
  titles?: { en?: string; ar?: string }; descriptions?: { en?: string; ar?: string };
  duration_seconds?: number | null; upload_date?: string | null; video_count?: number | null;
}
```

| GET | Query | Response |
|---|---|---|
| `/site` | `locale` | `{ settings: SiteSettings \| null, nav: { header: NavItem[], footer: NavItem[] } }` |
| `/home` | `locale` | `{ settings: SiteSettings \| null, videos: CuratedVideo[], posts: PostSummary[] }` (videos: placement `home`, locale = l or `all`, by sort, at most 48; posts: latest 3) |
| `/pages/:slug` | `locale` | `Page` or 404 |
| `/posts` | `locale`, `page` (1-based, default 1), `limit` (1–20, default 10) | `{ items: PostSummary[], page: number, limit: number, total: number }` newest first |
| `/posts/:slug` | `locale` | `Post` or 404 |
| `/videos` | `locale`, `placement` (`home` \| `videos`, default `videos`) | `{ items: CuratedVideo[] }` (by sort, at most 48) |
| `/sitemap` | — | `{ items: { type: 'page' \| 'post', locale: Locale, slug: string, updated_at: string }[] }` (pages with show_in_sitemap only) |
| `/media/*` | — | the R2 object, `Cache-Control: public, max-age=31536000, immutable` |
| `/media/*` | `w` (1–1600), `f` (`avif` \| `webp` \| `jpeg` \| `png`) | the variant: `Content-Type` of `f`, immutable cache, `X-Variant: hit`. Not made yet: the **original**, `Cache-Control: public, max-age=60, s-maxage=60`, `X-Variant: pending`, and the job is queued. Malformed `w`/`f` → 400 |

The page slug `home` is reserved (not used as a page route on www). An empty CMS returns empty
arrays and `settings: null`, never an error.

## Image variants (CMS-10)

Originals are stored and served exactly as uploaded (never overwritten, CMS-1). Resized copies are
derived from them by a **queued job** and kept in R2 under `_variants/v1/<path>/<width>.<ext>`:
AVIF, WebP and a fallback (JPEG, or PNG for PNG originals) at each of `MediaVariants.widths`. No
image is ever resized inside a request.

- **Where it runs:** the CMS Worker's own queue consumer (`al-ummah-now-cms-variants[-stage|-qa]`,
  DLQ `al-ummah-now-cms-variants-dlq[-stage|-qa]`), with Squoosh's codecs compiled to WASM
  (mozjpeg, libwebp, libavif via `@jsquash/*`) and PNG/resizing in JS. Cloudflare Image
  Transformations (`/cdn-cgi/image/`, `cf.image`) are **not enabled** on the zone (Free plan)
  and Cloudflare Images is a separate paid product, so neither is used.
- **When:** right after an upload; on the first request for a variant that does not exist; and by
  the 30-minute cron, which also backfills older media, resends lost jobs and removes the
  variants of deleted originals. Deleting an original deletes its variants at once.
- **Retries / failures:** a failing job is retried with exponential backoff (30 s → 30 min, 5
  attempts); then, or at once for a permanent reason (too large: over 16 MP, 8 MP for AVIF;
  undecodable), the original is flagged to staff: the Library card says "Sizes not made" with
  the reason and a Retry, and the Overview shows how many failed. Such originals keep being
  served as uploaded.
- **For www:** use `variants` in a `<picture>`: `<source type="image/avif" srcset=avif>`,
  `<source type="image/webp" srcset=webp>`, `<img srcset=fallback src=url width height>`, with a
  `sizes` that matches the layout. Until a variant is made its URL returns the original (correct,
  just larger) with a 60-second cache, so pages never break while jobs run.
