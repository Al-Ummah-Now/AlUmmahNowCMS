/**
 * Migration 0007 on a database shaped like production (every migration before it, existing posts):
 * expand-only, every existing post stays on the timeline (show_on_timeline NULL reads as on), the
 * partial unique indexes keep one override per post and one entry per video and language, and the
 * feed state row exists.
 */
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { destructiveStatements } from "../../scripts/migration-guard.ts";

const dir = new URL("../../migrations/", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const sql = (name: string) => readFileSync(new URL(name, dir), "utf8");
const NAME = "0007_home_timeline.sql";

function migrated() {
   const db = new DatabaseSync(":memory:");
   for (const f of files.filter((x) => x < "0007")) db.exec(sql(f));
   db.prepare("INSERT INTO posts (id, slug, locale, title, body, status, tags) VALUES (1, 'p', 'en', 'P', 'Body', 'published', '[]')").run();
   const before = db.prepare("SELECT * FROM posts").all();
   db.exec(sql(NAME));
   return { db, before };
}

describe("migration 0007_home_timeline", () => {
   it("follows 0006 and is expand-only", () => {
      expect(files[files.indexOf(NAME) - 1]).toMatch(/^0006_/);
      expect(destructiveStatements(NAME, sql(NAME))).toEqual([]);
   });

   it("keeps every post as it was, on the timeline by default", () => {
      const { db, before } = migrated();
      const after = db.prepare("SELECT * FROM posts").all() as Record<string, unknown>[];
      expect(after.map(({ show_on_timeline: s, ...rest }) => (expect(s).toBeNull(), rest))).toEqual(before);
      expect(db.prepare("SELECT attempts FROM feed_state WHERE id = 1").get()).toEqual({ attempts: 0 });
   });

   it("one override row per post, one entry per video and language", () => {
      const { db } = migrated();
      const at = "2026-11-10T00:00:00.000Z";
      const post = db.prepare("INSERT INTO timeline_entries (kind, post_id, created_at, updated_at) VALUES ('post', 1, ?, ?)");
      post.run(at, at);
      expect(() => post.run(at, at)).toThrow(/UNIQUE/);
      const video = db.prepare("INSERT INTO timeline_entries (kind, video_kind, ref_id, locale, created_at, updated_at) VALUES ('video', 'video', 'v1', ?, ?, ?)");
      video.run("all", at, at);
      video.run("en", at, at);
      expect(() => video.run("all", at, at)).toThrow(/UNIQUE/);
   });
});
