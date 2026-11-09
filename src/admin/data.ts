/**
 * Server-side reads for first paint, through bknd's own HTTP API with the signed-in user's cookie,
 * so bknd's guard decides what this user may read (docs/ADMIN_UI_SPEC.md §3).
 */
import type { Ctx, Deps } from "../types.ts";

export class DataError extends Error {
   constructor(readonly status: number) {
      super(`bknd answered ${status}`);
   }
}

export type Row = Record<string, unknown>;

export interface ListQuery {
   limit?: number;
   offset?: number;
   sort?: string;
   where?: Record<string, unknown>;
   select?: string[];
}

export interface ListResult<T = Row> {
   data: T[];
   total: number;
}

export function listUrl(entity: string, q: ListQuery = {}): string {
   const p = new URLSearchParams();
   if (q.limit !== undefined) p.set("limit", String(q.limit));
   if (q.offset) p.set("offset", String(q.offset));
   if (q.sort) p.set("sort", q.sort);
   if (q.where && Object.keys(q.where).length) p.set("where", JSON.stringify(q.where));
   if (q.select?.length) p.set("select", q.select.join(","));
   const qs = p.toString();
   return `/api/data/entity/${entity}${qs ? `?${qs}` : ""}`;
}

export class Data {
   constructor(
      private readonly c: Ctx,
      private readonly deps: Deps,
   ) {}

   async get<T = unknown>(path: string): Promise<T> {
      const app = await this.deps.getApp(this.c);
      const url = new URL(path, this.c.get("cfg").publicUrl);
      const req = new Request(url, { headers: { cookie: this.c.req.header("cookie") ?? "", accept: "application/json" } });
      const res = await app.fetch(req, this.c.env, this.c.executionCtx);
      if (!res.ok) throw new DataError(res.status);
      return (await res.json()) as T;
   }

   async list<T = Row>(entity: string, q: ListQuery = {}): Promise<ListResult<T>> {
      const body = await this.get<{ data: T[]; meta?: { total?: number; count?: number; items?: number } }>(listUrl(entity, q));
      const total = Number(body.meta?.count ?? body.meta?.total ?? body.data.length);
      return { data: body.data, total };
   }

   async one<T = Row>(entity: string, id: string | number): Promise<T | null> {
      try {
         const body = await this.get<{ data: T | null }>(`/api/data/entity/${entity}/${encodeURIComponent(String(id))}`);
         return body.data ?? null;
      } catch (e) {
         if (e instanceof DataError && e.status === 404) return null;
         throw e;
      }
   }

   async count(entity: string, where: Record<string, unknown> = {}): Promise<number> {
      const r = await this.list(entity, { limit: 1, where, select: ["id"] });
      return r.total;
   }
}
