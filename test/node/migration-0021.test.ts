/**
 * Migration 0021: the www About page as a CMS page, en + ar, with the owner's copy verbatim (www's
 * built-in About, AlUmmahNowUI apps/www/src/content/fallback/{en,ar}.ts). Inserted only when missing:
 * an editor's own `about` page and a deleted (trashed) one are left alone.
 */
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { destructiveStatements } from "../../scripts/migration-guard.ts";
import { blocksToMarkdown, DEFAULT_STYLE, normalizeBlocks } from "../../src/lib/blocks.ts";

const dir = new URL("../../migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = (name: string) => readFileSync(new URL(name, dir), "utf8");
const NAME = "0021_about_page.sql";

// www's built-in About copy, copied character for character.
const EN = [
   "Al Ummah Now is a platform where you can share videos, Shorts and community posts.",
   "",
   "## What you'll find here",
   "",
   "- Watch and share **videos and Shorts**.",
   "- Read **community posts** from the channels you subscribe to.",
   "- Share **news** that matters to the Ummah.",
   "- Share **educational materials**.",
   "- Watch **live streams** as they happen.",
   "",
   "## Get started",
   "",
   "Explore videos, or create an account to subscribe to channels and save what you want to come back to.",
].join("\n");
const AR = [
   "الأمة الآن منصة تشارك فيها المرئيات والمقاطع القصيرة ومنشورات المجتمع.",
   "",
   "## ماذا تجد هنا؟",
   "",
   "- شاهد **المرئيات والمقاطع القصيرة** وشاركها.",
   "- اقرأ **منشورات المجتمع** من القنوات التي تشترك فيها.",
   "- شارك **الأخبار** التي تهمّ الأمة.",
   "- شارك **المواد التعليمية**.",
   "- شاهد **البث المباشر** لحظة بلحظة.",
   "",
   "## ابدأ الآن",
   "",
   "استكشف المرئيات، أو أنشئ حسابًا لتشترك في القنوات وتحفظ ما تريد الرجوع إليه.",
].join("\n");

type Row = Record<string, unknown>;

function migrated(seed: (db: DatabaseSync) => void = () => {}) {
   const db = new DatabaseSync(":memory:");
   for (const f of files.filter((x) => x < NAME)) db.exec(sql(f));
   seed(db);
   db.exec(sql(NAME));
   return db;
}
const about = (db: DatabaseSync) => db.prepare("SELECT * FROM pages WHERE slug = 'about' ORDER BY locale DESC").all() as Row[];

describe("migration 0021_about_page", () => {
   it("follows 0020 and is expand-only", () => {
      expect(files[files.indexOf(NAME) - 1]).toMatch(/^0020_/);
      expect(destructiveStatements(NAME, sql(NAME))).toEqual([]);
   });

   it("adds a published About page in both languages, linked as translations, with the owner's copy verbatim", () => {
      const [en, ar] = about(migrated());
      expect(en).toMatchObject({
         locale: "en",
         translation_key: "www-about",
         title: "About Al Ummah Now",
         summary: "An Islamic video and community platform, in Arabic and English.",
         body: EN,
         status: "published",
         show_in_sitemap: 1,
         list_kind: null,
      });
      expect(ar).toMatchObject({
         locale: "ar",
         translation_key: "www-about",
         title: "عن الأمة الآن",
         summary: "منصة إسلامية للمرئيات والمجتمع، بالعربية والإنجليزية.",
         body: AR,
         status: "published",
         show_in_sitemap: 1,
      });
      expect(String(en!.published_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
   });

   it("stores one markdown block the editor round-trips to the same body", () => {
      for (const row of about(migrated())) {
         const blocks = normalizeBlocks(JSON.parse(String(row.blocks)));
         expect(blocks).toEqual([{ id: "body", type: "markdown", appearance: DEFAULT_STYLE.markdown, text: row.body }]);
         expect(blocksToMarkdown(blocks)).toBe(row.body);
      }
   });

   it("leaves an editor's own About page alone and still adds the missing language", () => {
      const db = migrated((d) => d.prepare("INSERT INTO pages (slug, locale, title, body, status) VALUES ('about', 'en', 'Ours', 'Edited', 'draft')").run());
      const [en, ar] = about(db);
      expect(en).toMatchObject({ title: "Ours", body: "Edited", status: "draft" });
      expect(ar).toMatchObject({ title: "عن الأمة الآن", body: AR });
   });

   it("does not bring back an About page an editor deleted", () => {
      const db = migrated((d) =>
         d.prepare("INSERT INTO trash (kind, item_id, data, deleted_at) VALUES ('pages', 9, ?, '2026-11-14T00:00:00.000Z')").run(JSON.stringify({ id: 9, slug: "about", locale: "ar" })),
      );
      expect(about(db).map((r) => r.locale)).toEqual(["en"]);
   });

   it("is a no-op when run again", () => {
      const db = migrated();
      db.exec(sql(NAME));
      expect(about(db)).toHaveLength(2);
   });
});
