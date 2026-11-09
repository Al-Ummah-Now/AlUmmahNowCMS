import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const sql = (name: string) => readFileSync(new URL(`../../migrations/${name}`, import.meta.url), "utf8");

describe("migration 0002_curated_videos_unique", () => {
   it("removes duplicates into a backup table, keeps the published/oldest row, normalizes NULL locale, then enforces uniqueness", () => {
      const db = new DatabaseSync(":memory:");
      db.exec(sql("0001_init.sql"));
      const ins = db.prepare("INSERT INTO curated_videos (id, kind, ref_id, placement, locale, sort, status, title_override) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      const rows: [number, string, string, string, string | null, number, string, string | null][] = [
         [1, "video", "a", "home", "all", 0, "draft", "a-draft-old"],
         [2, "video", "a", "home", "all", 0, "published", "a-published"],
         [3, "video", "a", "home", "all", 0, "published", "a-published-newer"],
         [4, "video", "a", "home", null, 0, "draft", "a-null-locale"],
         [5, "video", "a", "home", "en", 0, "draft", "a-en"],
         [6, "video", "a", "videos", "all", 0, "draft", "a-videos"],
         [7, "playlist", "a", "home", "all", 0, "draft", "a-playlist"],
         [8, "video", "b", "home", null, 0, "draft", "b-null-1"],
         [9, "video", "b", "home", null, 0, "draft", "b-null-2"],
         [10, "video", "c", "home", "ar", 0, "published", "c-unique"],
      ];
      for (const r of rows) ins.run(...r);

      db.exec(sql("0002_curated_videos_unique.sql"));

      const kept = db.prepare("SELECT id, locale, title_override FROM curated_videos ORDER BY id").all();
      expect(kept).toEqual([
         { id: 2, locale: "all", title_override: "a-published" },
         { id: 5, locale: "en", title_override: "a-en" },
         { id: 6, locale: "all", title_override: "a-videos" },
         { id: 7, locale: "all", title_override: "a-playlist" },
         { id: 8, locale: "all", title_override: "b-null-1" },
         { id: 10, locale: "ar", title_override: "c-unique" },
      ]);
      // Nothing lost: every removed row is in the backup, unchanged.
      const backup = db.prepare("SELECT id, locale, title_override, status FROM curated_videos_dupes_0002 ORDER BY id").all();
      expect(backup).toEqual([
         { id: 1, locale: "all", title_override: "a-draft-old", status: "draft" },
         { id: 3, locale: "all", title_override: "a-published-newer", status: "published" },
         { id: 4, locale: null, title_override: "a-null-locale", status: "draft" },
         { id: 9, locale: null, title_override: "b-null-2", status: "draft" },
      ]);
      expect(kept.length + backup.length).toBe(rows.length);
      expect(() => ins.run(11, "video", "a", "home", "all", 0, "draft", "dupe")).toThrow(/UNIQUE/);
      db.prepare("INSERT INTO curated_videos (kind, ref_id, placement, locale) VALUES ('video', 'a', 'home', 'all') ON CONFLICT (kind, ref_id, placement, locale) DO NOTHING").run();
      expect(db.prepare("SELECT COUNT(*) AS n FROM curated_videos").get()).toEqual({ n: 6 });
   });

   it("is a no-op on a table without duplicates", () => {
      const db = new DatabaseSync(":memory:");
      db.exec(sql("0001_init.sql"));
      db.exec(sql("0002_curated_videos_unique.sql"));
      expect(db.prepare("SELECT COUNT(*) AS n FROM curated_videos_dupes_0002").get()).toEqual({ n: 0 });
   });
});
