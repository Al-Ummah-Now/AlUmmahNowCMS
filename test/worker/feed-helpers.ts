import { env } from "cloudflare:test";
import type { Env } from "../../src/env.ts";
import type { FeedMessage } from "../../src/lib/feed/jobs.ts";

export type Op = { op: "get" | "put" | "delete"; key: string };

/** A KV namespace that records every operation (over the real test namespace). */
export function recordingKv(base: KVNamespace = env.FEED as KVNamespace): { kv: KVNamespace; ops: Op[]; failPuts: { on: boolean } } {
   const ops: Op[] = [];
   const failPuts = { on: false };
   const kv = {
      get: (key: string, type?: unknown) => {
         ops.push({ op: "get", key });
         return (base.get as (k: string, t?: unknown) => Promise<unknown>)(key, type);
      },
      put: async (key: string, value: string) => {
         if (failPuts.on) throw new Error("KV put failed (test)");
         ops.push({ op: "put", key });
         return base.put(key, value);
      },
      delete: (key: string) => {
         ops.push({ op: "delete", key });
         return base.delete(key);
      },
      list: (o?: KVNamespaceListOptions) => base.list(o),
   } as unknown as KVNamespace;
   return { kv, ops, failPuts };
}

export function fakeQueue(): { queue: Queue<FeedMessage>; sent: FeedMessage[] } {
   const sent: FeedMessage[] = [];
   const queue = {
      send: async (m: FeedMessage) => {
         sent.push(m);
      },
      sendBatch: async (ms: { body: FeedMessage }[]) => {
         for (const m of ms) sent.push(m.body);
      },
   } as unknown as Queue<FeedMessage>;
   return { queue, sent };
}

export function testEnv(over: Partial<Env> = {}): Env {
   return { ...(env as unknown as Env), VIDEOS_API_URL: "", ...over };
}

let seq = 0;
/** A live post written straight to D1 (no bknd, so no plugin). Returns its id. */
export async function insertPost(p: { locale?: "en" | "ar"; date: string; title?: string; show?: 0 | 1 | null; body?: string; status?: string; publishAt?: string | null; kind?: string }): Promise<number> {
   const n = ++seq;
   const row = await env.DB.prepare(
      `INSERT INTO posts (slug, locale, title, status, published_at, publish_at, created_at, updated_at, kind, show_on_timeline, body, tags)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5, ?5, ?7, ?8, ?9, '[]') RETURNING id`,
   )
      .bind(`t-${n}-${Math.random().toString(36).slice(2, 8)}`, p.locale ?? "en", p.title ?? `Post ${n}`, p.status ?? "published", p.date, p.publishAt ?? null, p.kind ?? "article", p.show === undefined ? null : p.show, p.body ?? "")
      .first<{ id: number }>();
   return row!.id;
}

export async function insertVideoEntry(e: { ref: string; date: string; locale?: string; pin?: number | null; hidden?: 0 | 1; title?: string }): Promise<number> {
   const at = new Date().toISOString();
   await env.DB.prepare(
      `INSERT INTO video_snapshots (kind, ref_id, snapshot, attempts, created_at, updated_at) VALUES ('video', ?1, ?2, 0, ?3, ?3)
       ON CONFLICT (kind, ref_id) DO NOTHING`,
   )
      .bind(e.ref, JSON.stringify({ title: e.title ?? `Video ${e.ref}`, thumbnail_url: "https://images.example/t.jpg", channel_name: "Chan", public: true, refreshed_at: at }), at)
      .run();
   const row = await env.DB.prepare(
      `INSERT INTO timeline_entries (kind, video_kind, ref_id, locale, entry_date, hidden, pin_rank, created_at, updated_at)
       VALUES ('video', 'video', ?1, ?2, ?3, ?4, ?5, ?6, ?6) RETURNING id`,
   )
      .bind(e.ref, e.locale ?? "all", e.date, e.hidden ?? 0, e.pin ?? null, at)
      .first<{ id: number }>();
   return row!.id;
}

/** Empties every feed table and the timeline (tests share one D1 per file). */
export async function resetFeed(): Promise<void> {
   await env.DB.batch(
      ["feed_dirty", "feed_items", "feed_weeks", "feed_years", "feed_heads", "feed_garbage", "timeline_entries", "timeline_changes", "posts", "video_snapshots"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
   );
   await env.DB.prepare("UPDATE feed_state SET queued_at = NULL, last_head_write_at = NULL, attempts = 0, last_error = NULL, failed_at = NULL, dead_at = NULL, due_checked_until = NULL, full_total = NULL, full_requested_at = NULL WHERE id = 1").run();
   const keys = await (env.FEED as KVNamespace).list();
   for (const k of keys.keys) await (env.FEED as KVNamespace).delete(k.name);
}

export const noSleep = async () => {};
