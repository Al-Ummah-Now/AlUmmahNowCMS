import { describe, expect, it } from "vitest";
import { backoffSeconds, fallbackFormat, formatsFor, heightFor, parseVariantQuery, variantKey, variantPrefix, widthsFor } from "../../src/lib/variants/plan.ts";
import { decodePngRows, encodePng, PngError } from "../../src/lib/variants/png.ts";
import { orientedRows, probeImage } from "../../src/lib/variants/probe.ts";
import { AreaResizer, resizeRgba } from "../../src/lib/variants/resize.ts";
import { bodyImagePaths } from "../../src/lib/variants/body-images.ts";

const solid = (w: number, h: number, rgba: [number, number, number, number]) => {
   const data = new Uint8ClampedArray(w * h * 4);
   for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
   return { data, width: w, height: h };
};
const px = (img: { data: Uint8ClampedArray; width: number }, x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

describe("variant plan", () => {
   it("makes the standard widths below the original plus the original's own width (capped at 1600)", () => {
      expect(widthsFor(4032)).toEqual([320, 640, 960, 1280, 1600]);
      expect(widthsFor(1600)).toEqual([320, 640, 960, 1280, 1600]);
      expect(widthsFor(1000)).toEqual([320, 640, 960, 1000]);
      expect(widthsFor(320)).toEqual([320]);
      expect(widthsFor(200)).toEqual([200]);
      expect(widthsFor(null)).toBeNull();
      expect(widthsFor(0)).toBeNull();
      expect(widthsFor(12.5)).toBeNull();
   });

   it("keeps the aspect ratio for heights", () => {
      expect(heightFor(4032, 3024, 320)).toBe(240);
      expect(heightFor(1200, 600, 640)).toBe(320);
      expect(heightFor(10000, 10, 320)).toBe(1);
   });

   it("PNG falls back to PNG (transparency); everything else to JPEG", () => {
      expect(fallbackFormat("image/png")).toBe("png");
      expect(fallbackFormat("image/jpeg")).toBe("jpeg");
      expect(fallbackFormat("image/webp")).toBe("jpeg");
      expect(formatsFor("image/avif")).toEqual(["avif", "webp", "jpeg"]);
   });

   it("keys variants under _variants/v1/<original path>/ so originals are never touched", () => {
      expect(variantKey("a/b.jpg", 640, "avif")).toBe("_variants/v1/a/b.jpg/640.avif");
      expect(variantKey("b.png", 320, "jpeg")).toBe("_variants/v1/b.png/320.jpg");
      expect(variantPrefix("b.png")).toBe("_variants/v1/b.png/");
   });

   it("parses ?w=&f= strictly", () => {
      const q = (s: string) => parseVariantQuery(new URLSearchParams(s));
      expect(q("")).toBeNull();
      expect(q("w=640&f=avif")).toEqual({ width: 640, format: "avif" });
      expect(q("w=1600&f=png")).toEqual({ width: 1600, format: "png" });
      for (const bad of ["w=640", "f=webp", "w=0&f=webp", "w=1601&f=webp", "w=064&f=webp", "w=6.4&f=webp", "w=640&f=gif", "w=-1&f=jpeg"]) expect(q(bad)).toBe("bad");
   });

   it("backs off exponentially, capped at 30 minutes", () => {
      expect([1, 2, 3, 4, 5, 10].map(backoffSeconds)).toEqual([30, 60, 120, 240, 480, 1800]);
   });
});

describe("area resizer", () => {
   it("averages exactly: 2×2 → 1×1", () => {
      const src = { data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 100, 100, 100, 255, 100, 100, 100, 255]), width: 2, height: 2 };
      expect(px(resizeRgba(src, 1, 1), 0, 0)).toEqual([114, 114, 114, 255]);
   });

   it("keeps a solid colour solid at non-integer ratios", () => {
      const out = resizeRgba(solid(1000, 333, [10, 200, 30, 255]), 317, 105);
      expect(out.width).toBe(317);
      expect(out.height).toBe(105);
      for (const [x, y] of [[0, 0], [316, 104], [158, 52]]) expect(px(out, x, y)).toEqual([10, 200, 30, 255]);
   });

   it("averages colour weighted by alpha (no dark fringes from transparent pixels)", () => {
      // A red opaque pixel next to a fully transparent black one → red at half alpha, not dark red.
      const src = { data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]), width: 2, height: 1 };
      expect(px(resizeRgba(src, 1, 1), 0, 0)).toEqual([255, 0, 0, 128]);
   });

   it("keeps left/right halves apart", () => {
      const src = solid(400, 10, [255, 0, 0, 255]);
      for (let y = 0; y < 10; y++) for (let x = 200; x < 400; x++) src.data.set([0, 0, 255, 255], (y * 400 + x) * 4);
      const out = resizeRgba(src, 100, 5);
      expect(px(out, 10, 2)).toEqual([255, 0, 0, 255]);
      expect(px(out, 90, 2)).toEqual([0, 0, 255, 255]);
   });

   it("refuses to upscale and checks the row count", () => {
      expect(() => new AreaResizer(10, 10, 11, 10)).toThrow();
      const r = new AreaResizer(4, 4, 2, 2);
      r.pushRow(new Uint8ClampedArray(16));
      expect(() => r.result()).toThrow(/expected 4 rows/);
   });

   it("returns a copy at the same size (the source may be a codec heap view)", () => {
      const src = solid(3, 3, [1, 2, 3, 4]);
      const out = resizeRgba(src, 3, 3);
      expect(out.data).not.toBe(src.data);
      expect([...out.data]).toEqual([...src.data]);
   });
});

