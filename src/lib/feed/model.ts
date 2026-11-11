/**
 * The home timeline as published to Workers KV (docs/FEED.md). Pure: no bindings, no I/O, so the
 * layout, ordering and paging rules are unit-tested here and www carries the same reader
 * (AlUmmahNowUI src/lib/feed.ts).
 *
 * Keys (namespace FEED, per locale l = en | ar):
 *   feed:{l}:head                  HeadDoc: the pointer AND the first page (pinned items, the newest
 *                                  HEAD_SIZE unpinned items, where those items' weeks live, and the
 *                                  year index keys). The only key rewritten in place; written last.
 *   feed:{l}:y:{isoYear}:{build}   YearDoc: that ISO year's weeks, newest first (the fallback index).
 *   feed:{l}:w:{isoWeek}:{build}   WeekDoc: every unpinned item of one ISO week (UTC), newest first,
 *                                  and `older`: the next older non-empty week (week + build).
 * Week and year keys are versioned: a new version is written before anything names it (KV caches
 * misses), so no key is read before it exists.
 *
 * Load more is normally ONE read. The cursor carries the item's position AND the week to read next
 * ("<ms>-<key>.<week>.<build>"); that week's `older` pointer continues the walk. When a week is
 * superseded its old version is overwritten with a small tombstone ({ moved: <build> } or
 * { gone: true }), so a pointer or a cursor in a cached page never shows stale items: it follows the
 * tombstone (one more read). Tombstones are deleted after TOMBSTONE_MS; a cursor older than that
 * (or any unreadable key) falls back to the year index walk.
 *
 * Order: newest first by date, ties by type ("v" before "p") then id, both descending. The next
 * page is everything strictly older than the cursor, so items added meanwhile never shift or repeat
 * what comes next.
 */

export type FeedLocale = "en" | "ar";
export const FEED_LOCALES: readonly FeedLocale[] = ["en", "ar"];

/** Items in a first page and in each "Load more". */
export const PAGE_SIZE = 20;
/** Unpinned items copied into the head: the first page plus one load-more page. */
export const HEAD_SIZE = 40;
/** Superseded year keys: deleted after this (an edge may still hold the head naming them). */
export const GC_DELAY_MS = 15 * 60_000;
/** Week tombstones live this long, longer than any HTML edge cache, so cached cursors still resolve. */
export const TOMBSTONE_MS = 7 * 86_400_000;
/** Videos from a post body carried by its feed item (the feed shows at most this many). */
export const MAX_POST_VIDEOS = 4;
export const FEED_VERSION = 1;

export interface FeedVideo {
   /** A channel's snapshot also carries `latest` (its newest public videos, at most 3). */
   kind: "video" | "playlist" | "channel";
   ref_id: string;
   /** The public CuratedSnapshot shape (docs/PUBLIC_API.md); null when not looked up yet. */
   snapshot: Record<string, unknown> | null;
}

export interface FeedItem {
   /** "p<postId>" or "v<entryId>". */
   key: string;
   type: "post" | "video";
   /** ISO date the item sorts by (a post's published_at; a video entry's date). */
   date: string;
   pinned: boolean;
   /** type "post": the public PostSummary, plus the videos embedded in its body. */
   post?: Record<string, unknown> & { videos: FeedVideo[] };
   /** type "video": the video, with the editor's title override. */
   video?: FeedVideo & { title_override: string | null };
}

/** A week version: what a pointer or a cursor names. */
export interface WeekPtr {
   week: string;
   build: string;
}

export interface YearRef {
   year: number;
   key: string;
   count: number;
   /** Cursor of the year's oldest item: the index walk skips years wholly newer than its cursor. */
   oldest: string;
}

/** A week holding head items: its current version, its oldest item, and the next older week. */
export interface HeadWeek extends WeekPtr {
   oldest: string;
   older: WeekPtr | null;
}

