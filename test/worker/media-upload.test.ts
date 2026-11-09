import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CMS, cookiesOf, makeWorker, signIn } from "./helpers.ts";

let cookie = "";
// A minimal PNG signature plus a per-upload marker, so each upload has different bytes.
const png = (marker: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, marker & 0xff, (marker >> 8) & 0xff]);
const upload = (f: ReturnType<typeof makeWorker>, name: string, marker: number) =>
   f(`/api/media/upload/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { cookie, origin: CMS, "content-type": "image/png" },
      body: png(marker),
   });
const stored = async (name: string) => {
   const obj = await env.MEDIA.get(name);
   return obj ? [...new Uint8Array(await obj.arrayBuffer())] : null;
};
const rows = async (name: string) =>
   Number((await env.DB.prepare("SELECT COUNT(*) AS n FROM media WHERE path = ?1").bind(name).first<{ n: number }>())?.n);

describe("media uploads never overwrite an existing object (CMS-1)", () => {
   beforeAll(async () => {
      const { callback } = await signIn(["Moderator"], { id: "media-ed", email: "media@example.com" });
      cookie = cookiesOf(callback);
   });
   beforeEach(async () => {
      await env.DB.prepare("DELETE FROM media").run();
   });

   it("a second upload with the same name is a 409 and the first file's bytes stay", async () => {
      const f = makeWorker();
      const first = await upload(f, "cover.png", 1);
      expect(first.status).toBe(201);
      const second = await upload(f, "cover.png", 2);
      expect(second.status).toBe(409);
      expect(((await second.json()) as { message: string }).message).toMatch(/already exists/);
      expect(await stored("cover.png")).toEqual([...png(1)]);
      expect(await rows("cover.png")).toBe(1);
   });

   it("50 parallel uploads with one name: exactly one wins, R2 holds its bytes, one media row", async () => {
      const f = makeWorker();
      const N = 50;
      const out = await Promise.all(Array.from({ length: N }, (_, i) => upload(f, "race.png", 100 + i)));
      const statuses = out.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(N - 1);
      const winner = statuses.indexOf(201);
      expect(await stored("race.png")).toEqual([...png(100 + winner)]);
      expect(await rows("race.png")).toBe(1);
   });

   it("an object already in R2 without a media row is protected too", async () => {
      await env.MEDIA.put("orphan.png", png(7));
      const f = makeWorker();
      const res = await upload(f, "orphan.png", 8);
      expect(res.status).toBe(409);
      expect(await stored("orphan.png")).toEqual([...png(7)]);
   });

   it("uploads without a name get a generated one and never collide", async () => {
      const f = makeWorker();
      const out = await Promise.all(
         Array.from({ length: 20 }, (_, i) =>
            f("/api/media/upload", { method: "POST", headers: { cookie, origin: CMS, "content-type": "image/png" }, body: png(200 + i) }).then(async (r) => ({
               status: r.status,
               name: ((await r.json()) as { name: string }).name,
            })),
         ),
      );
      expect(out.every((o) => o.status === 201)).toBe(true);
      expect(new Set(out.map((o) => o.name)).size).toBe(20);
   });
});