describe("EXIF orientation", () => {
   // 2×1 stored image: A (red) then B (blue).
   const stored = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
   const collect = (o: number) => {
      const rows: number[][] = [];
      orientedRows(stored, 2, 1, o, (row, off) => rows.push([...row.subarray(off, off + (o >= 5 ? 4 : 8))]));
      return rows;
   };
   it("1 passes rows through; 2 mirrors; 3 rotates 180", () => {
      expect(collect(1)).toEqual([[255, 0, 0, 255, 0, 0, 255, 255]]);
      expect(collect(2)).toEqual([[0, 0, 255, 255, 255, 0, 0, 255]]);
      expect(collect(3)).toEqual([[0, 0, 255, 255, 255, 0, 0, 255]]);
   });
   it("6 (rotate 90° clockwise) turns a 2×1 row into a 1×2 column, A on top", () => {
      expect(collect(6)).toEqual([[255, 0, 0, 255], [0, 0, 255, 255]]);
   });
   it("8 (rotate 90° counter-clockwise) puts B on top", () => {
      expect(collect(8)).toEqual([[0, 0, 255, 255], [255, 0, 0, 255]]);
   });
});

describe("PNG", () => {
   it("round-trips RGBA with transparency and RGB when opaque", async () => {
      const img = solid(37, 11, [12, 34, 56, 128]);
      img.data.set([255, 255, 255, 0], 0);
      const png = await encodePng(img);
      expect(probeImage(png, "image/png")).toEqual({ width: 37, height: 11, orientation: 1 });
      const rows: number[][] = [];
      await decodePngRows(png, () => {}, (row) => rows.push([...row]));
      expect(rows).toHaveLength(11);
      expect(rows[0].slice(0, 8)).toEqual([255, 255, 255, 0, 12, 34, 56, 128]);
      expect(rows[10].slice(-4)).toEqual([12, 34, 56, 128]);

      const opaque = await encodePng(solid(5, 5, [1, 2, 3, 255]));
      expect(opaque[25]).toBe(2); // IHDR colour type: RGB
   });

   it("rejects non-PNG and interlaced PNGs with a clear reason", async () => {
      await expect(decodePngRows(new Uint8Array([1, 2, 3]), () => {}, () => {})).rejects.toThrow(PngError);
      const png = await encodePng(solid(2, 2, [0, 0, 0, 255]));
      png[28] = 1; // IHDR interlace byte (CRC is not checked)
      await expect(decodePngRows(png, () => {}, () => {})).rejects.toThrow(/interlaced/);
   });

   it("refuses a second or late IHDR, images over the pixel cap, and data that inflates past the header's size", async () => {
      const png = await encodePng(solid(4, 4, [0, 0, 0, 255]));
      // IHDR twice: the second (claiming 1×1) must not replace the first.
      const ihdr = png.subarray(8, 8 + 25);
      const twice = new Uint8Array([...png.subarray(0, 33), ...ihdr, ...png.subarray(33)]);
      await expect(decodePngRows(twice, () => {}, () => {})).rejects.toThrow(/IHDR must be the first chunk/);
      await expect(decodePngRows(png, () => {}, () => {}, 15)).rejects.toThrow(/too large to resize \(4×4\)/);

      // A 2×2 header over the IDAT of a 64×64 image: inflating stops at 2×(2·3+1) bytes.
      const big = await encodePng(solid(64, 64, [9, 9, 9, 255]));
      const bomb = new Uint8Array(big);
      new DataView(bomb.buffer).setUint32(16, 2);
      new DataView(bomb.buffer).setUint32(20, 2);
      await expect(decodePngRows(bomb, () => {}, () => {})).rejects.toThrow(/larger than its header says/);
   });
});

