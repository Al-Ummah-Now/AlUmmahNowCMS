/**
 * Decoders/encoders for image variants: Squoosh's codecs (mozjpeg, libwebp, libavif) compiled to
 * WASM, via @jsquash's builds, plus PNG in JS (./png.ts). Runs inside the CMS Worker's queue
 * consumer (no Cloudflare image product is enabled on the account; see docs/PUBLIC_API.md).
 *
 * Memory is the constraint (128 MB per isolate; WASM heaps never shrink):
 *   - every decode/encode gets a FRESH codec instance that is dropped afterwards, so its heap is
 *     garbage once the call returns, instead of one ever-growing heap per codec;
 *   - decoded pixels are read in place from the decoder's heap (no second full-size copy) and
 *     streamed row by row into the area resizer, so only the small result is kept.
 */
import jpegDecFactory from "@jsquash/jpeg/codec/dec/mozjpeg_dec.js";
import jpegDecWasm from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm";
import jpegEncFactory from "@jsquash/jpeg/codec/enc/mozjpeg_enc.js";
import jpegEncWasm from "@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm";
import { defaultOptions as jpegDefaults } from "@jsquash/jpeg/meta.js";
import webpDecFactory from "@jsquash/webp/codec/dec/webp_dec.js";
import webpDecWasm from "@jsquash/webp/codec/dec/webp_dec.wasm";
import webpEncFactory from "@jsquash/webp/codec/enc/webp_enc.js";
import webpEncWasm from "@jsquash/webp/codec/enc/webp_enc.wasm";
import { defaultOptions as webpDefaults } from "@jsquash/webp/meta.js";
import avifDecFactory from "@jsquash/avif/codec/dec/avif_dec.js";
import avifDecWasm from "@jsquash/avif/codec/dec/avif_dec.wasm";
import avifEncFactory from "@jsquash/avif/codec/enc/avif_enc.js";
import avifEncWasm from "@jsquash/avif/codec/enc/avif_enc.wasm";
import { defaultOptions as avifDefaults } from "@jsquash/avif/meta.js";
import { PermanentVariantError, type SourceType, type VariantFormat } from "./plan.ts";
import { decodePngRows, encodePng } from "./png.ts";
import { orientedRows, type Probe } from "./probe.ts";
import { AreaResizer, type Rgba } from "./resize.ts";

interface Emscripten {
   decode?: (...args: unknown[]) => { data: Uint8ClampedArray; width: number; height: number } | null;
   encode?: (...args: unknown[]) => Uint8Array | null;
}
type Factory = (opts: Record<string, unknown>) => Promise<Emscripten>;

/** A new instance of a codec; the caller drops it when done. Also returns its heap. */
async function instantiate(factory: Factory, wasm: WebAssembly.Module): Promise<{ mod: Emscripten; memory: () => ArrayBuffer | undefined }> {
   let mem: WebAssembly.Memory | undefined;
   const mod = await factory({
      noInitialRun: true,
      instantiateWasm(imports: WebAssembly.Imports, done: (i: WebAssembly.Instance) => void) {
         const inst = new WebAssembly.Instance(wasm, imports);
         mem = Object.values(inst.exports).find((v): v is WebAssembly.Memory => v instanceof WebAssembly.Memory);
         if (!mem) {
            for (const ns of Object.values(imports)) {
               const m = Object.values(ns ?? {}).find((v): v is WebAssembly.Memory => v instanceof WebAssembly.Memory);
               if (m) mem = m;
            }
         }
         done(inst);
         return inst.exports;
      },
   });
   return { mod, memory: () => mem?.buffer };
}

/**
 * Runs an emscripten decode so that the returned ImageData's pixels are a view into the codec's
 * heap instead of a copy: the codec builds `new Uint8ClampedArray(heapView)`, which copies, so the
 * constructor is swapped for one that returns a view of the same bytes during the (synchronous)
 * call only. No other code can run in between.
 */
function decodeInPlace(run: () => ReturnType<NonNullable<Emscripten["decode"]>>, heap: () => ArrayBuffer | undefined) {
   const Real = globalThis.Uint8ClampedArray;
   const InPlace = function (this: unknown, ...args: unknown[]) {
      const src = args[0] as ArrayBufferView | undefined;
      if (args.length === 1 && src && ArrayBuffer.isView(src) && src.buffer === heap()) return new Real(src.buffer, src.byteOffset, src.byteLength);
      return Reflect.construct(Real, args, new.target ?? Real);
   } as unknown as typeof Uint8ClampedArray;
   Object.setPrototypeOf(InPlace, Real);
   (InPlace as unknown as { prototype: unknown }).prototype = Real.prototype;
   globalThis.Uint8ClampedArray = InPlace;
   try {
      return run();
   } finally {
      globalThis.Uint8ClampedArray = Real;
   }
}

