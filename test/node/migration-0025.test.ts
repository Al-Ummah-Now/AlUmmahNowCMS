import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { allowedRewrites, destructiveStatements } from "../../scripts/migration-guard.ts";

const dir = new URL("../../migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = (name: string) => readFileSync(new URL(name, dir), "utf8");
const NAME = "0025_seed_default_header_nav.sql";

const SCHOLARS = "0024_scholars_nav.sql";

function migrated(seed?: (db: DatabaseSync) => void) {
   const db = new DatabaseSync(":memory:");
   for (const f of files.filter((x) => x < SCHOLARS)) db.exec(sql(f));
   seed?.(db);
   db.exec(sql(SCHOLARS));
   db.exec(sql(NAME));
   return db;
}
const header = (db: DatabaseSync, locale: string) =>
   db.prepare("SELECT label, url, sort, status FROM nav_items WHERE menu = 'header' AND locale = ? ORDER BY sort, id").all(locale);

function trashLink(db: DatabaseSync, locale: string, url: string, id: number) {
   db.prepare("INSERT INTO trash (kind, item_id, data, deleted_at) VALUES ('nav_items', ?, ?, '2026-11-26T00:00:00.000Z')")
      .run(id, JSON.stringify({ menu: "header", locale, url }));
}

describe("migration 0025_seed_default_header_nav", () => {
   it("follows 0024 and allows rewriting only nav_items", () => {
      expect(files[files.indexOf(NAME) - 1]).toMatch(/^0024_/);
      expect(allowedRewrites(sql(NAME))).toEqual(new Set(["nav_items"]));
      expect(destructiveStatements(NAME, sql(NAME))).toEqual([]);
   });

   it("restores the published fallback menu in both locales and backs up the moved rows", () => {
      const db = migrated();
      const urls = ["/articles/", "/videos/", "/about/", "/scholars/"];
      for (const [locale, labels] of [
         ["en", ["Articles", "Videos", "About", "Scholars"]],
         ["ar", ["المقالات", "المرئيات", "من نحن", "العلماء"]],
      ] as const) {
         expect(header(db, locale)).toEqual(labels.map((label, i) => ({ label, url: urls[i], sort: i + 1, status: "published" })));
      }
      const backup = db.prepare("SELECT locale, sort FROM nav_items_backup_0025 ORDER BY locale");
      expect(backup.all()).toEqual([{ locale: "ar", sort: 1 }, { locale: "en", sort: 1 }]);
      const rows = db.prepare("SELECT * FROM nav_items ORDER BY id");
      const before = rows.all();
      db.exec(sql(NAME));
      expect(rows.all()).toEqual(before);
      expect(backup.all()).toHaveLength(2);
   });

   it("preserves editor-managed headers in both locales", () => {
      const db = migrated((d) => {
         const add = d.prepare("INSERT INTO nav_items (menu, locale, label, url, sort, status) VALUES ('header', ?, ?, ?, 7, 'published')");
         add.run("en", "Custom", "/custom/");
         add.run("ar", "من نحن", "/about/");
      });
      expect(header(db, "en")).toEqual([
         { label: "Custom", url: "/custom/", sort: 7, status: "published" },
         { label: "Scholars", url: "/scholars/", sort: 8, status: "published" },
      ]);
      expect(header(db, "ar")).toEqual([
         { label: "من نحن", url: "/about/", sort: 7, status: "published" },
         { label: "العلماء", url: "/scholars/", sort: 8, status: "published" },
      ]);
      expect(db.prepare("SELECT * FROM nav_items_backup_0025").all()).toEqual([]);
   });

   it("respects a trashed About link and leaves a header with no Scholars link empty", () => {
      const db = migrated((d) => {
         trashLink(d, "en", "/about/", 20);
         trashLink(d, "ar", "/scholars/", 21);
      });
      expect(header(db, "en")).toEqual([
         { label: "Articles", url: "/articles/", sort: 1, status: "published" },
         { label: "Videos", url: "/videos/", sort: 2, status: "published" },
         { label: "Scholars", url: "/scholars/", sort: 4, status: "published" },
      ]);
      expect(header(db, "ar")).toEqual([]);
   });
});
