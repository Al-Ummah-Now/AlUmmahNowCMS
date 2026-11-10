import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { decodeScaled } from "../../src/lib/variants/codecs.ts";
import { consumeVariants, enqueueVariants, retryVariants, sweepVariants, type VariantMessage } from "../../src/lib/variants/jobs.ts";
import { encodePng } from "../../src/lib/variants/png.ts";
import { probeImage } from "../../src/lib/variants/probe.ts";
import { variantKey } from "../../src/lib/variants/plan.ts";
import { photoAvif, photoJpeg, photoWebp, rotatedJpeg } from "./fixtures/images.ts";
import { CMS, cookiesOf, makeWorker, signIn } from "./helpers.ts";

/** A queue binding that records what was sent instead of delivering it. */
function fakeQueue() {
   const sent: VariantMessage[] = [];
   const queue = {
      send: async (body: VariantMessage) => void sent.push(body),
      sendBatch: async (msgs: { body: VariantMessage }[]) => void sent.push(...msgs.map((m) => m.body)),
   };
   return { sent, queue: queue as unknown as Queue<VariantMessage> };
}

type Outcome = { acked: boolean; retried?: { delaySeconds?: number } };
/** Runs one message through the consumer; reports ack/retry. */
async function run(e: typeof env, body: VariantMessage, attempts = 1): Promise<Outcome> {
   const out: Outcome = { acked: false };
   const msg = { id: "m", timestamp: new Date(), body, attempts, ack: () => void (out.acked = true), retry: (o?: { delaySeconds?: number }) => void (out.retried = o ?? {}) };
   await consumeVariants({ queue: "q", messages: [msg], ackAll() {}, retryAll() {} } as unknown as MessageBatch<VariantMessage>, e);
   return out;
}

/** Drains a fake queue through the consumer until nothing is left. */
async function drain(e: typeof env, sent: VariantMessage[]) {
   for (let i = 0; i < 50 && sent.length; i++) await run(e, sent.shift()!);
   expect(sent).toEqual([]);
}