export interface HeadDoc {
   v: number;
   /**
    * The feed FORMAT every week and this head were fully rebuilt with (src/lib/feed/format.ts; absent
    * on heads written before formats existed). Additive: www's reader ignores it.
    */
   format?: number;
   locale: FeedLocale;
   build: string;
   built_at: string;
   page_size: number;
   pinned: FeedItem[];
   items: FeedItem[];
   /** Unpinned items exist beyond `items` (in the week buckets). */
   more: boolean;
   total: number;
   /** The weeks of `items`, newest first. */
   weeks: HeadWeek[];
   years: YearRef[];
}

export interface WeekRef {
   week: string;
   key: string;
   count: number;
   /** Cursors of the week's newest and oldest item. */
   newest: string;
   oldest: string;
}

export interface YearDoc {
   v: number;
   year: number;
   weeks: WeekRef[];
}

export interface WeekDoc {
   v: number;
   week: string;
   build: string;
   items: FeedItem[];
   older: WeekPtr | null;
}

/** What a superseded week version becomes. */
export interface WeekTombstone {
   v: number;
   week: string;
   moved?: string;
   gone?: true;
}

export const headKey = (l: FeedLocale) => `feed:${l}:head`;
export const yearKey = (l: FeedLocale, year: number, build: string) => `feed:${l}:y:${year}:${build}`;
export const weekKey = (l: FeedLocale, week: string, build: string) => `feed:${l}:w:${week}:${build}`;

/* ISO weeks (UTC) */

const DAY = 86_400_000;

/** ISO 8601 week of a date, in UTC: "2026-W46". Week 1 holds the year's first Thursday. */
export function isoWeek(date: string | number | Date): string {
   const d = new Date(typeof date === "object" ? date.getTime() : date);
   if (Number.isNaN(d.getTime())) throw new Error("bad date");
   const day = (d.getUTCDay() + 6) % 7; // Monday = 0
   const thursday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3);
   const year = new Date(thursday).getUTCFullYear();
   const jan4 = Date.UTC(year, 0, 4);
   const monday1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
   const week = 1 + Math.floor((thursday - monday1) / (7 * DAY));
   return `${year}-W${String(week).padStart(2, "0")}`;
}

const WEEK = /^(\d{4})-W(\d{2})$/;

/** [start, end) of an ISO week as ISO strings (Monday 00:00 UTC to the next Monday). */
export function weekRange(week: string): [string, string] {
   const m = WEEK.exec(week);
   if (!m) throw new Error(`bad week ${week}`);
   const year = Number(m[1]);
   const jan4 = Date.UTC(year, 0, 4);
   const monday1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
   const start = monday1 + (Number(m[2]) - 1) * 7 * DAY;
   return [new Date(start).toISOString(), new Date(start + 7 * DAY).toISOString()];
}

export const weekYear = (week: string): number => Number(week.slice(0, 4));

/* Ordering and cursors */

const KEY = /^([pv])(\d{1,12})$/;

function keyParts(key: string): [number, number] {
   const m = KEY.exec(key);
   if (!m) throw new Error(`bad item key ${key}`);
   return [m[1] === "v" ? 1 : 0, Number(m[2])];
}

/** < 0 when a sorts before b (a is newer). */
export function compareSort(aMs: number, aKey: string, bMs: number, bKey: string): number {
   if (aMs !== bMs) return bMs - aMs;
   const [at, ai] = keyParts(aKey);
   const [bt, bi] = keyParts(bKey);
   return at !== bt ? bt - at : bi - ai;
}

export const compareItems = (a: FeedItem, b: FeedItem) => compareSort(Date.parse(a.date), a.key, Date.parse(b.date), b.key);

/** An item's position ("<ms>-<key>"): also each week's newest/oldest in the year index. */
export const cursorOf = (item: Pick<FeedItem, "date" | "key">) => `${Date.parse(item.date)}-${item.key}`;

