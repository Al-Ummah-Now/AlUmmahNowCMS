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
                                // (for a page built from blocks: the blocks' text as markdown, for older readers)
  images: MediaRef[];           // CMS-10 (additive): CMS media used as `![alt](url)` in body, once each, in order; match by URL path
  seo_title: string | null; seo_description: string | null;
  cover: MediaRef | null;
  published_at: string;         // ISO 8601
  updated_at: string;
  alternates: Alternate[];      // other locales of the same translation_key (published only)
  blocks?: Block[];             // added: the page as blocks, in order (see "Blocks"); render these when present
}

interface PostSummary {
  slug: string; locale: Locale; title: string; excerpt: string | null;
  cover: MediaRef | null; author_name: string | null; tags: string[];
  published_at: string; updated_at: string;
  kind?: 'article' | 'cards';   // added; absent = article
  slide_count?: number;         // added; cards only (0 for articles)
  first_slide?: Slide | null;   // added; the card's face: its first slide (null for articles)
  slides?: Slide[];             // added; cards: the first ≤ 10 served slides, so a list can show the
                                // post whole without another read ([] for articles). slide_count counts all.
}
interface Post extends PostSummary {
  body: string; seo_title: string | null; seo_description: string | null; alternates: Alternate[];
  images: MediaRef[];           // as Page.images (CMS-10, additive)
  slides?: Slide[];             // added; cards: every served slide ([] for articles). body is the slides' text as markdown.
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
| `/cards` | `locale`, `tag` (optional), `page` (1-based, default 1), `limit` (1–24, default 12) | `{ items: PostSummary[], page: number, limit: number, total: number, tags: string[] }` card posts only, newest first; `tags` = every tag on this locale's live card posts (for the filter) |
| `/timeline` | `locale`, `limit` (1–40, default 20), `before` (cursor from `next`) | `{ pinned: TimelineItem[], items: TimelineItem[], next: string \| null }`: the home timeline (see "Timeline"); `pinned` only on the first page; bad `before` → 400 |
| `/search/suggest` | `locale` (or `lang`), `q`, `limit` (1–10, default 6) | `SearchHit[]`: the best few live posts for `q` (see "Search"); empty `q` → `[]` |
| `/search` | `locale` (or `lang`), `q`, `page`, `limit` (1–20, default 10) | `{ items: SearchHit[], page, limit, total }`: every match, best first |
| `/sitemap` | — | `{ items: { type: 'page' \| 'post', locale: Locale, slug: string, updated_at: string }[] }` (pages with show_in_sitemap only) |
| `/media/*` | — | the R2 object, `Cache-Control: public, max-age=31536000, immutable` |
| `/media/*` | `w` (1–1600), `f` (`avif` \| `webp` \| `jpeg` \| `png`) | the variant: `Content-Type` of `f`, immutable cache, `X-Variant: hit`. Not made yet: the **original**, `Cache-Control: public, max-age=60, s-maxage=60`, `X-Variant: pending`, and the job is queued. Malformed `w`/`f` → 400 |

The page slug `home` is reserved (not used as a page route on www). An empty CMS returns empty
arrays and `settings: null`, never an error.

## Timeline

The home timeline is managed on the CMS Timeline screen (docs/FEED.md). www reads it from Workers
KV, not from this endpoint. This endpoint serves the same items from D1 for other clients and checks.

```ts
interface TimelineItem {
  key: string;                  // "p<id>" (post) or "v<id>" (video entry)
  type: 'post' | 'video';
  date: string;                 // ISO; what it sorts by
  pinned: boolean;
  post?: PostSummary & { videos: { kind: 'video'; ref_id: string; snapshot: CuratedSnapshot | null }[] };  // ::video lines of the body (≤ 4)
  video?: { kind: 'video' | 'playlist'; ref_id: string; snapshot: CuratedSnapshot; title_override: string | null };
}
```

On it: live posts with "Show on home timeline" on (the default), and video entries for the locale
or both languages whose video is still public, minus hidden items. Pinned first (pin order). The
rest go newest first, ties `v` before `p`, then id descending. `next` is a cursor (`<ms>-<key>`),
so pages never shift when items are added.

## Search

`/search/suggest` feeds www's search-as-you-type box (called from the browser, CORS for
`WWW_ORIGINS`); `/search` feeds www's search page (server-side, service binding). Live posts only
(articles and card posts; never drafts, scheduled or unpublished rows).