async function addMedia(path: string, mime: string, bytes: Uint8Array, meta: Record<string, unknown> = {}, ref: [string, string] | null = null) {
   await env.DB.prepare("INSERT INTO media (path, mime_type, size, reference, entity_id, scope, metadata) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
      .bind(path, mime, bytes.byteLength, ref?.[0] ?? null, ref?.[1] ?? null, ref ? "cover" : null, JSON.stringify(meta))
      .run();
   await env.MEDIA.put(path, bytes);
}

const row = (path: string) => env.DB.prepare("SELECT * FROM media_variants WHERE path = ?1").bind(path).first<Record<string, unknown>>();
const bytesOf = async (key: string) => {
   const o = await env.MEDIA.get(key);
   return o ? new Uint8Array(await o.arrayBuffer()) : null;
};
const magic = (b: Uint8Array) =>
   b[0] === 0xff && b[1] === 0xd8 ? "jpeg" : b[0] === 0x89 && b[1] === 0x50 ? "png" : String.fromCharCode(...b.subarray(8, 12)) === "WEBP" ? "webp" : String.fromCharCode(...b.subarray(4, 8)) === "ftyp" ? "avif" : "?";

async function clearAll() {
   await env.DB.batch([env.DB.prepare("DELETE FROM media"), env.DB.prepare("DELETE FROM media_variants"), env.DB.prepare("DELETE FROM posts")]);
   const list = await env.MEDIA.list();
   if (list.objects.length) await env.MEDIA.delete(list.objects.map((o) => o.key));
}

describe("image variants: queued job (CMS-10)", () => {
   beforeEach(clearAll);

   it("makes AVIF, WebP and JPEG at every width from a JPEG, leaves the original untouched, marks done", async () => {
      const { sent, queue } = fakeQueue();
      const e = { ...env, VARIANTS: queue };
      await addMedia("photo.jpg", "image/jpeg", photoJpeg, { width: 1200, height: 600 });

      expect(await enqueueVariants(e, "photo.jpg")).toBe(true);
      expect(await enqueueVariants(e, "photo.jpg")).toBe(false); // idempotent: one row, one message
      expect(sent).toEqual([{ kind: "plan", path: "photo.jpg" }]);
      expect((await row("photo.jpg"))?.status).toBe("queued");

      await run(e, sent.shift()!);
      expect(sent.map((m) => (m.kind === "width" ? m.width : 0))).toEqual([320, 640, 960, 1200]);
      expect((await row("photo.jpg"))?.status).toBe("processing");
      await drain(e, sent);

      const r = await row("photo.jpg");
      expect(r).toMatchObject({ status: "done", width: 1200, height: 600, error: null });
      expect(JSON.parse(String(r!.done_widths))).toEqual([320, 640, 960, 1200]);
      for (const w of [320, 640, 960, 1200]) {
         for (const f of ["avif", "webp", "jpeg"] as const) {
            const b = await bytesOf(variantKey("photo.jpg", w, f));
            expect(b, `${w}.${f}`).not.toBeNull();
            expect(magic(b!)).toBe(f);
         }
         expect(probeImage((await bytesOf(variantKey("photo.jpg", w, "jpeg")))!, "image/jpeg")).toMatchObject({ width: w, height: w / 2 });
      }
      // Smaller than the original, and the original's bytes are exactly as uploaded.
      expect((await bytesOf(variantKey("photo.jpg", 640, "avif")))!.byteLength).toBeLessThan(photoJpeg.byteLength / 4);
      expect([...(await bytesOf("photo.jpg"))!]).toEqual([...photoJpeg]);
   });

   it("is idempotent: a repeated width message re-uses the objects it already made", async () => {
      const { sent, queue } = fakeQueue();
      const e = { ...env, VARIANTS: queue };
      await addMedia("p.jpg", "image/jpeg", photoJpeg);
      await enqueueVariants(e, "p.jpg");
      await drain(e, sent);
      const before = (await env.MEDIA.head(variantKey("p.jpg", 320, "webp")))!.uploaded.getTime();
      expect((await run(e, { kind: "width", path: "p.jpg", width: 320 })).acked).toBe(true);
      expect((await env.MEDIA.head(variantKey("p.jpg", 320, "webp")))!.uploaded.getTime()).toBe(before);
      expect((await row("p.jpg"))?.status).toBe("done");
   });

   it("applies EXIF orientation (a portrait-stored photo tagged 6 comes out landscape, the right way round)", async () => {
      const { sent, queue } = fakeQueue();
      const e = { ...env, VARIANTS: queue };
      await addMedia("r.jpg", "image/jpeg", rotatedJpeg, { width: 100, height: 200 }); // bknd's raw size
      await enqueueVariants(e, "r.jpg");
      await drain(e, sent);
      expect(await row("r.jpg")).toMatchObject({ status: "done", width: 200, height: 100 });
      const out = await decodeScaled((await bytesOf(variantKey("r.jpg", 200, "jpeg")))!, "image/jpeg", { width: 200, height: 100, orientation: 1 }, 1e7, 200, 100);
      const at = (x: number, y: number) => [...out.data.subarray((y * 200 + x) * 4, (y * 200 + x) * 4 + 3)];
      // Stored: top half red, bottom half blue. Rotating 90° clockwise puts the top on the right.
      const [lr, , lb] = at(20, 50);
      const [rr, , rb] = at(180, 50);
      expect(lb).toBeGreaterThan(200); // left blue
      expect(lr).toBeLessThan(60);
      expect(rr).toBeGreaterThan(200); // right red
      expect(rb).toBeLessThan(60);
   });

   it("keeps transparency for PNG (PNG fallback) and decodes WebP and AVIF sources", async () => {
      const { sent, queue } = fakeQueue();
      const e = { ...env, VARIANTS: queue };
      const w = 700, h = 350;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) data.set([200, 30, 30, (i / 4) % w < w / 2 ? 255 : 0], i);
      await addMedia("logo.png", "image/png", await encodePng({ data, width: w, height: h }));
      await addMedia("p.webp", "image/webp", photoWebp);
      await addMedia("p.avif", "image/avif", photoAvif);
      for (const p of ["logo.png", "p.webp", "p.avif"]) await enqueueVariants(e, p);
      await drain(e, sent);

      expect(await row("logo.png")).toMatchObject({ status: "done", width: 700 });
      const png = (await bytesOf(variantKey("logo.png", 320, "png")))!;
      expect(magic(png)).toBe("png");
      expect(png[25]).toBe(6); // RGBA kept
      expect(await env.MEDIA.head(variantKey("logo.png", 320, "jpeg"))).toBeNull();
      for (const p of ["p.webp", "p.avif"]) {
         expect(await row(p)).toMatchObject({ status: "done", width: 300, height: 150 });
         expect(magic((await bytesOf(variantKey(p, 300, "avif")))!)).toBe("avif");
         expect(magic((await bytesOf(variantKey(p, 300, "jpeg")))!)).toBe("jpeg");
      }
   });

   it("fails at once, with the reason, when the original is too large; nothing is retried", async () => {
      const { sent, queue } = fakeQueue();
      const e = { ...env, VARIANTS: queue };
      const huge = await encodePng({ data: new Uint8ClampedArray(4 * 4), width: 2, height: 2 });
      new DataView(huge.buffer).setUint32(16, 9000);
      new DataView(huge.buffer).setUint32(20, 9000);
      await addMedia("huge.png", "image/png", huge);
      await enqueueVariants(e, "huge.png");
      const out = await run(e, sent.shift()!);
      expect(out).toEqual({ acked: true });
      expect(await row("huge.png")).toMatchObject({ status: "failed" });
      expect(String((await row("huge.png"))?.error)).toMatch(/too large to resize \(9000×9000/);
      expect(sent).toEqual([]);
   });

   it("retries a transient failure with backoff, then flags it failed after the last attempt", async () => {
      const { queue } = fakeQueue();
      const broken = { ...queue, sendBatch: async () => Promise.reject(new Error("queue unavailable")) } as unknown as Queue<VariantMessage>;
      const e = { ...env, VARIANTS: broken };
      await addMedia("t.jpg", "image/jpeg", photoJpeg);
      await env.DB.prepare("INSERT INTO media_variants (path, status, queued_at, updated_at) VALUES ('t.jpg', 'queued', 'x', 'x')").run();

      expect(await run(e, { kind: "plan", path: "t.jpg" }, 1)).toEqual({ acked: false, retried: { delaySeconds: 30 } });
      expect(await row("t.jpg")).toMatchObject({ status: "processing", error: "queue unavailable" });
      expect(await run(e, { kind: "plan", path: "t.jpg" }, 3)).toEqual({ acked: false, retried: { delaySeconds: 120 } });
      expect(await run(e, { kind: "plan", path: "t.jpg" }, 5)).toEqual({ acked: true });
      expect(await row("t.jpg")).toMatchObject({ status: "failed", error: "queue unavailable" });
   });

   it("a job that keeps starting without finishing (e.g. out of memory) is flagged, not looped forever", async () => {
      const { queue } = fakeQueue();
      const e = { ...env, VARIANTS: queue };
      await addMedia("oom.jpg", "image/jpeg", photoJpeg);
      await env.DB.prepare("INSERT INTO media_variants (path, status, widths, attempts, queued_at, updated_at) VALUES ('oom.jpg', 'processing', '[320]', 8, 'x', 'x')").run();
      expect((await run(e, { kind: "width", path: "oom.jpg", width: 320 })).acked).toBe(true);
      expect(await row("oom.jpg")).toMatchObject({ status: "failed" });
      expect(String((await row("oom.jpg"))?.error)).toMatch(/kept failing/);
      expect(await env.MEDIA.head(variantKey("oom.jpg", 320, "avif"))).toBeNull();
   });

   it("Retry puts a failed original back in the queue; the sweep backfills, resends lost jobs and removes orphans", async () => {
      const { sent, queue } = fakeQueue();
      const e = { ...env, VARIANTS: queue };
      await addMedia("a.jpg", "image/jpeg", photoJpeg);
      await addMedia("b.jpg", "image/jpeg", photoJpeg);
      await addMedia("c.jpg", "image/jpeg", photoJpeg);
      const old = "2020-01-01T00:00:00.000Z";
      await env.DB.batch([
         env.DB.prepare(`INSERT INTO media_variants (path, status, error, attempts, queued_at, updated_at) VALUES ('a.jpg', 'failed', 'boom', 5, '${old}', '${old}')`),
         env.DB.prepare(`INSERT INTO media_variants (path, status, queued_at, updated_at) VALUES ('b.jpg', 'queued', '${old}', '${old}')`),
         env.DB.prepare(`INSERT INTO media_variants (path, status, queued_at, updated_at) VALUES ('gone.jpg', 'done', '${old}', '${old}')`),
      ]);
      await env.MEDIA.put(variantKey("gone.jpg", 320, "avif"), new Uint8Array([1]));

      expect(await retryVariants(e, "a.jpg")).toBe(true);
      expect(await row("a.jpg")).toMatchObject({ status: "queued", attempts: 0, error: null });
      expect(await retryVariants(e, "nope.jpg")).toBe(false);

      sent.length = 0;
      expect(await sweepVariants(e)).toEqual({ queued: 1, resent: 1, removed: 1 });
      expect(sent).toEqual(expect.arrayContaining([{ kind: "plan", path: "c.jpg" }, { kind: "plan", path: "b.jpg" }]));
      expect(await row("gone.jpg")).toBeNull();
      expect(await env.MEDIA.head(variantKey("gone.jpg", 320, "avif"))).toBeNull();
   });
});

describe("image variants: public media route and API fields (CMS-10)", () => {
   beforeEach(clearAll);

   it("serves the original (short cache) and queues the job until a variant exists, then the variant (immutable)", async () => {
      const { sent, queue } = fakeQueue();
      await addMedia("cover.jpg", "image/jpeg", photoJpeg, { width: 1200, height: 600 });
      const f = makeWorker(undefined, { VARIANTS: queue });

      const pending = await f("/api/public/v1/media/cover.jpg?w=640&f=avif");
      expect(pending.status).toBe(200);
      expect(pending.headers.get("x-variant")).toBe("pending");
      expect(pending.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
      expect(pending.headers.get("content-type")).toBe("image/jpeg");
      expect(new Uint8Array(await pending.arrayBuffer()).byteLength).toBe(photoJpeg.byteLength);
      expect(sent).toEqual([{ kind: "plan", path: "cover.jpg" }]);

      await drain({ ...env, VARIANTS: queue }, sent);
      const hit = await f("/api/public/v1/media/cover.jpg?w=640&f=avif");
      expect(hit.status).toBe(200);
      expect(hit.headers.get("x-variant")).toBe("hit");
      expect(hit.headers.get("content-type")).toBe("image/avif");
      expect(hit.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      const body = new Uint8Array(await hit.arrayBuffer());
      expect(magic(body)).toBe("avif");
      expect(body.byteLength).toBeLessThan(photoJpeg.byteLength);
      expect((await f("/api/public/v1/media/cover.jpg?w=640&f=avif", { headers: { "If-None-Match": hit.headers.get("etag")! } })).status).toBe(304);

      // The original without parameters is unchanged.
      const orig = await f("/api/public/v1/media/cover.jpg");
      expect(orig.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
      expect(orig.headers.get("x-variant")).toBeNull();
   });

   it("rejects malformed variant parameters and never serves _variants/ keys directly", async () => {
      await addMedia("x.jpg", "image/jpeg", photoJpeg);
      await env.MEDIA.put(variantKey("x.jpg", 320, "webp"), new Uint8Array([1, 2]));
      const f = makeWorker(undefined, { VARIANTS: fakeQueue().queue });
      for (const q of ["w=640", "w=2000&f=webp", "w=640&f=gif", "w=abc&f=webp"]) expect((await f(`/api/public/v1/media/x.jpg?${q}`)).status).toBe(400);
      expect((await f(`/api/public/v1/media/${variantKey("x.jpg", 320, "webp")}`)).status).toBe(404);
   });

   it("covers and inline body images carry variants (srcset per format) and the displayed size", async () => {
      const now = "2026-11-08T10:00:00.000Z";
      await env.DB.prepare(
         `INSERT INTO posts (id, slug, locale, title, body, status, published_at, tags, created_at, updated_at) VALUES
          (1, 'v', 'en', 'V', ?1, 'published', '${now}', '[]', '${now}', '${now}')`,
      )
         .bind("Text\n\n![inline](https://cms.test/api/public/v1/media/inline.png)\n\n![missing](https://cms.test/api/public/v1/media/nope.jpg)")
         .run();
      await addMedia("cover.jpg", "image/jpeg", rotatedJpeg, { width: 100, height: 200, alt: "A" }, ["posts.cover", "1"]);
      await addMedia("inline.png", "image/png", await encodePng({ data: new Uint8ClampedArray(700 * 10 * 4), width: 700, height: 10 }), { width: 700, height: 10 });
      // The job read the cover's displayed size (EXIF 6): it wins over bknd's stored one.
      await env.DB.prepare("INSERT INTO media_variants (path, status, width, height, queued_at, updated_at) VALUES ('cover.jpg', 'done', 200, 100, 'x', 'x')").run();

      const f = makeWorker(undefined, { VARIANTS: fakeQueue().queue });
      const post = (await (await f("/api/public/v1/posts/v?locale=en")).json()) as { cover: Record<string, unknown>; images: Record<string, unknown>[] };
      const u = "https://cms.test/api/public/v1/media/cover.jpg";
      expect(post.cover).toEqual({
         url: u,
         alt: "A",
         width: 200,
         height: 100,
         variants: {
            widths: [200],
            fallback_type: "image/jpeg",
            avif: `${u}?w=200&f=avif 200w`,
            webp: `${u}?w=200&f=webp 200w`,
            fallback: `${u}?w=200&f=jpeg 200w`,
         },
      });
      expect(post.images).toHaveLength(1);
      const i = "https://cms.test/api/public/v1/media/inline.png";
      expect(post.images[0]).toMatchObject({ url: i, width: 700, height: 10, variants: { widths: [320, 640, 700], fallback_type: "image/png" } });
      expect((post.images[0].variants as { fallback: string }).fallback).toBe(`${i}?w=320&f=png 320w, ${i}?w=640&f=png 640w, ${i}?w=700&f=png 700w`);
   });

   it("uploads may not use the reserved _variants/ name; deleting an original removes its variants", async () => {
      const { callback } = await signIn(["Admin"], { id: "var-admin", email: "variants@example.com" });
      const cookie = cookiesOf(callback);
      const { queue } = fakeQueue();
      const f = makeWorker(undefined, { VARIANTS: queue });
      const reserved = await f(`/api/media/upload/${encodeURIComponent("_variants/v1/x.jpg/320.jpg")}`, {
         method: "POST",
         headers: { cookie, origin: CMS, "content-type": "image/jpeg" },
         body: photoJpeg,
      });
      expect(reserved.status).toBe(400);

      const up = await f("/api/media/upload/del.jpg", { method: "POST", headers: { cookie, origin: CMS, "content-type": "image/jpeg" }, body: photoJpeg });
      expect(up.status).toBe(201);
      expect(await row("del.jpg")).toMatchObject({ status: "queued" }); // queued right after the upload
      await env.MEDIA.put(variantKey("del.jpg", 320, "avif"), new Uint8Array([1]));
      const del = await f(`/api/media/file/${encodeURIComponent("del.jpg")}`, { method: "DELETE", headers: { cookie, origin: CMS } });
      expect(del.ok).toBe(true);
      expect(await env.MEDIA.head(variantKey("del.jpg", 320, "avif"))).toBeNull();
      expect(await row("del.jpg")).toBeNull();
   });
});

describe("image variants: staff flags (CMS-10)", () => {
   beforeEach(clearAll);

   it("the Library flags a failed original with its reason and a Retry; the Overview counts failures; Retry re-queues", async () => {
      const { callback } = await signIn(["Moderator"], { id: "var-ed", email: "var-ed@example.com" });
      const cookie = cookiesOf(callback);
      const { sent, queue } = fakeQueue();
      const f = makeWorker(undefined, { VARIANTS: queue });
      await addMedia("bad.jpg", "image/jpeg", photoJpeg);
      await addMedia("ok.jpg", "image/jpeg", photoJpeg);
      await env.DB.batch([
         env.DB.prepare("INSERT INTO media_variants (path, status, error, queued_at, updated_at) VALUES ('bad.jpg', 'failed', 'too large to resize (9000×9000)', 'x', 'x')"),
         env.DB.prepare("INSERT INTO media_variants (path, status, queued_at, updated_at) VALUES ('ok.jpg', 'done', 'x', 'x')"),
      ]);

      const lib = await (await f("/library", { headers: { cookie } })).text();
      expect(lib).toContain('data-variants="failed"');
      expect(lib).toContain("Sizes not made");
      expect(lib).toContain("too large to resize (9000×9000)");
      expect(lib).toContain("data-variants-retry");
      expect(lib).toContain("Sizes ready");

      const home = await (await f("/", { headers: { cookie } })).text();
      expect(home).toContain("data-variants-alert");
      expect(home).toContain("1 image couldn&#39;t be resized");

      const retry = await f("/admin/api/media/variants/retry", {
         method: "POST",
         headers: { cookie, origin: CMS, "content-type": "application/json" },
         body: JSON.stringify({ path: "bad.jpg" }),
      });
      expect(retry.status).toBe(200);
      expect(sent).toEqual([{ kind: "plan", path: "bad.jpg" }]);
      expect(await row("bad.jpg")).toMatchObject({ status: "queued", error: null });
      expect((await f("/admin/api/media/variants/retry", { method: "POST", headers: { origin: CMS, "content-type": "application/json" }, body: "{}" })).status).not.toBe(200);
      const after = await (await f("/", { headers: { cookie } })).text();
      expect(after).not.toContain("data-variants-alert");
   });
});
