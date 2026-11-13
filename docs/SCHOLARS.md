# Scholars: pages on www, articles and videos, editors feature

**Status:** v2, 2026-11-13: scholar content comes from community posts (§7, §8; wiki AUN-SCHOLAR-SITES
phase 1). §1–§4 describe v1 (writing in the CMS), which stays for posts not yet converted.
**v1:** 2026-11-10
**Owner decisions (2026-11-10):** articles are "a mix, scholar pages on main site, and editors feature
from there to main feed"; videos "same as above"; scholars write in the CMS, reached from the videos
studio through SSO, and see and edit only their own posts.
**Repos:** AlUmmahNowAuth (role), AlUmmahNowCMS (this: writer role, profiles, featuring, community
sync, public API), AlUmmahNowUI (www scholar pages), AlUmmahNow (api-videos internal endpoints,
community article posts, studio links, channel → scholar page link).

## 1. What happens

```
scholar signs in to the CMS (SSO) ──▶ role "writer", profile made (linked to the channels they own)
        │ writes, publishes (no approval)
        ▼
post (author_sub = their auth id) ──▶ live at /{l}/articles/{slug}/ on www, on /{l}/scholars/{slug}/,
        │                              in search, in the sitemap, and as a community post on their channel
        │ editor: "Feature on main site" (Featuring screen or the post's "Main site" card)
        ▼
featured_at set ──▶ also on the home timeline (KV feed) and the Articles list
```

