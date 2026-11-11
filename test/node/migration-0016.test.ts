/**
 * Migration 0017 (docs/specs/WWW-PAGES.md §7) on a database shaped like QA and production on 2026-11-11:
 * dead curated rows go to the trash (restorable), orphan post overrides are purged (a trashed post keeps
 * its row), published live curated home videos join the home timeline (an existing entry wins), the CMS
 * video library is filled once per video, drafts are left alone, and /videos and /articles become filter
 * pages unless the slug is taken.
 */
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { destructiveStatements } from "../../scripts/migration-guard.ts";

const dir = new URL("../../migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = (name: string) => readFileSync(new URL(name, dir), "utf8");
const NAME = "0016_www_pages.sql";
const AT = "2026-11-08T12:28:26.000Z";
const snap = (title: string, pub: boolean) => JSON.stringify({ title, thumbnail_url: null, channel_name: "Ch", public: pub, refreshed_at: AT });

type Row = Record<string, unknown>;

function migrated(seed: (db: DatabaseSync) => void = () => {}) {
   const db = new DatabaseSync(":memory:");
   for (const f of files.filter((x) => x < "0016")) db.exec(sql(f));
   const cv = db.prepare("INSERT INTO curated_videos (id, kind, ref_id, placement, locale, status, snapshot, sort, created_at, updated_at) VALUES (?, ?, ?, ?, 'all', ?, ?, 0, ?, ?)");
   // QA: 3 dead home rows, 2 dead /videos rows (same refs), 1 live channel on /videos.
   cv.run(1, "video", "dead1", "home", "published", snap("Dead 1", false), AT, AT);
   cv.run(2, "video", "dead2", "home", "published", snap("Dead 2", false), AT, AT);
   cv.run(3, "video", "dead3", "home", "published", snap("Dead 3", false), AT, AT);
   cv.run(4, "video", "dead1", "videos", "published", snap("Dead 1", false), AT, AT);
   cv.run(5, "video", "dead2", "videos", "published", snap("Dead 2", false), AT, AT);
   cv.run(6, "channel", "chan1", "videos", "published", snap("Channel", true), AT, AT);
   // Prod-like: two live home videos (one also a /videos draft), and one already on the timeline.
   cv.run(7, "video", "live1", "home", "published", snap("Live 1", true), "2026-11-10T13:30:55.276Z", AT);
   cv.run(8, "video", "live2", "home", "published", snap("Live 2", true), "2026-11-11T20:40:05.791Z", AT);
   cv.run(9, "video", "live2", "videos", "draft", snap("Live 2", true), AT, AT);
   cv.run(10, "video", "draftonly", "videos", "draft", snap("Draft", true), AT, AT);
   db.prepare("INSERT INTO posts (id, slug, locale, title, body, status, tags) VALUES (1, 'p', 'en', 'P', 'B', 'published', '[]')").run();
   const te = db.prepare("INSERT INTO timeline_entries (kind, post_id, video_kind, ref_id, locale, entry_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
   te.run("post", 1, null, null, null, null, AT, AT); // a live post's override: kept
   te.run("post", 777, null, null, null, null, AT, AT); // orphan: purged
   te.run("post", 778, null, null, null, null, AT, AT); // its post is in the trash: kept
   te.run("video", null, "video", "live2", "en", "2026-01-01T00:00:00.000Z", AT, AT); // existing entry wins over curated row 8
   db.prepare("INSERT INTO trash (kind, item_id, data, deleted_at) VALUES ('posts', 778, '{}', ?)").run(AT);
   seed(db);
   db.exec(sql(NAME));
   return db;
}

describe("migration 0016_www_pages", () => {
   it("follows 0015 and only rewrites the two allowed tables", () => {
      expect(files[files.indexOf(NAME) - 1]).toMatch(/^0015_/);
      expect(destructiveStatements(NAME, sql(NAME))).toEqual([]);
   });

   it("moves dead curated rows to the trash, restorable, with an event each", () => {
      const db = migrated();
      const trashed = db.prepare("SELECT item_id, label, reason, deleted_by, data FROM trash WHERE kind = 'curated_videos' ORDER BY item_id").all() as Row[];
      expect(trashed.map((r) => r.item_id)).toEqual([1, 2, 3, 4, 5]);
      expect(trashed[0]).toMatchObject({ label: "Dead 1", deleted_by: "system/migration-0016", reason: "Not public on the videos site (www pages migration)" });
      expect(JSON.parse(String(trashed[0].data))).toMatchObject({ id: 1, kind: "video", ref_id: "dead1", placement: "home", status: "published" });
      expect((db.prepare("SELECT id FROM curated_videos ORDER BY id").all() as Row[]).map((r) => r.id)).toEqual([6, 7, 8, 9, 10]);
      expect(db.prepare("SELECT count(*) AS n FROM trash_events WHERE kind = 'curated_videos' AND action = 'delete'").get()).toEqual({ n: 5 });
   });

   it("purges orphan post overrides but keeps a trashed post's", () => {
      const db = migrated();
      const posts = (db.prepare("SELECT post_id FROM timeline_entries WHERE kind = 'post' ORDER BY post_id").all() as Row[]).map((r) => r.post_id);
      expect(posts).toEqual([1, 778]);
   });

   it("adds live curated home videos to the home timeline (an existing entry wins), logged", () => {
      const db = migrated();
      const videos = db.prepare("SELECT ref_id, locale, entry_date, created_by FROM timeline_entries WHERE kind = 'video' ORDER BY ref_id, locale").all() as Row[];
      expect(videos).toEqual([
         { ref_id: "live1", locale: "all", entry_date: "2026-11-10T13:30:55.276Z", created_by: "system/migration-0016" },
         { ref_id: "live2", locale: "en", entry_date: "2026-01-01T00:00:00.000Z", created_by: null },
      ]);
      expect(db.prepare("SELECT action, entry_kind, actor_email FROM timeline_changes").all()).toEqual([{ action: "add", entry_kind: "video", actor_email: "system/migration-0016" }]);
      expect(db.prepare("SELECT kind, ref_id FROM video_snapshots WHERE ref_id = 'live1'").get()).toEqual({ kind: "video", ref_id: "live1" });
   });

   it("fills the library once per video: live published rows and home entries, never dead rows or drafts", () => {
      const db = migrated();
      const lib = db.prepare("SELECT kind, ref_id, locale, added_at, added_from FROM cms_videos ORDER BY ref_id").all() as Row[];
      expect(lib).toEqual([
         { kind: "channel", ref_id: "chan1", locale: "all", added_at: AT, added_from: "migration-0016" },
         { kind: "video", ref_id: "live1", locale: "all", added_at: "2026-11-10T13:30:55.276Z", added_from: "migration-0016" },
         // curated 'all' + timeline 'en' disagree → all; earliest source date
         { kind: "video", ref_id: "live2", locale: "all", added_at: AT, added_from: "migration-0016" },
      ]);
      expect(() => db.prepare("INSERT INTO cms_videos (kind, ref_id, added_at, created_at, updated_at) VALUES ('video', 'live1', ?, ?, ?)").run(AT, AT, AT)).toThrow(/UNIQUE/);
   });

   it("seeds /videos and /articles as filter pages, leaving a taken slug as it is", () => {
      const db = migrated((d) => d.prepare("INSERT INTO pages (slug, locale, title, status) VALUES ('articles', 'en', 'Mine', 'draft')").run());
      const pages = db.prepare("SELECT slug, locale, title, status, list_kind, list_filter FROM pages ORDER BY slug, locale").all() as Row[];
      expect(pages.map((p) => `${p.slug}/${p.locale}:${p.list_kind ?? "-"}`)).toEqual(["articles/ar:filter", "articles/en:-", "videos/ar:filter", "videos/en:filter"]);
      expect(pages.find((p) => p.slug === "articles" && p.locale === "en")).toMatchObject({ title: "Mine", status: "draft" });
      expect(JSON.parse(String(pages.find((p) => p.slug === "videos")!.list_filter))).toEqual({ kinds: ["video", "playlist", "channel"], tag: null });
   });

   it("curated page entries: one row per post and per video on a page", () => {
      const db = migrated();
      const post = db.prepare("INSERT INTO page_entries (page_id, kind, post_id, created_at, updated_at) VALUES (?, 'post', 1, ?, ?)");
      post.run(1, AT, AT);
      post.run(2, AT, AT);
      expect(() => post.run(1, AT, AT)).toThrow(/UNIQUE/);
      const video = db.prepare("INSERT INTO page_entries (page_id, kind, video_kind, ref_id, created_at, updated_at) VALUES (1, 'video', ?, 'x', ?, ?)");
      video.run("video", AT, AT);
      video.run("channel", AT, AT);
      expect(() => video.run("video", AT, AT)).toThrow(/UNIQUE/);
   });
});
