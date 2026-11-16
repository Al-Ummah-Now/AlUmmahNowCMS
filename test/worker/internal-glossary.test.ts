/**
 * /internal/glossary: the videos processor reads the glossary here for staff-field translation (L10N
 * rule). Internal key only, live entries of the asked pair, longest term first, never cached.
 */
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { makeWorker } from "./helpers.ts";

const KEY = "internal-test-key";

beforeEach(async () => {
   await env.DB.prepare("DELETE FROM translation_glossary").run();
   const add = (id: string, from: string, source: string, to: string, target: string, deleted: number | null = null) =>
      env.DB.prepare(
         "INSERT INTO translation_glossary (id, source_locale, source_term, target_locale, target_term, note, flag_id, created_by, created_by_email, created_at, updated_at, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, NULL, NULL, 'u', 'e@x', 1, 1, ?6)",
      )
         .bind(id, from, source, to, target, deleted)
         .run();
   await add("g1", "en", "Shorts", "ar", "المقاطع القصيرة");
   await add("g2", "en", "video", "ar", "مرئي");
   await add("g3", "en", "gone", "ar", "محذوف", 5);
   await add("g4", "ar", "مرئي", "en", "video");
});

describe("/internal/glossary", () => {
   it("returns the live entries of the pair, longest term first, no-store", async () => {
      const f = makeWorker(undefined, { VIDEOS_INTERNAL_API_KEY: KEY } as never);
      const res = await f("/internal/glossary?from=en&to=ar", { headers: { "X-API-Key": KEY } });
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await res.json()).toEqual({ entries: [{ source: "Shorts", target: "المقاطع القصيرة", note: null }, { source: "video", target: "مرئي", note: null }] });
   });

   it("needs the internal key and a valid pair", async () => {
      const f = makeWorker(undefined, { VIDEOS_INTERNAL_API_KEY: KEY } as never);
      expect((await f("/internal/glossary?from=en&to=ar")).status).toBe(401);
      expect((await f("/internal/glossary?from=en&to=ar", { headers: { "X-API-Key": "wrong" } })).status).toBe(401);
      expect((await f("/internal/glossary?from=en&to=fr", { headers: { "X-API-Key": KEY } })).status).toBe(400);
      expect((await f("/internal/glossary?from=ar&to=ar", { headers: { "X-API-Key": KEY } })).status).toBe(400);
   });
});
