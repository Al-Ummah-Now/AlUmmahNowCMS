/**
 * Migration 0022: the seeded About page (0021) becomes page-builder blocks (hero, feature list, "Get
 * started"), with the owner's words; only while it is exactly as 0021 seeded it, and backed up first.
 */
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { destructiveStatements } from "../../scripts/migration-guard.ts";
import { blocksToMarkdown, normalizeBlocks, storedBlocks } from "../../src/lib/blocks.ts";

const dir = new URL("../../migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = (name: string) => readFileSync(new URL(name, dir), "utf8");
const NAME = "0022_about_blocks.sql";
type Row = Record<string, unknown>;

function upTo(seed: (db: DatabaseSync) => void = () => {}) {
   const db = new DatabaseSync(":memory:");
   for (const f of files.filter((x) => x < NAME)) db.exec(sql(f));
   seed(db);
   db.exec(sql(NAME));
   return db;
}
const about = (db: DatabaseSync, locale: string) => db.prepare("SELECT * FROM pages WHERE slug = 'about' AND locale = ?").get(locale) as Row;

describe("migration 0022_about_blocks", () => {
   it("is allowed by the migration guard (one table, backed up)", () => {
      expect(destructiveStatements(NAME, sql(NAME))).toEqual([]);
   });

   it("lays the seeded About out as a hero, a feature list and Get started, in both languages", () => {
      const db = upTo();
      for (const [locale, lead, heading, item, start] of [
         ["en", "Al Ummah Now is a platform where you can share videos, Shorts and community posts.", "What you'll find here", "Watch live streams as they happen.", "## Get started"],
         ["ar", "الأمة الآن منصة تشارك فيها المرئيات والمقاطع القصيرة ومنشورات المجتمع.", "ماذا تجد هنا؟", "شاهد البث المباشر لحظة بلحظة.", "## ابدأ الآن"],
      ] as const) {
         const row = about(db, locale);
         const blocks = storedBlocks(row.blocks);
         expect(blocks.map((b) => b.type)).toEqual(["hero", "stats", "markdown"]);
         // Stored exactly as the editor would store them, and body derived the same way.
         expect(normalizeBlocks(JSON.parse(String(row.blocks)))).toEqual(blocks);
         expect(row.body).toBe(blocksToMarkdown(blocks));
         const [hero, find, rest] = blocks;
         expect(hero.type === "hero" && hero.subtitle).toBe(lead);
         expect(hero.type === "hero" && hero.title).toBe(""); // the page title is the hero's title
         expect(find.type === "stats" && find.variant).toBe("features");
         expect(find.type === "stats" && find.heading).toBe(heading);
         expect(find.type === "stats" && find.items.map((x) => x.label)).toContain(item);
         expect(find.type === "stats" && find.items.every((x) => x.icon)).toBe(true);
         expect(rest.type === "markdown" && rest.text.startsWith(start)).toBe(true);
         expect(row.title).toBe(locale === "en" ? "About Al Ummah Now" : "عن الأمة الآن");
      }
      const backup = db.prepare("SELECT locale, blocks FROM pages_backup_0022 ORDER BY locale").all() as Row[];
      expect(backup.map((r) => r.locale)).toEqual(["ar", "en"]);
      expect(storedBlocks(backup[0].blocks).map((b) => b.id)).toEqual(["body"]);
   });

   it("leaves an About page an editor changed alone", () => {
      const db = upTo((d) => {
         d.exec(`UPDATE pages SET body = 'Our own words', blocks = json_array(json_object('id','body','type','markdown','text','Our own words')) WHERE slug = 'about' AND locale = 'en'`);
      });
      expect(about(db, "en").body).toBe("Our own words");
      expect(storedBlocks(about(db, "ar").blocks).map((b) => b.type)).toEqual(["hero", "stats", "markdown"]);
      expect((db.prepare("SELECT COUNT(*) AS n FROM pages_backup_0022").get() as Row).n).toBe(1);
   });

   it("leaves an About laid out with blocks by an editor alone", () => {
      const db = upTo((d) => {
         d.exec(`UPDATE pages SET blocks = json_array(json_object('id','body','type','markdown','text',body), json_object('id','x','type','divider')) WHERE slug = 'about'`);
      });
      expect(storedBlocks(about(db, "en").blocks).map((b) => b.type)).toEqual(["markdown", "divider"]);
   });

   it("is safe to apply twice", () => {
      const db = upTo();
      const before = about(db, "en").blocks;
      db.exec(sql(NAME));
      expect(about(db, "en").blocks).toBe(before);
      expect((db.prepare("SELECT COUNT(*) AS n FROM pages_backup_0022").get() as Row).n).toBe(2);
   });
});
