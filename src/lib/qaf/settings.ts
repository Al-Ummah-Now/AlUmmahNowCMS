import { base64url } from "../pkce.ts";
import { QAF_WEEK_LIMIT } from "./model.ts";

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const isQafKey = (key: unknown): key is string =>
   typeof key === "string" && /^qaf_sk_[A-Za-z0-9_-]{1,512}$/.test(key);

const label = new TextEncoder().encode("al-ummah-now/cms/qaf-key/v1");

async function sealingKey(secret: string): Promise<CryptoKey> {
   const root = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"]);
   return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: label }, root, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function sealQafKey(secret: string, key: string): Promise<string> {
   const iv = crypto.getRandomValues(new Uint8Array(12));
   const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealingKey(secret), new TextEncoder().encode(key));
   return `v1.${base64url(iv)}.${base64url(new Uint8Array(data))}`;
}

export async function openQafKey(secret: string, sealed: string): Promise<string> {
   const [version, nonce, cipher] = sealed.split(".");
   if (version !== "v1" || !nonce || !cipher) throw new Error("Invalid sealed Qaf key");
   const decode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
   const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(nonce) }, await sealingKey(secret), decode(cipher));
   const key = new TextDecoder().decode(data);
   if (!isQafKey(key)) throw new Error("Invalid sealed Qaf key");
   return key;
}

export type QafIncident = "week" | "invalid_keys" | "auth" | "sealed_key";
interface QafSettings {
   generation: string;
   sealed_key: string | null;
   error: QafIncident | null;
   request_id: string | null;
   retry_at: number | null;
   weekly_reset_at: number | null;
}

export const qafSettings = (db: D1Database) => db.prepare("SELECT * FROM qaf_settings WHERE id = 1").first<QafSettings>();
export const qafConfigured = async (db: D1Database) => !!(await db.prepare("SELECT 1 FROM qaf_settings WHERE id = 1 AND sealed_key IS NOT NULL").first());

export async function saveQafKey(db: D1Database, sealed: string | null): Promise<void> {
   const generation = crypto.randomUUID();
   await db.batch([
      db.prepare(`INSERT INTO qaf_settings (id, generation, sealed_key) VALUES (1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET generation = excluded.generation, sealed_key = excluded.sealed_key,
            error = NULL, request_id = NULL, retry_at = NULL, weekly_reset_at = NULL`).bind(generation, sealed),
      db.prepare("DELETE FROM qaf_search_cache"),
      db.prepare("DELETE FROM qaf_search_usage"),
   ]);
}

export async function flagQaf(db: D1Database, generation: string, error: QafIncident, requestId: string | null, retryAt: number | null): Promise<void> {
   await db.prepare(`UPDATE qaf_settings SET error = ?2, request_id = ?3, retry_at = ?4,
      weekly_reset_at = CASE WHEN ?2 = 'week' THEN ?4 ELSE weekly_reset_at END
      WHERE generation = ?1 AND (?2 != 'week' OR error IS NULL OR error = 'week')`).bind(generation, error, requestId, retryAt).run();
}

export interface QafStatus {
   configured: boolean;
   remaining: number;
   issue: QafIncident | null;
   retryAt: number | null;
   requestId: string | null;
}

export async function qafStatus(db: D1Database, now = Date.now()): Promise<QafStatus> {
   const row = await qafSettings(db);
   const configured = !!row?.sealed_key;
   const issue = row?.error === "week" && (row.retry_at ?? 0) <= now ? null : row?.error ?? null;
   const used = configured ? await db.prepare("SELECT COUNT(*) AS n FROM qaf_search_usage WHERE generation = ?1 AND at >= ?2")
      .bind(row.generation, Math.max(now - WEEK_MS, row.weekly_reset_at ?? 0)).first<number>("n") : 0;
   return {
      configured, remaining: (row?.weekly_reset_at ?? 0) > now ? 0 : Math.max(0, QAF_WEEK_LIMIT - (used ?? 0)),
      issue, retryAt: issue ? row?.retry_at ?? null : null, requestId: issue ? row?.request_id ?? null : null,
   };
}

export async function pruneQaf(db: D1Database, now: number): Promise<void> {
   await db.batch([
      db.prepare("DELETE FROM qaf_search_cache WHERE expires_at <= ?1").bind(now),
      db.prepare("DELETE FROM qaf_search_usage WHERE at < ?1").bind(now - WEEK_MS),
   ]);
}
