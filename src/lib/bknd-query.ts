/**
 * Query parameter and filter guard for bknd's `/api/data/entity/*` endpoints (injection audit CMS-7).
 *
 * Defends against:
 * - Operator injection in `where` JSON (nested `$or`/`$and`/`$not`, unknown `$` operators like `$where`/`$sql`,
 *   deeply nested payloads, prototype pollution keys `__proto__`/`constructor`/`prototype`).
 * - Relation traversal / unauthorized joins (`with`, `join` query parameters; dotted field paths).
 * - Unvalidated `sort`, `select`, `limit`, and `offset` parameters.
 */

const FIELD_RE = /^[a-z][a-z0-9_]{0,63}$/;
const SORT_RE = /^-?[a-z][a-z0-9_]{0,63}(?:,-?[a-z][a-z0-9_]{0,63}){0,3}$/;
const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);

const SAFE_LEAF_OPS = new Set([
   "$eq",
   "$ne",
   "$gt",
   "$gte",
   "$lt",
   "$lte",
   "$in",
   "$notin",
   "$like",
   "$ilike",
   "$isnull",
   "$notnull",
   "$between",
]);

const MAX_DEPTH = 4;
const MAX_KEYS = 40;
const MAX_ARRAY = 100;
const MAX_WHERE_CHARS = 8192;
const MAX_LIMIT = 500;
const MAX_OFFSET = 100_000;

export type QueryVerdict = { ok: true } | { ok: false; message: string };

function isPrimitive(v: unknown): boolean {
   return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

function validateWhereNode(
   node: unknown,
   opts: { allowLogical: boolean; depth: number; state: { keys: number } },
): string | null {
   if (opts.depth > MAX_DEPTH) return "where filter is nested too deeply";
   if (!node || typeof node !== "object" || Array.isArray(node)) return "where filter must be a JSON object";
   for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (PROTO_KEYS.has(k)) return "invalid key in where filter";
      opts.state.keys += 1;
      if (opts.state.keys > MAX_KEYS) return "where filter has too many conditions";
      if (k.startsWith("$")) {
         if (k === "$or" || k === "$and") {
            if (!opts.allowLogical) return `operator "${k}" is not allowed`;
            if (!Array.isArray(v) || v.length === 0 || v.length > 20) return `operator "${k}" requires a non-empty list`;
            for (const branch of v) {
               const err = validateWhereNode(branch, { ...opts, depth: opts.depth + 1 });
               if (err) return err;
            }
            continue;
         }
         return `operator "${k}" is not allowed at top level`;
      }
      if (!FIELD_RE.test(k)) return `invalid field name "${k}"`;
      if (isPrimitive(v)) continue;
      if (Array.isArray(v)) {
         if (v.length > MAX_ARRAY || v.some((x) => !isPrimitive(x))) return `invalid value list for "${k}"`;
         continue;
      }
      if (typeof v === "object") {
         const err = validateFieldOps(k, v as Record<string, unknown>, opts.state);
         if (err) return err;
         continue;
      }
      return `invalid value for "${k}"`;
   }
   return null;
}

function validateFieldOps(field: string, ops: Record<string, unknown>, state: { keys: number }): string | null {
   const entries = Object.entries(ops);
   if (entries.length === 0) return `empty operator object for "${field}"`;
   for (const [op, val] of entries) {
      if (PROTO_KEYS.has(op)) return "invalid key in where filter";
      state.keys += 1;
      if (state.keys > MAX_KEYS) return "where filter has too many conditions";
      if (!SAFE_LEAF_OPS.has(op)) return `operator "${op}" is not allowed`;
      if (op === "$in" || op === "$notin" || op === "$between") {
         if (!Array.isArray(val) || val.length > MAX_ARRAY || val.some((x) => !isPrimitive(x))) {
            return `operator "${op}" requires a list of scalar values`;
         }
         if (op === "$between" && val.length !== 2) return `operator "$between" requires two values`;
      } else if (op === "$isnull" || op === "$notnull") {
         if (typeof val !== "boolean") return `operator "${op}" requires a boolean`;
      } else {
         if (!isPrimitive(val)) return `operator "${op}" requires a scalar value`;
      }
   }
   return null;
}

/** Validates a parsed `where` JSON object. */
export function validateWhereObject(where: unknown, opts: { allowLogical: boolean }): QueryVerdict {
   const err = validateWhereNode(where, { allowLogical: opts.allowLogical, depth: 0, state: { keys: 0 } });
   return err ? { ok: false, message: err } : { ok: true };
}

