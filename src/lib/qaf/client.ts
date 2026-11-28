import { sha256 } from "../ai/jobs.ts";
import { isAllowedProviderUrl, isLoopbackHostname } from "../ai/url-guard.ts";
import { log } from "../log.ts";
import { QAF_GENRES } from "./genres.ts";
import { UUID, type QafLocale } from "./model.ts";
import { flagQaf, openQafKey, qafSettings, WEEK_MS } from "./settings.ts";

export const QAF_API_BASE = "https://api.qaf.ai/v1";

type Search = {
   query: string;
   locale: QafLocale;
   limit: number;
   filterOperator: "AND" | "OR";
   filters?: {
      authorIds?: number[];
      bookIds?: string[];
      genres?: string[];
      deathYearAH?: Partial<Record<"gt" | "gte" | "lt" | "lte", number>>;
   };
   excludeIds?: string[];
};
type ErrorCode = "not_configured" | "validation" | "filters" | "minute" | "week" | "invalid_keys" | "auth" | "sealed_key" | "not_found" | "unavailable";
interface QafError { error: ErrorCode; status: 400 | 404 | 422 | 429 | 503; requestId: string | null; retryAfter?: number }
type QafResult = { ok: true; data: unknown; requestId: string | null; cached?: true } | { ok: false } & QafError;
type Operation = { search: Search } | { path: string };

const object = (value: unknown): Record<string, unknown> | null =>
   value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const normalQuery = (value: string) => value.normalize("NFC").trim().replace(/\s+/gu, " ");
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const uuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

function values<T>(v: unknown, max: number, valid: (item: unknown) => item is T, min = 1): T[] | null {
   if (!Array.isArray(v) || v.length < min || v.length > max || !v.every(valid)) return null;
   return [...new Set(v)].sort();
}

/** Canonicalize only search input. Filter dimensions are serialized in a fixed order. */
export function searchBody(raw: unknown): Search | null {
   const b = object(raw);
   if (!b || Object.keys(b).some((k) => !["query", "locale", "limit", "filterOperator", "filters", "excludeIds"].includes(k))) return null;
   if (typeof b.query !== "string" || b.query.length > 2000) return null;
   const query = normalQuery(b.query);
   const { locale = "en", limit = 20, filterOperator = "AND" } = b;
   if (!query || (locale !== "en" && locale !== "ar") || !integer(limit) || limit < 1 || limit > 20 || (filterOperator !== "AND" && filterOperator !== "OR")) return null;
   const request: Search = { query, locale, limit, filterOperator };
   if (b.excludeIds !== undefined) {
      const ids = values(b.excludeIds, 200, uuid, 0);
      if (!ids) return null;
      if (ids.length) request.excludeIds = ids.map((id) => id.toLowerCase()).sort();
   }
   if (b.filters === undefined) return request;
   const f = object(b.filters);
   if (!f || !Object.keys(f).length || Object.keys(f).some((k) => !["authorIds", "bookIds", "genres", "deathYearAH"].includes(k))) return null;
   const filters: NonNullable<Search["filters"]> = {};
   if (f.authorIds !== undefined) {
      const authors = values(f.authorIds, 20, (id): id is number => integer(id) && id > 0);
      if (!authors) return null;
      filters.authorIds = authors;
   }
   if (f.bookIds !== undefined) {
      const books = values(f.bookIds, 20, uuid);
      if (!books) return null;
      filters.bookIds = books.map((id) => id.toLowerCase()).sort();
   }
   if (f.genres !== undefined) {
      const genres = values(f.genres, 20, (g): g is string => typeof g === "string" && Object.hasOwn(QAF_GENRES, g));
      if (!genres) return null;
      filters.genres = genres;
   }
   if (f.deathYearAH !== undefined) {
      const years = object(f.deathYearAH);
      const bounds = ["gt", "gte", "lt", "lte"] as const;
      if (!years || !Object.keys(years).length || Object.keys(years).some((k) => !bounds.some((bound) => k === bound))) return null;
      const deathYearAH: NonNullable<typeof filters.deathYearAH> = {};
      for (const bound of bounds) {
         const year = years[bound];
         if (year === undefined) continue;
         if (!integer(year)) return null;
         deathYearAH[bound] = year;
      }
      filters.deathYearAH = deathYearAH;
   }
   return { ...request, filters };
}

