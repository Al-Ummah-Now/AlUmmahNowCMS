# Soft delete and the 30-day cleanup

Owner rule: every delete made from the admin is a soft delete. A scheduled cleanup removes it for good
after 30 days, unless an admin promotes it to permanent deletion first. Promoting does not delete
anything on the spot. It queues the item for the cleanup's next run, and until that run the item can
still be restored. The cleanup is the only code that hard-deletes.

Code: `src/lib/trash.ts` (delete, restore, promote, purge), `src/admin/trash-api.ts` (routes),
`src/admin/screens/trash.tsx` + `src/admin/client/trash.ts` (the Recently deleted screen),
`migrations/0010_soft_delete.sql` (tables).

## How it works

- **Delete** moves the row out of its table and into `trash` in a single D1 batch. The trash row keeps
  the full row as JSON, plus `deleted_at`, `deleted_by`, `deleted_by_id` and an optional `reason`.
  Every reader queries the live tables: the public API, the sitemap, the home timeline build, and the
  staff lists that go through bknd. So the item disappears from all of them immediately, and no
  "hide deleted" filter can be forgotten. A deleted post also marks the home timeline dirty, and the
  KV build rewrites its week. Nothing outside D1 is removed: R2 originals, image variants and
  content history all stay.
  - A page's or post's cover goes to the trash with it (`parent_id`). It is hidden from the
    Recently deleted list and is restored and purged together with its page or post.
  - Replacing a cover (`?overwrite=true`) moves the old file to the trash (reason `replaced`). bknd
    then receives a plain upload, so it never deletes the old R2 file itself.
  - The image-variant jobs and sweep leave the variants of a trashed original alone.
- **Restore** (admin, in-app dialog) puts the row back under its original id. AUTOINCREMENT never
  reuses an id. The post's timeline entries are marked dirty, so the KV feed republishes it.
  Restore returns `409 conflict` if another item took the slug or the timeline video in the
  meantime. A restored cover whose slot has been filled since comes back as an unattached library
  image.
- **Delete permanently now** (admin, type-to-confirm dialog) sets `purge_requested_at` and
  `purge_requested_by`. The list then shows the item as "Queued for permanent deletion".
- **Cleanup** (`purgeDue`) runs on the CMS Worker's existing `*/30 * * * *` cron (wrangler.jsonc
  `triggers`, `scheduled()` in `src/index.ts`). Each run takes up to 25 items, either
  `deleted_at` older than 30 days or `purge_requested_at` set, with requested items first. For each
  item it:
  1. claims the item (`purging_at`), so a concurrent restore gets `409 purging`;
  2. removes everything external: the R2 original and variants of media; for pages and posts, the
     cover rows and files, `content_revisions`, and the post's `timeline_entries` override row;
  3. deletes the trash row.

  A failure releases the claim, records `purge_error` and `purge_attempts`, and the next run
  retries. A claim older than 10 minutes counts as abandoned and is taken over. Each run logs one
  `trash purge` line with counts per kind (`purged`, `failed`, `remaining`).
- **Audit**: `trash_events` records delete, restore, purge_requested, purged and purge_failed, with
  who and when. It is kept after the purge.

The 30 days are real on every environment (QA included). The cron needs no release change: the
trigger already existed, and `scripts/release/promote.ts` runs `wrangler triggers deploy` anyway.

Caches: the CMS Worker serves its own responses (custom domain, no Cache API), so there is no edge
cache to purge. Public API responses carry `s-maxage=60`, so a downstream cache holds a deleted item
for at most a minute. Media files are sent with a one-year immutable browser cache. A browser that
already downloaded a file keeps its copy, but the CMS returns 404 for it from the moment it is
deleted.

## Inventory: every admin delete

| Where (UI) | Endpoint | Before | Now |
| --- | --- | --- | --- |
| Page/post editor, Delete (`src/admin/screens/content.tsx` `data-delete`, `src/admin/client/editor.ts` 413) | `DELETE /api/data/entity/{pages,posts}/:id` (bknd) | bknd hard-deleted the row; cover row and file stayed orphaned | Soft: row and cover go to the trash (with an optional reason); the timeline is marked dirty |
| Editor, Remove cover (`content.tsx` `data-cover-remove`, `editor.ts` 481) | `DELETE /api/media/file/:path` (bknd) | R2 file and media row deleted, then variants (`src/index.ts` waitUntil) | Soft: the media row goes to the trash; file and variants kept |
| Editor, Replace cover (`editor.ts` upload) | `POST /api/media/entity/:e/:id/cover?overwrite=true` | bknd deleted the old R2 file; `keepNewestMedia` deleted the stale row and variants | The old cover goes to the trash (`replaced`) before the upload; bknd no longer gets `overwrite` |
| Navigation and Videos rows, Delete (`src/admin/screens/site.tsx` `data-row-delete`, `src/admin/client/rows.ts` 121) | `DELETE /api/data/entity/{nav_items,curated_videos}/:id` (bknd) | Hard delete | Soft (optional reason) |
| Library, Delete (`site.tsx` `data-media-delete`, `rows.ts` 372) | `DELETE /api/media/file/:path` (bknd) | R2 file, row and variants deleted | Soft (optional reason) |
| Home timeline, Remove video (`src/admin/screens/timeline.tsx` `data-remove="video"`, `src/admin/client/timeline.ts` 66) | `DELETE /admin/api/timeline/entries/v:id` (`src/admin/timeline-api.ts`) | `DELETE FROM timeline_entries`, then the KV rebuild | Soft: the entry goes to the trash and the KV is rebuilt without it; restore republishes it |
| Home timeline, Remove post | `POST /admin/api/timeline/posts/:id {on:false}` | Turns `show_on_timeline` off (not a delete) | Unchanged |
| bknd API, no UI: site settings, media via the data API | `DELETE /api/data/entity/{site_settings,media}/:id` | Hard delete | Soft |
| bknd API, no UI: bulk delete | `DELETE /api/data/entity/:entity` | Hard `deleteMany` | Refused (405) |
| bknd API, no UI: users and other entities | `DELETE /api/data/entity/users/:id` | Hard delete | Refused (405) |
| bknd API: config remove | `DELETE /api/system/config/remove/...` | Already blocked (`blockedApiPath`) | Unchanged |
| Automatic jobs (not admin deletes) | variant sweep, feed GC, AI job retention | — | Unchanged, except that the variant jobs skip trashed originals |
