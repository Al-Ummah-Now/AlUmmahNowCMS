# www home timeline (the feed)

www's home page is a timeline managed here. Staff edit it on the Timeline screen
(`/timeline`); the CMS publishes it to Workers KV and www reads it from there. www never calls
the CMS while it serves the home page.

## What is on it

- **Posts:** every live post of the locale (`status = 'published'` and `publish_at` empty or
  passed) whose **Show on home timeline** is on. It is on by default, and the post editor has the
  switch. Card posts are included. A scheduled post joins when it goes live.
- **Videos:** entries added on the Timeline screen from the video picker (videos and
  playlists), for `en`, `ar` or both (`all`). Their snapshot is in `video_snapshots`, refreshed
  by the cron. A video that is no longer public is left out.
- **Overrides:** an editor can hide any item (it stays listed for staff) or pin it. Pinned
  items come first, in pin order, and appear only there. Everything else is sorted by date: a
  post's `published_at`, or a video entry's date (by default the video's own upload date).
- **Who and when:** every change on the screen is written to `timeline_changes` (action, item,
  actor, time, before and after) and listed under "Recent changes". The post switch is a normal
  post save, so the post's history (#8) records it too. A list of entries has no document to
  restore, so it uses this log rather than revisions.

## KV layout

There is one namespace per env, `al-ummah-now-www-feed[-stage|-qa]`. It is bound as `FEED` here,
the only writer, and in www, which reads it. It is a separate namespace from www's
`CONTENT_SNAPSHOT` for three reasons: each namespace has a single writer, the feed can be emptied
and rebuilt on its own, and each binding has its own config check. Keys exist per locale `l`:

| Key | Holds | Written |
|---|---|---|
| `feed:{l}:head` | pinned items; the newest 40 unpinned items; for each of their weeks the current build, oldest item and next older week; the year index keys; the total | in place, **last** in every build, at most once per build and ≥ 1.1 s apart |
| `feed:{l}:w:{isoWeek}:{build}` | every unpinned item of one ISO week (UTC), newest first, plus `older` (the next older non-empty week and its build) | a new version when the week changes; the old version becomes a tombstone |
| `feed:{l}:y:{isoYear}:{build}` | that year's weeks (key, count, newest and oldest cursor), newest first. This is the fallback index. | a new version when one of its weeks changes |

- **Item:** `{ key: "p<id>" | "v<id>", type, date, pinned, post?: PostSummary & { videos }, video?: { kind, ref_id, snapshot, title_override } }`.
  `post.videos` holds the `::video[ID]` lines of the post body, at most 4, with their snapshots,
  so www can play them inline.
- **Order:** date descending. Ties go `v` before `p`, then id descending (`compareSort`).
- **Cursor:** `<ms>-<key>.<week>.<build>` is the last item shown plus the week version that holds
  the next older item. Paging is by cursor and never by offset, so an item added between two loads
  never shifts or repeats the next page.
- **Reads:**
  - The first page is **one** read: the head.
  - "Load more" is normally **one** read: the week the cursor names, then its `older` chain while
    the page is not full.
  - A superseded week version is overwritten with `{ moved: <build> }`, or `{ gone: true }` when
    the week emptied. A cursor in a cached page, or a stale pointer, follows `moved` (one more
    read) and never shows old items.
  - Tombstones are deleted after 7 days. Old year indexes are deleted after 15 minutes. After
    that, or when anything is unreadable, the reader walks the year index (head → year → weeks).
- **KV caching:** a key is never read before it exists, because every new version is written
  before anything names it. The only key that changes in place is the head, which always
  exists. A week key changes once, into its tombstone. Readers use `cacheTtl` 30 s for the head
  and 60 s for week and year keys. Eventual consistency is about 60 s, the same as the HTML edge
  cache.

`src/lib/feed/model.ts` is the layout and the reader. www's `src/lib/feed.ts` is a copy and must
stay in step with it.

## Rebuilds

A rebuild is queued, coalesced, idempotent, and costs O(changed weeks).

1. **Triggers.** Each trigger marks the items it touched as dirty in D1 `feed_dirty`:
   - post insert, update or delete through bknd (edit, publish, unpublish, schedule, restore,
     the switch) via `src/lib/feed/plugin.ts`;
   - the Timeline screen API;
   - the every-minute cron when a `publish_at` passes (`duePosts`);
   - the block or timeline video snapshot refresh when what www shows changed (`videoChanged`);
   - a cover's or card image's variants becoming ready (`mediaReady`).
2. **Wake-up.** One queue message is sent while none is pending (`feed_state.queued_at`), so a
   burst of edits becomes one rebuild.
3. **Build** (`runBuild`). The consumer runs with `max_concurrency 1`. It:
   - claims every dirty row;
   - finds the weeks the items left (`feed_items`) and entered;
   - rewrites only those weeks, plus a newer neighbour whose older week appeared or went;
   - rewrites the year indexes that changed;
   - writes the head last;
   - then turns superseded versions into tombstones.

   Content that did not change (same checksum) is not written. A new post costs four puts: its
   week, the year index, the head, and the old week's tombstone. That holds at 10,000 items
   (`test/worker/feed.test.ts`).
4. **Failures.** A failed build records the reason and retries with backoff (30 s up to 15 min).
   After 6 retries the message goes to the DLQ, and the DLQ consumer flags it on the Overview and
   the Timeline screen with the reason and a **Retry** button. The dirty rows stay until a build
   succeeds, and KV keeps the last good copy.
5. **Safety net.** Every 30 minutes `verifyFeed` compares each week's light signature (item keys
   and update times from D1) with what was published, and marks only the drifted weeks dirty.
   When the head is missing (for example after the namespace was emptied) it runs a full rebuild.
6. **Full rebuild** (admins, Timeline screen) is for disaster recovery only. It marks every week
   dirty and builds them in runs of 40 weeks, showing progress on the screen.

Queues: `al-ummah-now-cms-feed[-stage|-qa]` (batch 100, max concurrency 1, 6 retries) and
`al-ummah-now-cms-feed-dlq[-stage|-qa]`. `scripts/release/queue-consumers.ts` registers both
after each stage or production promote, because `versions upload` never does.