const failure = (error: ErrorCode, status: QafError["status"], requestId: string | null = null, retryAfter?: number): QafResult & { ok: false } =>
   ({ ok: false, error, status, requestId, ...(retryAfter === undefined ? {} : { retryAfter }) });
const remainingSeconds = (until: number | null) => Math.max(0, Math.ceil(((until ?? 0) - Date.now()) / 1000));

function requestIdOf(res: Response): string | null {
   const id = res.headers.get("X-Request-Id");
   return id && /^[a-z0-9._:-]{1,100}$/i.test(id) && !id.includes("qaf_sk_") ? id : null;
}

function classify(res: Response, raw: unknown): QafResult & { ok: false } {
   const requestId = requestIdOf(res);
   const body = object(raw);
   const data = object(body?.data);
   const reason = data?.reason;
   const retryHeader = res.headers.get("Retry-After");
   const seconds = retryHeader === null ? data?.retryAfter : Number(retryHeader);
   const retryAfter = integer(seconds) && seconds >= 0 ? seconds : undefined;
   if (body?.code === "RATE_LIMITED" || res.status === 429) {
      if (reason === "week") return failure("week", 429, requestId, retryAfter ?? WEEK_MS / 1000);
      if (reason === "invalid_keys") return failure("invalid_keys", 429, requestId, retryAfter ?? 60);
      return failure("minute", 429, requestId, retryAfter ?? 60);
   }
   if (body?.code === "UNAUTHORIZED" || body?.code === "FORBIDDEN" || res.status === 401 || res.status === 403) return failure("auth", 503, requestId);
   if (body?.code === "INPUT_VALIDATION_FAILED" || res.status === 422) return failure("validation", 422, requestId);
   if (body?.code === "BAD_REQUEST" || res.status === 400) return failure("filters", 400, requestId);
   if (body?.code === "NOT_FOUND" || res.status === 404) return failure("not_found", 404, requestId);
   return failure("unavailable", 503, requestId);
}

interface Options {
   db: D1Database;
   secret: string;
   base: string;
   local?: boolean;
   fetch?: typeof fetch;
   wait?: (ms: number) => Promise<unknown>;
   /** An administrator explicitly retries a blocked credential through catalog lookup. */
   retryCredential?: boolean;
}

function qafEndpoint(base: string, path: string, local: boolean): string | null {
   if (!isAllowedProviderUrl(base, { local })) return null;
   const url = new URL(base);
   if (base !== QAF_API_BASE && (!local || !isLoopbackHostname(url.hostname) || url.pathname !== "/qaf/v1" || url.search || url.hash)) return null;
   const endpoint = base + path;
   // Catalog queries support 200 characters. Percent-encoded Unicode can take more than 1,000 bytes.
   return isAllowedProviderUrl(endpoint, { local, maxLength: 4096 }) ? endpoint : null;
}