describe("header probe", () => {
   it("reads JPEG SOF size and EXIF orientation (5–8 swap width/height)", () => {
      const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x64, 0x00, 0xc8]; // 200 wide, 100 high
      const exif = (o: number) => {
         const tiff = [0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, o, 0, 0, 0, 0, 0, 0];
         const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
         return [0xff, 0xe1, ((body.length + 2) >> 8) & 255, (body.length + 2) & 255, ...body];
      };
      const jpeg = (o: number | null) => new Uint8Array([0xff, 0xd8, ...(o ? exif(o) : []), ...sof, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(probeImage(jpeg(null), "image/jpeg")).toEqual({ width: 200, height: 100, orientation: 1 });
      expect(probeImage(jpeg(3), "image/jpeg")).toEqual({ width: 200, height: 100, orientation: 3 });
      expect(probeImage(jpeg(6), "image/jpeg")).toEqual({ width: 100, height: 200, orientation: 6 });
      expect(probeImage(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg")).toBeNull();
   });

   it("reads WebP (VP8X) and AVIF (ispe) sizes", () => {
      const vp8x = new Uint8Array(30);
      vp8x.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
      vp8x.set([..."WEBPVP8X"].map((c) => c.charCodeAt(0)), 8);
      vp8x.set([0x2b, 0x01, 0x00], 24); // width-1 = 299
      vp8x.set([0x95, 0x00, 0x00], 27); // height-1 = 149
      expect(probeImage(vp8x, "image/webp")).toEqual({ width: 300, height: 150, orientation: 1 });

      const box = (type: string, body: number[]) => {
         const n = 8 + body.length;
         return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...[...type].map((c) => c.charCodeAt(0)), ...body];
      };
      const be = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
      const ispe = box("ispe", [0, 0, 0, 0, ...be(640), ...be(480)]);
      const meta = box("meta", [0, 0, 0, 0, ...box("iprp", box("ipco", ispe))]);
      const file = new Uint8Array([...box("ftyp", [..."avif"].map((c) => c.charCodeAt(0))), ...meta]);
      expect(probeImage(file, "image/avif")).toEqual({ width: 640, height: 480, orientation: 1 });

      // Several items (e.g. a small thumbnail first): the largest counts, so the cap can't be dodged.
      const thumb = box("ispe", [0, 0, 0, 0, ...be(16), ...be(16)]);
      const two = box("meta", [0, 0, 0, 0, ...box("iprp", box("ipco", [...thumb, ...box("ispe", [0, 0, 0, 0, ...be(9000), ...be(9000)])]))]);
      expect(probeImage(new Uint8Array([...box("ftyp", [..."avif"].map((c) => c.charCodeAt(0))), ...two]), "image/avif")).toEqual({ width: 9000, height: 9000, orientation: 1 });
   });
});

describe("inline body images", () => {
   const base = "https://cms.test";
   it("finds CMS media used as markdown images, by decoded path, once each", () => {
      const body = [
         "Intro ![a cat](https://cms.test/api/public/v1/media/cat%20one.jpg) text",
         '![](https://cms.test/api/public/v1/media/dir/b.png "title")',
         "![dup](https://cms.test/api/public/v1/media/cat%20one.jpg)",
         "![elsewhere](https://images.example/x.jpg)",
         "[a link, not an image](https://cms.test/api/public/v1/media/c.jpg)",
         "![traversal](https://cms.test/api/public/v1/media/..%2Fsecret)",
      ].join("\n");
      expect(bodyImagePaths(base, body)).toEqual(["cat one.jpg", "dir/b.png"]);
      expect(bodyImagePaths(`${base}/`, "![x](https://cms.test/api/public/v1/media/z.webp)")).toEqual(["z.webp"]);
   });
});