```ts
interface SearchHit {
  id: number; type: 'article' | 'cards';
  title: string; slug: string; locale: Locale;
  href: string;                 // www path: /{locale}/articles/{slug}/
  thumbnailUrl: string | null;  // the cover (or a card post's first slide), 320 px WebP variant
  excerpt: string | null;
  publishedAt: string;          // ISO 8601
}
```

- **Matching.** The query and the posts (title; excerpt, tags and the first 10 000 normalised
  characters of the body) are normalised the same way (`src/lib/search/normalize.ts`, a port of the
  monorepo's `packages/shared-types/src/search/normalize.ts`): Arabic tashkeel, Quranic marks and
  tatweel removed, alef forms → ا, ى/ی → ي, ة → ه, ؤ → و, ئ → ي, standalone ء dropped,
  Arabic-Indic digits → 0-9, NFKC, lower case, Latin accents removed. Every query word (≤ 8, `q`
  cut at 100 characters) must match; a leading Arabic article is optional on both sides
  (الحديث ~ حديث). The newest 2000 live posts per locale are searched.
- **Ranking.** Title starts with the query > every word starts a title word > title contains it >
  excerpt/tags/body contain it; ties newest first.
- **Caching.** `Cache-Control: public, max-age=60, s-maxage=60`; answers are kept in the edge cache
  for 60 s by normalised query, and each isolate keeps its normalised posts for 60 s, so a change
  shows in search within about two minutes.
- **Limits.** Per IP (`SEARCH_LIMITER`, 120 uncached requests a minute): over it → 429
  `{ "error": "rate_limited" }`, `Retry-After: 60`, `no-store`. A request over the service binding
  carries no `CF-Connecting-IP`; www passes the visitor's IP as `X-Client-IP` instead.

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

## Preview API (not public) — `/api/preview/v1`

Draft preview on www (issue #9). **Not** part of the public API above: `/api/public/v1` still serves
published rows only, with or without a token. www calls this server-side through the same service
binding, never from a browser (no CORS headers).

| GET | Header | Response |
|---|---|---|
| `/api/preview/v1/:kind/:id` (`kind`: `pages` \| `posts`) | `Authorization: Bearer <token>` | `PreviewResponse`; 401 `{ error: 'invalid_token' \| 'expired_token' }`; 404 `{ error: 'not_found' }` (row deleted) |

```ts
interface PreviewResponse {
  kind: 'page' | 'post';
  id: number;
  status: 'draft' | 'scheduled' | 'published';   // scheduled: published with publish_at still ahead
  expires_at: string;            // ISO, when the token stops working
  edit_url: string;              // the row in the CMS editor
  content: Page | Post;          // exactly the public shapes above; alternates are published rows only;
                                 // published_at falls back to created_at for a never-published draft
}
```

Every response: `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow`,
`Referrer-Policy: no-referrer`.

**Tokens** (`src/lib/preview.ts`): `v1.<base64url(payload)>.<base64url(HMAC-SHA256)>`, payload
`{ k: 'pages' | 'posts', id, iat, exp }` (seconds), valid 30 minutes, bound to one row (a token for
another row or kind is `invalid_token`). Minted only by `GET /preview/:kind/:id` on the CMS, behind
the staff session gate (admin or editor; anyone else has no CMS session), which answers
`303 → {WWW_URL}/preview?token=…`. The HMAC key is derived from `BKND_JWT_SECRET`
(`HMAC-SHA256(BKND_JWT_SECRET, "al-ummah-now/cms/preview-token/v1")`): no extra secret, and a preview
signature can never stand in for a session one. Rotating `BKND_JWT_SECRET` ends open preview links.
www reads `k`/`id`/`exp` from the payload only to name its cookie; the CMS checks the signature on
every render, so a token can't be stretched or moved to another row.
## Blocks

A page is an ordered list of blocks. Every block has a stable `id` (`[a-z0-9-]`, unique in the page)
and a `type`. Text is in the page's own language (one row per locale; a translation starts as a copy).
References are resolved when the page is read: a block that is incomplete in the editor, or whose
images/posts/videos are all gone or no longer public, is **left out**, so www never renders an empty
frame. A page saved before blocks existed is served as `[{ id: "body", type: "markdown", text: body }]`.

```ts
type Block =
  | { id: string; type: 'markdown'; text: string }                           // same markdown rules as body
  | { id: string; type: 'image'; image: MediaRef; caption: string | null; size: 'content' | 'wide' }
  | { id: string; type: 'gallery'; columns: 2 | 3 | 4; items: { image: MediaRef; caption: string | null }[] }
  | { id: string; type: 'posts'; heading: string | null; mode: 'latest' | 'tag' | 'picked'; items: PostSummary[] }
  | { id: string; type: 'cards'; heading: string | null; tag: string | null; page_size: number; filter: boolean }
      // a grid of card posts: www reads GET /cards?locale&tag&page&limit=page_size; filter = show the tag filter
  | { id: string; type: 'videos'; heading: string | null; items: { kind: 'video' | 'playlist' | 'channel'; ref_id: string; title_override: string | null; snapshot: CuratedSnapshot | null }[] }
  | { id: string; type: 'video'; kind: 'video' | 'playlist'; ref_id: string; caption: string | null; snapshot: CuratedSnapshot | null }
  | { id: string; type: 'cta'; heading: string | null; text: string | null; label: string; url: string; tone: 'primary' | 'quiet' }
      // url: "/..." (www-relative, no locale prefix) or https://
  | { id: string; type: 'columns'; text: string; image: MediaRef | null; caption: string | null; image_side: 'start' | 'end' }
      // start/end are logical: the image is on the right in Arabic when image_side = start
  | { id: string; type: 'quote'; variant: 'quote' | 'callout'; text: string; cite: string | null }
  | { id: string; type: 'divider'; style: 'line' | 'space'; size: 's' | 'm' | 'l' };
```

- `image.alt` is the block's own description when set, else the library's; `null` = decorative.
- `posts`: `latest` and `tag` list live posts of the page's locale (at most 12); `picked` keeps the
  editor's order, follows a picked post to its translation in the page's locale, and drops posts that
  aren't live. Items may be card posts (`kind: 'cards'`).
- `videos`/`video` snapshots are taken when picked and refreshed by the CMS (every 2 h, with retry and
  backoff); an item no longer public is left out. Same `CuratedSnapshot` as curated videos.
- New block types may be added; www must skip a `type` it doesn't know.

## Card posts

A post with `kind: 'cards'` is a sequence of slides read one at a time: an image with text on it.

```ts
interface Slide {
  id: string;
  image: MediaRef;                // alt: the slide's description, else the library's
  heading: string | null;         // ≤ 140 chars, drawn on the image
  body: string | null;            // ≤ 400 chars, plain text, drawn on the image
  position: 'top' | 'middle' | 'bottom';   // where the text sits on the image
}
```

Slides without an image are not served. `slide_count`, `first_slide` and `slides` count only served slides.

Every summary (`GET /posts`, `/home`, `/cards`, `posts` blocks and the home timeline feed in Workers
KV, docs/FEED.md) carries `slides`: the first `SUMMARY_SLIDES_MAX` (10) served slides, each with its
image's `variants`. www renders the card viewer inline in lists from them; when `slide_count` is
larger it ends with a link to the post. `GET /posts/{slug}` carries every slide (at most 40).
For SEO, www uses the first slide's image as `og:image` and, when the post has no excerpt, its
heading/body as the description.