Videos: a scholar's public videos are already on their channel; www shows them on the scholar page
(from the public videos API). An editor features one by adding it to the home timeline (the Featuring
screen's Videos tab, or "Search all videos").

## 2. The writer role

| Auth role | CMS role | May |
|---|---|---|
| Super Admin, Admin | `admin` | everything |
| Moderator | `editor` | all content, timeline, featuring; no deletes, no settings |
| **Scholar** (`role_scholar`, AlUmmahNowAuth 0029) | **`writer`** | create, edit, publish, unpublish, schedule and delete (soft) **their own posts**; media upload and the library; the video embed picker; AI assist (same per-user budget); their own profile |

The strongest role wins (a Scholar who is also a Moderator is an editor). A writer can't open pages,
navigation, site settings, the timeline, featuring, other scholars' profiles or anyone else's posts.

Enforcement, two layers (`src/lib/scholars/ownership.ts`):

1. **The wrapper** (`src/index.ts`) scopes every bknd API call a writer makes: posts lists and counts
   get `author_sub = <their id>` forced into the filter (a caller's `$or` is dropped), one post by id
   answers 404 unless it is theirs, and anything other than posts, media and the session is 403. The
   staff screens' own reads (`src/admin/data.ts`) add the same filter. A writer's screens and Worker
   endpoints are an allow-list (`src/lib/scholars/access.ts`).
2. **The content rules** (bknd mutator events) run on every insert and update however it is written:
   Worker-owned fields (`author_sub`, `featured_at`, `featured_by`, `community_post_id`) are stripped
   from every data API write; a writer's new post gets their `author_sub`; a writer's update of a post
   that isn't theirs throws (404); a writer can't switch "Show on home timeline".

Bylines: a scholar post's `author_name` in the public API is the scholar's name (in the post's
language), with `author: { slug, name, avatar }` added. Staff posts keep the free-text author.

## 3. Profiles

`scholars` (migrations/0013, Worker-only, never on bknd's data API): `sso_sub` (unique), `slug`
(unique, url), `name_en`/`name_ar`, `bio_en`/`bio_ar`, `avatar_media_id` (a library image),
`channel_ids` (JSON, ≤ 5).

- **Made at first sign-in** as a writer (`ensureScholar`, idempotent on `sso_sub`): name from the
  token (Arabic script → `name_ar`), else the account's public profile on the videos API by the
  platform rule (`src/lib/display-name.ts`: display name, else first + last; never the email), a free
  slug from the name or email, and every channel the user
  owns on the videos platform. If the videos API is down the sign-in still works; channels are linked
  later on the profile screen. An admin invite (videos admin "Invite creator", Scholar ticked) gives the
  role before the first sign-in; the profile then appears at that sign-in.
- **Edited** by the scholar (`/scholars/me`) and by admins and editors (`/scholars/:id`), with an
  optimistic lock on `updated_at`. An empty name field shows the account's name (display name, else first +
  last) as its placeholder and hint. Channels are checkboxes of the channels the scholar owns (asked from
  api-videos every time); a channel id that isn't theirs is refused (`not_your_channel`). No raw ids.
- **Deleted** by an admin: a soft delete into the trash (kind `scholars`), restorable for 30 days. The
  page leaves www; the posts stay published (without a byline link).

## 4. Community posts

Publishing also posts the article to the scholar's **first linked channel**'s Community tab:
title, excerpt (or the start of the body), cover and the www link (`src/lib/scholars/community.ts`).

- Every post change (save, publish, unpublish, schedule, delete, restore, a scheduled post going live)
  writes the wanted state into `community_links` (`want` show/hide, `state` pending). Nothing else: it
  never fails or slows a save.
- `syncCommunity` does the calls: right after a save (`waitUntil`) and every minute (cron). Each link
  is claimed first, so overlapping runs never double-post. Failures back off 1, 2, 4… minutes (≤ 6 h);
  after 8 failures, or a permanent refusal (not the owner, no channel), the link is `dead` and is tried
  again when the post next changes, or from `POST /admin/api/featuring/community/retry`.
- **Idempotent:** the community post is keyed by the CMS post (`cms-<id>`); api-videos keeps the
  mapping, so a re-publish updates the same post, and a channel change moves it. Its id is on
  `posts.community_post_id`. A post that never went out is never "hidden" (no call).
- **Service-to-service:** `X-API-Key` = api-videos' `INTERNAL_API_KEY` (Secrets Store, CMS binding
  `VIDEOS_INTERNAL_API_KEY`), always "on behalf of" one auth user id that api-videos checks against the
  channel's owner:

| Call (api-videos) | Body → answer |
|---|---|
| `GET /internal/scholars/:userId/channels` | → `{ channels: [{ id, name, handle, avatarUrl, isPublic }] }` (the ownership index) |
| `PUT /internal/scholars/:userId/articles/:externalId` | `{ channelId, title, excerpt, coverUrl, url, locale, publishedAt }` → `{ postId, channelId }` |
| `DELETE /internal/scholars/:userId/articles/:externalId` | → `{ hidden }` (404 = never posted) |

## 5. Featuring and the main site

`MAIN_SITE_SQL` (`src/lib/scholars/main-site.ts`) = `author_sub IS NULL OR featured_at IS NOT NULL`.
It applies to: the home timeline (KV feed source and the Timeline screen), `/posts` (Articles list),
`/home` latest posts, `/cards`, and "latest / by tag" post blocks. It does **not** apply to the post
itself, the scholar page, search, the sitemap or picked-post blocks.

- **Feature / unfeature an article** (admin, editor): the Featuring screen (Scholar articles tab: search
  with live suggestions, filters featured / not featured) or the "Main site" card in the post editor.
  `POST /admin/api/featuring/posts/:id { on }` sets `featured_at`/`featured_by` on the post **and its
  translations by the same scholar**, turns "Show on home timeline" back on, clears a pin on unfeature,
  marks the feed dirty and logs `feature` / `unfeature` in `timeline_changes` (who, when).
- **Feature a video**: Scholar videos tab (each scholar's first channel, latest public videos) or
  "Search all videos" (the picker), both the timeline's own `POST /admin/api/timeline/videos`; unfeature =
  `DELETE /admin/api/timeline/entries/:key` (soft, restorable), confirmed in an in-page dialog.
- After this ships, the KV feed's post summaries carry `author`: run "Rebuild everything" on the
  Timeline screen once per environment (the verifier only detects content drift, not shape changes).

## 6. Public API (additive)

See docs/PUBLIC_API.md "Scholars": `/scholars`, `/scholars/:slug`, `/scholars/by-channel/:channelId`,
`/search/scholars`, `author` on post summaries, `scholars` in `/sitemap`.

## 7. Tests

- Node: role mapping, the writer verdicts and filter scoping, the screen allow-list, profile
  validation and slugs, backoff (`test/node/scholars.test.ts`, `test/node/roles.test.ts`).
- Worker: sign-in makes the profile; ownership (lists, counts, `$or`, reads, edits, deletes, protected
  fields, staff screens); main-site rule and featuring with the audit log; translations featured
  together; community post on publish / edit / unpublish / delete, retry and no-channel; profiles,
  public scholar API, sitemap, soft delete and restore (`test/worker/scholars.test.ts`).
- E2E (QA): `e2e/scholars.spec.ts`: a scholar signs in, writes and publishes; the post is on the www
  scholar page and the channel's Community tab and not on the Articles list; an editor features it; it is
  on www's home and Articles.


## 7. v2: scholar posts are community posts (wiki AUN-SCHOLAR-SITES §6.3)

Owner decisions 2026-11-13: SS5 (one post format), SS6 (scholar content is fuelled by the primary
channel's community posts; www holds hidden references), SS8 (no opt-out: editors decide what to
feature). SS18 (scholars write only in Studio) and SS14 (keep GIF, add Link) follow the spec's
recommendations and still await the owner's explicit confirmation.

- **Primary channel:** `scholars.primary_channel_id` (migration 0019), the first linked channel. Saving
  the profile's channels sets it; the 30-minute cron fills it where missing.
- **One format:** `src/lib/post-schema.generated.ts`, vendored from AlUmmahNow
  `packages/shared-types/src/post-schema.ts` (`npm run sync:posts -- --ref <sha>`, `check:posts` in CI).
- **References:** rows in `posts` with `ref_post_id` (unique), `ref_channel_id`, `summary_json`
  (`src/lib/scholars/refs.ts`). `kind` is the community post's kind. `body` is empty: never a copy.
  A ref keeps its slug for life; title, kind, summary and dates follow the post.
- **The outbox:** api-videos' processor calls `PUT/DELETE /internal/refs/:postId` on every community post
  create, edit and delete (`src/routes/internal-refs.ts`, `X-API-Key` = the shared internal key). The
  CMS answers `ignored` for channels that are no scholar's primary channel, and for article mirrors not
  yet converted. A deleted or non-public post drafts its ref (www 404); publishing again restores it.
- **www:** lists, the timeline and search render refs from `summary_json`; `/posts/:slug` reads the
  community post from api-videos (`GET /internal/posts/:channelId/:postId`, Cache API 60 s). See
  docs/PUBLIC_API.md "Scholars". `FEED_FORMAT` 4.
- **Staff screens:** refs are not in the Posts list; opening one shows links to www and Studio. The
  Featuring screen's "Scholar posts" tab lists refs of every kind with Feature and Open in Studio.
- **Writers (SS18):** a writer's CMS home is **Write in Studio** (`/write`): links to their channel's
  composer and Community management on the videos site, their www page and their profile. The data API
  refuses their post writes; their old post screens redirect to `/write`.
- **Nightly check** (#1217, `src/lib/scholars/reconcile.ts`): at 03:00 UTC, for each scholar's primary
  channel (≤ 50), api-videos' digest of its newest ≤ 200 posts (`GET /internal/posts/:channelId`) is
  compared with that channel's refs (one indexed query, migration 0020). Missing or stale refs are
  re-synced, refs of posts that are gone or no longer public are drafted; ≤ 50 repairs a night. Any
  repair is logged as a warning (the outbox missed something).
- **The old sync** (`community_links`, §4) is retired per post once it is a reference (state
  `retired`): it never re-posts or hides a converted post.

## 8. Converting existing CMS scholar posts (wiki AUN-SCHOLAR-SITES §6.6)

`src/lib/scholars/convert.ts`, driven by `scripts/ops/convert-scholar-posts.ts` through
`POST /api/release/v1/scholar-conversion` (one-time D1 token, purpose `scholar-conversion`).

```bash
node --experimental-strip-types scripts/ops/convert-scholar-posts.ts --env qa              # plan (dry run)
node --experimental-strip-types scripts/ops/convert-scholar-posts.ts --env qa --apply      # convert, then check
node --experimental-strip-types scripts/ops/convert-scholar-posts.ts --env qa --check      # check only
# production: --apply --allow-production, only with the owner's go-ahead
```

- An article with a link-only mirror is upgraded **in place** on api-videos (same post id, likes,
  comments); cards posts and articles without a mirror become new community posts. Media is
  re-referenced (CMS media URLs), not copied.
- The CMS row becomes the reference with the **same slug**, locale, translation key, featuring,
  timeline and page entries; its original is kept as a content revision (actor
  `system:scholar-conversion`), the rollback copy.
- Skipped and reported: scheduled posts, scholars without a channel, posts whose scholar profile is gone.
- The check compares every converted post with its original: title, body hash (articles), card count
  (cards), www address, status, featured state, kind.
