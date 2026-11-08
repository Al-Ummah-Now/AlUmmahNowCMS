# CMS public read API — contract v1 (`/api/public/v1`)

Served by the CMS Worker (`al-ummah-now-cms[-qa|-stage]`). Consumed by www server-side through the
service binding `CMS` (`env.CMS.fetch("https://cms.internal/api/public/v1/...")`; the host is ignored
on a binding) or over HTTPS at `CMS_PUBLIC_URL`. Published rows only. JSON, UTF-8.
Headers: `Cache-Control: public, s-maxage=60, stale-while-revalidate=600`, plus `ETag`.
Errors: `{ "error": "not_found" | "bad_request", "message"?: string }` with 404 or 400.
`locale` is required where listed: `en` | `ar`; anything else → 400.

```ts
type Locale = 'en' | 'ar';

interface MediaRef { url: string; alt: string | null; width: number | null; height: number | null }
// url is absolute: `${CMS_PUBLIC_URL}/api/public/v1/media/<path>`

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
}

interface CuratedVideo {
  id: number;
  kind: 'video' | 'playlist' | 'channel';
  ref_id: string;               // videos-platform id
  title_override: string | null;
  snapshot: { title: string; thumbnail_url: string | null; channel_name: string | null } | null;
  sort: number;
}
```

| GET | Query | Response |
|---|---|---|
| `/site` | `locale` | `{ settings: SiteSettings \| null, nav: { header: NavItem[], footer: NavItem[] } }` |
| `/home` | `locale` | `{ settings: SiteSettings \| null, videos: CuratedVideo[], posts: PostSummary[] }` (videos: placement `home`, locale = l or `all`, by sort; posts: latest 3) |
| `/pages/:slug` | `locale` | `Page` or 404 |
| `/posts` | `locale`, `page` (1-based, default 1), `limit` (1–20, default 10) | `{ items: PostSummary[], page: number, limit: number, total: number }` newest first |
| `/posts/:slug` | `locale` | `Post` or 404 |
| `/videos` | `locale`, `placement` (`home` \| `videos`, default `videos`) | `{ items: CuratedVideo[] }` |
| `/sitemap` | — | `{ items: { type: 'page' \| 'post', locale: Locale, slug: string, updated_at: string }[] }` (pages with show_in_sitemap only) |
| `/media/*` | — | the R2 object, `Cache-Control: public, max-age=31536000, immutable` |

The page slug `home` is reserved (not used as a page route on www). An empty CMS returns empty
arrays and `settings: null`, never an error.