/** Recursively strips any `$`-prefixed logical/unknown keys and prototype keys from a `where` object. */
export function sanitizeScopedWhere(where: Record<string, unknown>, forbiddenFields: readonly string[]): Record<string, unknown> {
   const out: Record<string, unknown> = {};
   const forbidden = new Set(forbiddenFields);
   for (const [k, v] of Object.entries(where)) {
      if (k.startsWith("$") || PROTO_KEYS.has(k) || forbidden.has(k) || !FIELD_RE.test(k)) continue;
      if (isPrimitive(v)) {
         out[k] = v;
      } else if (Array.isArray(v)) {
         if (v.length <= MAX_ARRAY && v.every(isPrimitive)) out[k] = v;
      } else if (v && typeof v === "object") {
         const cleanOps: Record<string, unknown> = {};
         for (const [op, val] of Object.entries(v as Record<string, unknown>)) {
            if (PROTO_KEYS.has(op) || !SAFE_LEAF_OPS.has(op)) continue;
            if (op === "$in" || op === "$notin" || op === "$between") {
               if (Array.isArray(val) && val.length <= MAX_ARRAY && val.every(isPrimitive)) cleanOps[op] = val;
            } else if (op === "$isnull" || op === "$notnull") {
               if (typeof val === "boolean") cleanOps[op] = val;
            } else if (isPrimitive(val)) {
               cleanOps[op] = val;
            }
         }
         if (Object.keys(cleanOps).length > 0) out[k] = cleanOps;
      }
   }
   return out;
}

/**
 * Validates query parameters (and `/fn/count` JSON body) on incoming `/api/data/entity/*` requests.
 * For scoped roles (`writer`, `staff_writer`), logical operators (`$or`/`$and`) and relation joins
 * (`with`/`join`) are unconditionally rejected.
 */
export async function validateBkndEntityRequest(request: Request, opts: { scopedRole: boolean }): Promise<QueryVerdict> {
   const url = new URL(request.url);
   const params = url.searchParams;

   // Relation expansion (`with` / `join`) is never needed by the admin UI and can expose other tables (e.g. users).
   if (params.has("with") || params.has("join")) {
      return { ok: false, message: "relation joins are not allowed" };
   }

   const whereRaw = params.get("where");
   if (whereRaw !== null && whereRaw !== "") {
      if (whereRaw.length > MAX_WHERE_CHARS) return { ok: false, message: "where filter is too large" };
      let parsed: unknown;
      try {
         parsed = JSON.parse(whereRaw);
      } catch {
         return { ok: false, message: "where must be valid JSON" };
      }
      const v = validateWhereObject(parsed, { allowLogical: !opts.scopedRole });
      if (!v.ok) return v;
   }

   const sort = params.get("sort");
   if (sort !== null && sort !== "") {
      if (!SORT_RE.test(sort)) return { ok: false, message: "invalid sort parameter" };
   }

   const select = params.get("select");
   if (select !== null && select !== "") {
      const cols = select.split(",");
      if (cols.length > 40 || cols.some((c) => !FIELD_RE.test(c))) {
         return { ok: false, message: "invalid select parameter" };
      }
   }

   const limit = params.get("limit");
   if (limit !== null && limit !== "") {
      if (!/^\d+$/.test(limit)) return { ok: false, message: "invalid limit parameter" };
      const n = Number(limit);
      if (n < 1 || n > MAX_LIMIT) return { ok: false, message: `limit must be between 1 and ${MAX_LIMIT}` };
   }

   const offset = params.get("offset");
   if (offset !== null && offset !== "") {
      if (!/^\d+$/.test(offset)) return { ok: false, message: "invalid offset parameter" };
      const n = Number(offset);
      if (n < 0 || n > MAX_OFFSET) return { ok: false, message: `offset must be between 0 and ${MAX_OFFSET}` };
   }

   if (request.method === "POST" && /\/fn\/count\/?$/.test(url.pathname)) {
      const text = await request.clone().text();
      if (text.length > MAX_WHERE_CHARS) return { ok: false, message: "count filter is too large" };
      if (text.trim()) {
         let parsed: unknown;
         try {
            parsed = JSON.parse(text);
         } catch {
            return { ok: false, message: "count filter must be valid JSON" };
         }
         const v = validateWhereObject(parsed, { allowLogical: !opts.scopedRole });
         if (!v.ok) return v;
      }
   }

   return { ok: true };
}
