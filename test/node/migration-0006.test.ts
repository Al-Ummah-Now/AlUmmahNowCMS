/**
 * Migration 0006 on a copy: a database shaped like production (every migration before it, real-looking
 * rows), then 0006. Nothing is lost: every column of every row is unchanged, the backup equals the
 * original, and each body is now one rich-text block holding exactly that body.
 */
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { normalizeBlocks } from "../../src/lib/blocks.ts";

const dir = new URL("../../migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = (name: string) => readFileSync(new URL(name, dir), "utf8");
const before = files.filter((f) => f < "0006");

function seeded() {
   const db = new DatabaseSync(":memory:");
   for (const f of before) db.exec(sql(f));
   const ins = db.prepare("INSERT INTO pages (id, slug, locale, title, body, status, translation_key, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
   ins.run(1, "about", "en", "About", "# About\n\nIt's \"quoted\" & <b>raw</b>\n\n::video[vid-1]\n", "published", "k", "2026-11-01T00:00:00.000Z");
   ins.run(2, "about", "ar", "من نحن", "نص عربي\n\n> اقتباس", "published", "k", "2026-11-01T00:00:00.000Z");
   ins.run(3, "empty", "en", "Empty", "", "draft", null, null);
   ins.run(4, "blank", "en", "Blank", "  \n ", "draft", null, null);
   ins.run(5, "nobody", "en", "Null body", null, "draft", null, null);
   db.prepare("INSERT INTO posts (id, slug, locale, title, body, status, tags) VALUES (1, 'p', 'en', 'P', 'Body', 'published', '[\"news\"]')").run();
   return db;
}

describe("migration 0006_page_blocks_card_posts", () => {
   it("follows 0005 and allows rewriting only pages", () => {
      expect(files[files.indexOf("0006_page_blocks_card_posts.sql") - 1]).toMatch(/^0005_/);
      expect(sql("0006_page_blocks_card_posts.sql")).toMatch(/^-- migration-guard: allow-data-rewrite pages$/m);
   });

   it("keeps every row, backs pages up first, and turns each body into one rich-text block", () => {
      const db = seeded();
      const original = db.prepare("SELECT * FROM pages ORDER BY id").all();
      const posts = db.prepare("SELECT * FROM posts ORDER BY id").all();
      db.exec(sql("0006_page_blocks_card_posts.sql"));

      expect(db.prepare("SELECT * FROM pages_backup_0006 ORDER BY id").all()).toEqual(original);
      const after = db.prepare("SELECT * FROM pages ORDER BY id").all() as Record<string, unknown>[];
      expect(after.map(({ blocks: _b, ...rest }) => rest)).toEqual(original);

      const blocks = (id: number) => after.find((r) => r.id === id)!.blocks;
      for (const id of [1, 2]) {
         const parsed = normalizeBlocks(JSON.parse(String(blocks(id))));
         expect(parsed).toEqual([{ id: "body", type: "markdown", text: (original[id - 1] as { body: string }).body }]);
      }
      expect([blocks(3), blocks(4), blocks(5)]).toEqual([null, null, null]);

      // Posts: unchanged; the new columns read as an article with no slides.
      const p = db.prepare("SELECT * FROM posts ORDER BY id").all() as Record<string, unknown>[];
      expect(p.map(({ kind: _k, slides: _s, ...rest }) => rest)).toEqual(posts);
      expect(p[0]).toMatchObject({ kind: null, slides: null });
      expect(db.prepare("SELECT COUNT(*) AS n FROM video_snapshots").get()).toEqual({ n: 0 });
   });

   it("the conversion statement is idempotent (rows with blocks are skipped)", () => {
      const db = seeded();
      db.exec(sql("0006_page_blocks_card_posts.sql"));
      const once = db.prepare("SELECT id, blocks FROM pages ORDER BY id").all();
      const update = /update "pages"[\s\S]*?;/.exec(sql("0006_page_blocks_card_posts.sql"))![0];
      db.exec(update);
      expect(db.prepare("SELECT id, blocks FROM pages ORDER BY id").all()).toEqual(once);
   });
});
