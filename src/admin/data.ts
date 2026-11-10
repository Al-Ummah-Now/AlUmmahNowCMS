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

   async post<T = unknown>(path: string, body: unknown): Promise<T> {
      const app = await this.deps.getApp(this.c);
      const cfg = this.c.get("cfg");
      const url = new URL(path, cfg.publicUrl);
      const req = new Request(url, {
         method: "POST",
         headers: { cookie: this.c.req.header("cookie") ?? "", accept: "application/json", "content-type": "application/json", origin: new URL(cfg.publicUrl).origin },
         body: JSON.stringify(body),
      });
      const res = await app.fetch(req, this.c.env, this.c.executionCtx);
      if (!res.ok) throw new DataError(res.status);
      return (await res.json()) as T;
   }

   /**
    * bknd 0.21's list `meta` carries no total (only `items`), so the total comes from its count
    * endpoint, unless the page itself proves there is nothing more.
    */
   async list<T = Row>(entity: string, q: ListQuery = {}): Promise<ListResult<T>> {
      const body = await this.get<{ data: T[]; meta?: { total?: number; count?: number; items?: number } }>(listUrl(entity, q));
      const known = body.meta?.count ?? body.meta?.total;
      if (known !== undefined) return { data: body.data, total: Number(known) };
      const complete = !q.offset && (q.limit === undefined || body.data.length < q.limit);
      return { data: body.data, total: complete ? body.data.length : await this.count(entity, q.where ?? {}) };
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
      const r = await this.post<{ count?: number }>(`/api/data/entity/${entity}/fn/count`, where);
      return Number(r.count ?? 0);
   }
}