export interface Cursor {
   ms: number;
   key: string;
   /** Where the next older item lives (absent in a position-only cursor: walk the index). */
   next?: WeekPtr;
}

const CURSOR = /^(\d{1,15})-([pv]\d{1,12})(?:\.(\d{4}-W\d{2})\.([a-z0-9]{1,32}))?$/;

/** A load-more cursor: the last item shown and where the next older one lives. */
export const formatCursor = (item: Pick<FeedItem, "date" | "key">, next: WeekPtr | null) =>
   next ? `${cursorOf(item)}.${next.week}.${next.build}` : cursorOf(item);

export function parseCursor(raw: string | null | undefined): Cursor | null {
   const m = raw ? CURSOR.exec(raw) : null;
   if (!m) return null;
   return { ms: Number(m[1]), key: m[2], ...(m[3] && m[4] ? { next: { week: m[3], build: m[4] } } : {}) };
}

/** The item comes after (is older than) the cursor. */
export function isOlder(item: Pick<FeedItem, "date" | "key">, cursor: { ms: number; key: string }): boolean {
   return compareSort(Date.parse(item.date), item.key, cursor.ms, cursor.key) > 0;
}

const positionOlder = (pos: string, cursor: { ms: number; key: string }) => {
   const p = parseCursor(pos);
   return !p || isOlder({ date: new Date(p.ms).toISOString(), key: p.key }, cursor);
};

/* Checksums: FNV-1a, two seeds, 16 hex chars. Only for change detection, not security. */

export function checksum(text: string): string {
   let a = 0x811c9dc5;
   let b = 0x01000193 ^ 0x5bd1e995;
   for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193) >>> 0;
      b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
   }
   return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/* Reading: the same walk www does. */

export type KvGet = (key: string, kind: "head" | "year" | "week") => Promise<unknown>;

export interface FeedPage {
   pinned: FeedItem[];
   items: FeedItem[];
   /** Cursor for "Load more"; null at the end. */
   next: string | null;
   /** KV reads this page took. */
   reads: number;
   /** "head" | "pointer" (the cursor's week, following `older`) | "index" (fallback walk). */
   via: "head" | "pointer" | "index";
}

const isHead = (v: unknown): v is HeadDoc => !!v && typeof v === "object" && (v as HeadDoc).v === FEED_VERSION && Array.isArray((v as HeadDoc).items) && Array.isArray((v as HeadDoc).years);
const isWeek = (v: unknown): v is WeekDoc => !!v && typeof v === "object" && Array.isArray((v as WeekDoc).items) && typeof (v as WeekDoc).week === "string";

/** Where the item after `item` lives, given the week it is in. */
function nextPtr(item: FeedItem, week: { week: string; build: string; oldest: string; older: WeekPtr | null }): WeekPtr | null {
   return cursorOf(item) === week.oldest ? week.older : { week: week.week, build: week.build };
}

/**
 * One page. No cursor: pinned + the newest `size` items, from the head alone (one read). With a
 * cursor: the `size` items strictly older than it, read from the week the cursor names and on
 * through `older` pointers (normally one read); a tombstone is followed; anything missing falls back
 * to the year index walk. Throws when the head is missing or unreadable.
 */
export async function readPage(get: KvGet, locale: FeedLocale, before: string | null, size = PAGE_SIZE): Promise<FeedPage> {
   const cursor = parseCursor(before);
   if (!cursor) {
      const head = await get(headKey(locale), "head");
      if (!isHead(head)) throw new Error("feed head missing");
      const items = head.items.slice(0, size);
      const last = items[items.length - 1];
      let next: string | null = null;
      if (last && (head.items.length > size || head.more)) {
         const w = head.weeks.find((x) => x.week === isoWeek(last.date));
         next = formatCursor(last, w ? nextPtr(last, w) : null);
      }
      return { pinned: head.pinned, items, next, reads: 1, via: "head" };
   }
   let reads = 0;
   const read = async (key: string, kind: "head" | "year" | "week") => {
      reads++;
      return get(key, kind);
   };
   if (cursor.next) {
      const viaPointer = await walkPointers(read, locale, cursor, size);
      if (viaPointer) return { pinned: [], ...viaPointer, reads, via: "pointer" };
   }
   return { pinned: [], ...(await walkIndex(read, locale, cursor, size)), reads, via: "index" };
}