export class DecodeError extends PermanentVariantError {}

/**
 * Decodes `bytes` (a `type` image whose header said `probe`) and scales it to `width`×`height` as
 * displayed (EXIF orientation applied). `width`/`height` must not exceed the displayed size. The
 * decoded size must match the probe and stay within `maxPixels`.
 */
export async function decodeScaled(bytes: Uint8Array, type: SourceType, probe: Probe, maxPixels: number, width: number, height: number): Promise<Rgba> {
   const { orientation } = probe;
   if (type === "image/png") {
      let resizer: AreaResizer | null = null;
      await decodePngRows(
         bytes,
         (h) => {
            if (h.width !== probe.width || h.height !== probe.height) throw new DecodeError("the image's size does not match its header");
            resizer = new AreaResizer(h.width, h.height, width, height);
         },
         (row) => resizer!.pushRow(row),
         maxPixels,
      );
      return (resizer as AreaResizer | null)!.result();
   }
   const [factory, wasm] =
      type === "image/jpeg" ? [jpegDecFactory, jpegDecWasm] : type === "image/webp" ? [webpDecFactory, webpDecWasm] : [avifDecFactory, avifDecWasm];
   const { mod, memory } = await instantiate(factory as Factory, wasm);
   const input = bytes;
   const img = decodeInPlace(() => (type === "image/jpeg" ? mod.decode!(input, false) : type === "image/avif" ? mod.decode!(input, 8) : mod.decode!(input)), memory);
   if (!img || !img.width || !img.height) throw new DecodeError("the image could not be decoded");
   if (img.width * img.height > maxPixels) throw new DecodeError(`too large to resize (${img.width}×${img.height})`);
   const swap = orientation >= 5;
   if ((swap ? img.height : img.width) !== probe.width || (swap ? img.width : img.height) !== probe.height) {
      throw new DecodeError("the image's size does not match its header");
   }
   const r = new AreaResizer(swap ? img.height : img.width, swap ? img.width : img.height, width, height);
   orientedRows(img.data, img.width, img.height, orientation, (row, offset) => r.pushRow(row, offset));
   return r.result();
}

/** Encodes a variant. AVIF/WebP/JPEG each in a fresh codec instance. */
export async function encode(img: Rgba, format: VariantFormat): Promise<Uint8Array> {
   if (format === "png") return encodePng(img);
   if (format === "jpeg") {
      // JPEG has no alpha: composite onto white (only WebP/AVIF sources with transparency reach this).
      const flat = new Uint8ClampedArray(img.data.length);
      for (let i = 0; i < flat.length; i += 4) {
         const a = img.data[i + 3] / 255;
         flat[i] = img.data[i] * a + 255 * (1 - a);
         flat[i + 1] = img.data[i + 1] * a + 255 * (1 - a);
         flat[i + 2] = img.data[i + 2] * a + 255 * (1 - a);
         flat[i + 3] = 255;
      }
      const { mod } = await instantiate(jpegEncFactory as Factory, jpegEncWasm);
      return copyOut(mod.encode!(flat, img.width, img.height, { ...jpegDefaults, quality: 78, progressive: true, optimize_coding: true }));
   }
   if (format === "webp") {
      const { mod } = await instantiate(webpEncFactory as Factory, webpEncWasm);
      return copyOut(mod.encode!(img.data, img.width, img.height, { ...webpDefaults, quality: 78, method: 4 }));
   }
   const { mod } = await instantiate(avifEncFactory as Factory, avifEncWasm);
   // speed 8: ~3× faster than the default 6 for a few % more bytes; fine for a background job.
   return copyOut(mod.encode!(new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength), img.width, img.height, { ...avifDefaults, quality: 52, speed: 8 }));
}

/** Encoders return a view into their heap; keep only the bytes. */
function copyOut(out: Uint8Array | null | undefined): Uint8Array {
   if (!out || !out.byteLength) throw new Error("encoding failed");
   return out.slice();
}
