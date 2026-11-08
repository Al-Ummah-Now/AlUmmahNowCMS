import { describe, expect, it } from "vitest";
import { checkMigrations, destructiveStatements, stripSql } from "../../scripts/migration-guard.ts";

const init = { name: "0001_init.sql", content: 'create table "pages" ("id" integer);\n' };

describe("destructive statements", () => {
   it.each([
      ['drop table "pages";'],
      ['DROP INDEX "idx";'],
      ['alter table "pages" drop column "summary";'],
      ['ALTER TABLE pages RENAME TO old_pages;'],
      ['alter table "pages" rename column "a" to "b";'],
      ["delete from pages;"],
      ["UPDATE pages SET title = 'x';"],
      ["replace into pages (id) values (1);"],
   ])("rejects %s", (sql) => expect(destructiveStatements("m.sql", sql).length).toBeGreaterThan(0));

   it.each([
      ['create table "posts" ("id" integer not null primary key autoincrement, "title" text);'],
      ['create unique index "idx_unique_posts_slug_locale" on "posts" ("slug", "locale");'],
      ['alter table "posts" add column "subtitle" text;'],
      ["-- drop table pages (just a comment)\ncreate index i on pages (slug);"],
      ["insert into site_settings (locale, site_title) values ('en', 'Drop the beat; rename it');"],
   ])("allows %s", (sql) => expect(destructiveStatements("m.sql", sql)).toEqual([]));

   it("strips comments and string literals", () => {
      expect(stripSql("/* drop */ select 'drop table x' -- drop\n")).not.toMatch(/drop/i);
   });
});

describe("append-only", () => {
   it("passes when the merged migration is unchanged and a new one is appended", () => {
      expect(checkMigrations([init, { name: "0002_add_subtitle.sql", content: 'alter table "posts" add column "subtitle" text;' }], [init])).toEqual([]);
   });
   it("rejects edits to a merged migration", () => {
      expect(checkMigrations([{ ...init, content: init.content + "-- edit\n" }], [init])[0]).toMatch(/merged migration modified/);
   });
   it("rejects deleting or renaming a merged migration", () => {
      expect(checkMigrations([{ ...init, name: "0001_initial.sql" }], [init]).join()).toMatch(/deleted or renamed/);
   });
   it("rejects a new migration that sorts before the latest merged one", () => {
      const base = [init, { name: "0003_x.sql", content: "create index a on pages (id);" }];
      const errs = checkMigrations([...base, { name: "0002_late.sql", content: "create index b on pages (id);" }], base);
      expect(errs.join()).toMatch(/sorts before/);
   });
   it("rejects bad names and duplicate numbers", () => {
      expect(checkMigrations([init, { name: "2_Thing.sql", content: "" }], [init]).join()).toMatch(/name must look like/);
      expect(checkMigrations([init, { name: "0001_dupe.sql", content: "" }], []).join()).toMatch(/share the number/);
   });
   it("passes on a first PR (no migrations on the base)", () => {
      expect(checkMigrations([init], [])).toEqual([]);
   });
});