/** Reads a week version, following one tombstone; null when it (or its successor) is gone. */
async function readWeek(read: KvGet, locale: FeedLocale, ptr: WeekPtr): Promise<WeekDoc | null> {
   let doc = await read(weekKey(locale, ptr.week, ptr.build), "week");
   const moved = doc && typeof doc === "object" ? (doc as WeekTombstone).moved : undefined;
   if (moved) doc = await read(weekKey(locale, ptr.week, moved), "week");
   return isWeek(doc) ? doc : null;
}

async function walkPointers(read: KvGet, locale: FeedLocale, cursor: Cursor, size: number): Promise<{ items: FeedItem[]; next: string | null } | null> {
   const out: FeedItem[] = [];
   let ptr: WeekPtr | null = cursor.next!;
   let lastWeek: WeekDoc | null = null;
   for (let hops = 0; ptr && out.length < size && hops < 60; hops++) {
      const doc = await readWeek(read, locale, ptr);
      if (!doc) return null;
      lastWeek = doc;
      for (const it of doc.items) if (isOlder(it, cursor) && out.length < size) out.push(it);
      ptr = doc.older;
   }
   if (!out.length) return { items: [], next: null };
   const last = out[out.length - 1];
   const w = lastWeek!;
   const lastIsInLastWeek = w.items.some((x) => x.key === last.key);
   const oldest = w.items.length ? cursorOf(w.items[w.items.length - 1]) : "";
   const after = lastIsInLastWeek ? nextPtr(last, { week: w.week, build: w.build, oldest, older: w.older }) : null;
   return { items: out, next: after ? formatCursor(last, after) : null };
}

/** The fallback: head → year indexes → weeks, skipping years and weeks wholly newer than the cursor. */
async function walkIndex(read: KvGet, locale: FeedLocale, cursor: Cursor, size: number): Promise<{ items: FeedItem[]; next: string | null }> {
   const head = await read(headKey(locale), "head");
   if (!isHead(head)) throw new Error("feed head missing");
   const out: FeedItem[] = [];
   let lastWeek: (WeekRef & { build: string; older: WeekPtr | null }) | null = null;
   for (const y of head.years) {
      if (out.length > size) break;
      if (!positionOlder(y.oldest, cursor)) continue;
      const year = (await read(y.key, "year")) as YearDoc | null;
      if (!year || !Array.isArray(year.weeks)) throw new Error(`feed year ${y.year} missing`);
      for (const w of year.weeks) {
         if (out.length > size) break;
         if (!positionOlder(w.oldest, cursor)) continue;
         const doc = (await read(w.key, "week")) as WeekDoc | null;
         if (!isWeek(doc)) throw new Error(`feed week ${w.week} missing`);
         for (const it of doc.items) if (isOlder(it, cursor)) out.push(it);
         lastWeek = { ...w, build: doc.build, older: doc.older };
      }
   }
   out.sort(compareItems);
   const items = out.slice(0, size);
   if (out.length <= size || !items.length) return { items, next: null };
   const last = items[items.length - 1];
   // The last item's week is the last one read unless the page ended in an earlier one.
   const inLast = lastWeek && isoWeek(last.date) === lastWeek.week;
   const next = inLast ? nextPtr(last, { week: lastWeek!.week, build: lastWeek!.build, oldest: lastWeek!.oldest, older: lastWeek!.older }) : null;
   return { items, next: formatCursor(last, next) };
}
