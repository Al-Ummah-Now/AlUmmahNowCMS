/**
 * Migration 0024: a Scholars link at the end of www's header menu in both languages (AlUmmahNowUI#41).
 * Inserted only when missing: an editor's own /scholars/ link and a deleted (trashed) one are left alone.
 */
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { destructiveStatements } from "../../scripts/migration-guard.ts";

const dir = new URL("../../migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = (name: string) => readFileSync(new URL(name, dir), "utf8");
const NAME = "0024_scholars_nav.sql";

type Row = Record<string, unknown>;

function migrated(seed: (db: DatabaseSync) => void = () => {}) {
   const db = new DatabaseSync(":memory:");
   for (const f of files.filter((x) => x < NAME)) db.exec(sql(f));
   seed(db);
   db.exec(sql(NAME));
   return db;
}
const header = (db: DatabaseSync, locale: string) =>
   db.prepare("SELECT label, url, sort, status FROM nav_items WHERE menu = 'header' AND locale = ? ORDER BY sort, id").all(locale) as Row[];
const seedMenu = (d: DatabaseSync) => {
   const add = d.prepare("INSERT INTO nav_items (menu, locale, label, url, sort, status) VALUES (?, ?, ?, ?, ?, 'published')");
   add.run("header", "en", "Articles", "/articles/", 1);
   add.run("header", "en", "Videos", "/videos/", 2);
   add.run("header", "en", "About", "/about/", 3);
   add.run("footer", "en", "About", "/about/", 9);
   add.run("header", "ar", "المقالات", "/articles/", 1);
};

describe("migration 0024_scholars_nav", () => {
   it("follows 0023 and is expand-only", () => {
      expect(files[files.indexOf(NAME) - 1]).toMatch(/^0023_/);
      expect(destructiveStatements(NAME, sql(NAME))).toEqual([]);
   });

   it("adds a published Scholars link last in each language's header menu", () => {
      const db = migrated(seedMenu);
      expect(header(db, "en").map((r) => r.label)).toEqual(["Articles", "Videos", "About", "Scholars"]);
      expect(header(db, "en").at(-1)).toEqual({ label: "Scholars", url: "/scholars/", sort: 4, status: "published" });
      expect(header(db, "ar").at(-1)).toEqual({ label: "العلماء", url: "/scholars/", sort: 2, status: "published" });
      // The footer menu is untouched
      expect(db.prepare("SELECT count(*) AS n FROM nav_items WHERE menu = 'footer'").get()).toEqual({ n: 1 });
   });

   it("works on an empty menu", () => {
      const db = migrated();
      expect(header(db, "en")).toEqual([{ label: "Scholars", url: "/scholars/", sort: 1, status: "published" }]);
   });

   it("leaves an editor's own Scholars link alone and still adds the missing language", () => {
      const db = migrated((d) => d.prepare("INSERT INTO nav_items (menu, locale, label, url, sort, status) VALUES ('header', 'en', 'Our scholars', '/scholars', 1, 'draft')").run());
      expect(header(db, "en")).toEqual([{ label: "Our scholars", url: "/scholars", sort: 1, status: "draft" }]);
      expect(header(db, "ar").map((r) => r.label)).toEqual(["العلماء"]);
   });

   it("does not bring back a Scholars link an editor deleted", () => {
      const db = migrated((d) =>
         d
            .prepare("INSERT INTO trash (kind, item_id, data, deleted_at) VALUES ('nav_items', 9, ?, '2026-11-14T00:00:00.000Z')")
            .run(JSON.stringify({ id: 9, menu: "header", locale: "ar", label: "العلماء", url: "/scholars/" })),
      );
      expect(header(db, "ar")).toEqual([]);
      expect(header(db, "en").map((r) => r.label)).toEqual(["Scholars"]);
   });

   it("is a no-op when run again", () => {
      const db = migrated(seedMenu);
      db.exec(sql(NAME));
      expect(header(db, "en")).toHaveLength(4);
      expect(header(db, "ar")).toHaveLength(2);
   });
});
