/**
 * Image variants on the deployed CMS (CMS-10): a photo uploaded through the staff API is resized by
 * the queue consumer into AVIF/WebP/JPEG; the public media route serves the original (short cache)
 * until a variant exists and the variant (immutable) afterwards; the original's bytes never change;
 * the Library says the sizes are ready; deleting the original removes its variants.
 *
 * HTTP only (desktop Chromium project). Uploads are named `variants-e2e-<base-36 time>.jpg` so a
 * crashed run's leftovers can be dated and deleted.
 */
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { photoJpeg } from "../test/worker/fixtures/images.ts";
import { ACCOUNTS, CMS_URL, hasCredentials } from "./support/env.ts";
import { sessionCookie } from "./support/sessions.ts";

test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "HTTP only: desktop Chromium is enough");
test.skip(!hasCredentials, "uploading needs QA_SEED_PASSWORD / SEED_PASSWORD");

const CMS = new URL(CMS_URL).origin;
const PREFIX = "variants-e2e-";
const NAME = `${PREFIX}${Date.now().toString(36)}.jpg`;
const media = (name: string, q = "") => `${CMS}/api/public/v1/media/${encodeURIComponent(name)}${q}`;
const sha = (b: Uint8Array | ArrayBuffer) => createHash("sha256").update(new Uint8Array(b)).digest("hex");

let cookie = "";
async function staff(method: string, path: string, body?: BodyInit, type?: string) {
   if (!cookie) cookie = await sessionCookie(ACCOUNTS.admin);
   return fetch(`${CMS}${path}`, { method, headers: { cookie, origin: CMS, accept: "application/json", ...(type ? { "content-type": type } : {}) }, body });
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
   // Leftovers of crashed runs (older than an hour, so a parallel run's file stays).
   const where = encodeURIComponent(JSON.stringify({ path: { $like: `${PREFIX}*` } }));
   const res = await staff("GET", `/api/data/entity/media?where=${where}&select=id,path&limit=50`);
   const rows = res.ok ? (((await res.json()) as { data?: { path: string }[] }).data ?? []) : [];
   for (const { path } of rows) {
      const made = parseInt(path.slice(PREFIX.length), 36);
      if (Number.isFinite(made) && Date.now() - made > 60 * 60_000) await staff("DELETE", `/api/media/file/${encodeURIComponent(path)}`);
   }
});

test.afterAll(async () => {
   await staff("DELETE", `/api/media/file/${encodeURIComponent(NAME)}`).catch(() => undefined);
});

test("an uploaded photo gets AVIF/WebP/JPEG variants; the original stays byte-for-byte", async ({ request }) => {
   const up = await staff("POST", `/api/media/upload/${encodeURIComponent(NAME)}`, photoJpeg, "image/jpeg");
   expect(up.status, await up.text()).toBe(201);

   // Until the job has run, a variant URL answers with the original and a short cache.
   const first = await request.get(media(NAME, "?w=640&f=avif"));
   expect(first.status()).toBe(200);
   if (first.headers()["x-variant"] === "pending") expect(first.headers()["cache-control"]).toBe("public, max-age=60, s-maxage=60");

   // The queue consumer makes them in the background (seconds; allow for queue delivery).
   await expect
      .poll(async () => (await request.get(media(NAME, "?w=640&f=avif"), { headers: { "cache-control": "no-cache" } })).headers()["x-variant"], { timeout: 180_000, intervals: [2_000, 5_000] })
      .toBe("hit");

   // Each width is its own queue message, so they finish at different times: wait for each.
   for (const [f, type] of [["avif", "image/avif"], ["webp", "image/webp"], ["jpeg", "image/jpeg"]] as const) {
      for (const w of [320, 640, 960, 1200]) {
         await expect.poll(async () => (await request.get(media(NAME, `?w=${w}&f=${f}`))).headers()["x-variant"], { message: `${w}.${f}`, timeout: 180_000, intervals: [2_000, 5_000] }).toBe("hit");
         const res = await request.get(media(NAME, `?w=${w}&f=${f}`));
         expect(res.status(), `${w}.${f}`).toBe(200);
         expect(res.headers()["content-type"]).toBe(type);
         expect(res.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
         const bytes = (await res.body()).byteLength;
         expect(bytes, `${w}.${f} smaller than the original`).toBeLessThan(photoJpeg.byteLength);
      }
   }

   const original = await request.get(media(NAME));
   expect(original.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
   expect(sha(await original.body())).toBe(sha(photoJpeg));

   // The Library card says the sizes are ready.
   const lib = await (await staff("GET", "/library")).text();
   const card = lib.slice(lib.indexOf(`data-path="${NAME}"`), lib.indexOf(`data-path="${NAME}"`) + 4000);
   expect(card).toContain('data-variants="done"');
});

test("deleting the original removes its variants", async ({ request }) => {
   const del = await staff("DELETE", `/api/media/file/${encodeURIComponent(NAME)}`);
   expect(del.ok, await del.text()).toBe(true);
   await expect.poll(async () => (await request.get(media(NAME, "?w=320&f=webp"))).status(), { timeout: 30_000 }).toBe(404);
   expect((await request.get(media(NAME))).status()).toBe(404);
});
