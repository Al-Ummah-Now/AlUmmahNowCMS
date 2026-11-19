/**
 * Migration 0023: the seeded About page's "educational materials" / «المواد التعليمية» line becomes
 * "Share your videos and posts with the community." / «شارك مرئياتك ومنشوراتك مع المجتمع.» (Copy Tone
 * Guide), in the body and the blocks, backed up first; nothing else on the page changes.
 */
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { destructiveStatements } from "../../scripts/migration-guard.ts";
import { storedBlocks } from "../../src/lib/blocks.ts";

const dir = new URL("../../migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = (name: string) => readFileSync(new URL(name, dir), "utf8");
const NAME = "0023_about_copy_tone.sql";
type Row = Record<string, unknown>;

function upTo(beforeThis: (db: DatabaseSync) => void = () => {}) {
   const db = new DatabaseSync(":memory:");
   for (const f of files.filter((x) => x < NAME)) db.exec(sql(f));
   beforeThis(db);
   db.exec(sql(NAME));
   return db;
}
const about = (db: DatabaseSync, locale: string) => db.prepare("SELECT * FROM pages WHERE slug = 'about' AND locale = ?").get(locale) as Row;
const OLD = /educational materials|المواد التعليمية/;

describe("migration 0023_about_copy_tone", () => {
   it("is allowed by the migration guard (one table, backed up)", () => {
      expect(destructiveStatements(NAME, sql(NAME))).toEqual([]);
   });

   it("rewrites the line in the seeded About, en and ar, body and blocks", () => {
      const db = upTo();
      for (const [locale, line] of [
         ["en", "Share your videos and posts with the community."],
         ["ar", "شارك مرئياتك ومنشوراتك مع المجتمع."],
      ] as const) {
         const row = about(db, locale);
         expect(String(row.body)).not.toMatch(OLD);
         expect(String(row.blocks)).not.toMatch(OLD);
         expect(String(row.body)).toContain(line);
         const feature = storedBlocks(row.blocks).flatMap((b) => ((b as { items?: { label?: string; icon?: string }[] }).items ?? [])).find((i) => i.label === line);
         expect(feature?.icon).toBe("users");
      }
      expect(db.prepare("SELECT COUNT(*) AS n FROM pages_backup_0023").get()).toEqual({ n: 2 });
   });

   it("leaves the rest of an edited About as the editor wrote it", () => {
      const db = upTo((d) => d.exec(`UPDATE pages SET body = body || '\n\nAn editor''s own line.' WHERE slug = 'about' AND locale = 'en'`));
      const body = String(about(db, "en").body);
      expect(body).toContain("An editor's own line.");
      expect(body).not.toMatch(OLD);
   });

   it("is a no-op once applied (runs again without changing anything)", () => {
      const db = upTo();
      const before = about(db, "ar");
      db.exec(sql(NAME));
      expect(about(db, "ar")).toEqual(before);
   });
});