export async function callQaf(o: Options, op: Operation): Promise<QafResult> {
   const search = "search" in op;
   const path = search ? "/search" : op.path;
   const endpoint = qafEndpoint(o.base, path, o.local === true);
   if (!endpoint) return failure("unavailable", 503);
   const settings = await qafSettings(o.db);
   if (!settings?.sealed_key) return failure("not_configured", 503);
   const { generation, error, request_id, retry_at, weekly_reset_at } = settings;
   if (error && error !== "week" && (!o.retryCredential || remainingSeconds(retry_at) > 0)) {
      return failure(error, error === "invalid_keys" ? 429 : 503, request_id, error === "invalid_keys" ? remainingSeconds(retry_at) : undefined);
   }
   const body = search ? JSON.stringify(op.search) : undefined;
   const cacheKey = body === undefined ? null : await sha256(`${generation}:v1:${body}`);
   if (cacheKey) {
      const hit = await o.db.prepare("SELECT data, request_id FROM qaf_search_cache WHERE key = ?1 AND expires_at > ?2")
         .bind(cacheKey, Date.now()).first<{ data: string; request_id: string | null }>();
      if (hit) return { ok: true, data: JSON.parse(hit.data), requestId: hit.request_id, cached: true };
      if (remainingSeconds(weekly_reset_at) > 0) return failure("week", 429, request_id, remainingSeconds(weekly_reset_at));
   }

   let key: string;
   try {
      key = await openQafKey(o.secret, settings.sealed_key);
   } catch {
      await flagQaf(o.db, generation, "sealed_key", null, null);
      return failure("sealed_key", 503);
   }

   const wait = o.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
   let retryMinute = true;
   for (let attempt = 0; ; attempt++) {
      if (attempt) {
         const current = await qafSettings(o.db);
         if (current?.generation !== generation) return failure("not_configured", 503);
         if (current.error === "invalid_keys" || current.error === "auth" || current.error === "sealed_key") {
            if (!o.retryCredential) return failure(current.error, current.error === "invalid_keys" ? 429 : 503, current.request_id, remainingSeconds(current.retry_at));
         }
         if (search && remainingSeconds(current.weekly_reset_at) > 0)
            return failure("week", 429, current.request_id, remainingSeconds(current.weekly_reset_at));
      }
      let result: QafResult;
      let serverFailure = false;
      try {
         const res = await (o.fetch ?? fetch)(endpoint, {
            method: search ? "POST" : "GET",
            headers: { Authorization: `Bearer ${key}`, Accept: "application/json", ...(search ? { "Content-Type": "application/json" } : {}) },
            body,
            redirect: "manual",
            signal: AbortSignal.timeout(32_000),
         });
         if (res.status >= 300 && res.status < 400) return failure("unavailable", 503, requestIdOf(res));
         serverFailure = res.status >= 500;
         const data: unknown = await res.json().catch(() => null);
         result = res.ok && object(data) && !JSON.stringify(data).includes(key) ? { ok: true, data, requestId: requestIdOf(res) } : classify(res, data);
      } catch {
         result = failure("unavailable", 503);
      }
      // A replaced or removed key invalidates in-flight results and stops additional attempts.
      if ((await qafSettings(o.db))?.generation !== generation) return failure("not_configured", 503);
      if (result.ok) {
         if (cacheKey) {
            const now = Date.now();
            await o.db.batch([
               o.db.prepare("INSERT INTO qaf_search_usage (id, generation, at) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM qaf_settings WHERE generation = ?2)")
                  .bind(crypto.randomUUID(), generation, now),
               o.db.prepare(`INSERT INTO qaf_search_cache (key, generation, request_id, data, expires_at)
                  SELECT ?1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM qaf_settings WHERE generation = ?2)
                  ON CONFLICT(key) DO UPDATE SET request_id = excluded.request_id, data = excluded.data, expires_at = excluded.expires_at`)
                  .bind(cacheKey, generation, result.requestId, JSON.stringify(result.data), now + WEEK_MS),
            ]);
         }
         if (o.retryCredential) {
            await o.db.prepare("UPDATE qaf_settings SET error = NULL, request_id = NULL, retry_at = NULL WHERE generation = ?1 AND error IS ?2 AND request_id IS ?3 AND error != 'week'")
               .bind(generation, error, request_id).run();
         }
         return result;
      }
      if (result.error === "minute" && retryMinute && (result.retryAfter ?? 60) <= 60) {
         retryMinute = false;
         await wait(Math.max(1, result.retryAfter ?? 60) * 1000);
         continue;
      }
      if (result.error === "unavailable" && attempt < 2) {
         // A 5xx may be retried. Do not replay a search after a transport timeout because Qaf may have billed it.
         if (serverFailure || !search) {
            await wait(500 * 2 ** attempt);
            continue;
         }
      }
      if (result.error === "week" || result.error === "invalid_keys" || result.error === "auth") {
         const retryAt = result.retryAfter === undefined ? null : Date.now() + result.retryAfter * 1000;
         await flagQaf(o.db, generation, result.error, result.requestId, retryAt);
      }
      log.warn("qaf request failed", { operation: search ? "search" : path.split("?")[0].split("/")[1], code: result.error, requestId: result.requestId });
      return result;
   }
}
