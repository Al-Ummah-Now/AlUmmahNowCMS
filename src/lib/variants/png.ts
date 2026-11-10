/**
 * PNG in plain JS on the runtime's native zlib (DecompressionStream / CompressionStream).
 * Decoding streams RGBA rows to a callback (into the resizer), so a PNG never exists as a full
 * RGBA image in memory; only the inflated scanlines do (≤ 4 bytes/pixel + 1 per row).
 */

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface PngHeader {
   width: number;
   height: number;
   bitDepth: number;
   colorType: number;
   interlace: number;
}

import { PermanentVariantError } from "./plan.ts";

export class PngError extends PermanentVariantError {}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Runs `bytes` through `stream`; with `limit`, stops (and throws) once the output would exceed it. */
async function pump(bytes: Uint8Array, stream: CompressionStream | DecompressionStream, limit = Infinity): Promise<Uint8Array> {
   const writer = stream.writable.getWriter();
   void writer.write(bytes).then(() => writer.close()).catch(() => {});
   const chunks: Uint8Array[] = [];
   let total = 0;
   const reader = stream.readable.getReader();
   for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.length;
      if (total > limit) {
         await reader.cancel().catch(() => {});
         throw new PngError("image data is larger than its header says");
      }
   }
   if (chunks.length === 1) return chunks[0];
   const out = new Uint8Array(total);
   let o = 0;
   for (const c of chunks) {
      out.set(c, o);
      o += c.length;
   }
   return out;
}

/**
 * Decodes `bytes`, calling `onRow(rgba)` once per row top to bottom (the buffer is reused).
 * IHDR must be the first chunk and appear once; images over `maxPixels` are refused before any
 * pixel data is inflated, and inflating stops at the size the header allows (no zip bombs).
 */
export async function decodePngRows(bytes: Uint8Array, onHeader: (h: PngHeader) => void, onRow: (rgba: Uint8ClampedArray) => void, maxPixels = Infinity): Promise<PngHeader> {
   if (bytes.length < 8 || SIG.some((b, i) => bytes[i] !== b)) throw new PngError("not a PNG");
   const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
   let header: PngHeader | null = null;
   let palette: Uint8Array | null = null;
   let trns: Uint8Array | null = null;
   const idat: Uint8Array[] = [];
   let idatLength = 0;
   for (let p = 8; p + 8 <= bytes.length; ) {
      const len = view.getUint32(p);
      const type = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]);
      const data = bytes.subarray(p + 8, p + 8 + len);
      if (data.length !== len) throw new PngError("truncated chunk");
      if ((p === 8) !== (type === "IHDR")) throw new PngError("IHDR must be the first chunk, once");
      if (type === "IHDR") {
         header = { width: view.getUint32(p + 8), height: view.getUint32(p + 12), bitDepth: bytes[p + 16], colorType: bytes[p + 17], interlace: bytes[p + 20] };
      } else if (type === "PLTE") palette = data;
      else if (type === "tRNS") trns = data;
      else if (type === "IDAT") {
         idat.push(data);
         idatLength += len;
      } else if (type === "IEND") break;
      p += 12 + len;
   }
   if (!header || !header.width || !header.height) throw new PngError("missing IHDR");
   const { width, height, bitDepth, colorType, interlace } = header;
   if (width * height > maxPixels) throw new PngError(`too large to resize (${width}×${height})`);
   const channels = CHANNELS[colorType];
   if (!channels || ![1, 2, 4, 8, 16].includes(bitDepth)) throw new PngError(`unsupported PNG (colour type ${colorType}, depth ${bitDepth})`);
   if (interlace !== 0) throw new PngError("interlaced PNGs are not supported; re-save it without interlacing");
   if (colorType === 3 && !palette) throw new PngError("palette PNG without PLTE");
   onHeader(header);

   const joined = new Uint8Array(idatLength);
   let o = 0;
   for (const c of idat) {
      joined.set(c, o);
      o += c.length;
   }
   idat.length = 0;
   const bitsPerPixel = channels * bitDepth;
   const stride = Math.ceil((width * bitsPerPixel) / 8);
   const bpp = Math.max(1, bitsPerPixel >> 3);
   const raw = await pump(joined, new DecompressionStream("deflate"), height * (stride + 1));
   if (raw.length < height * (stride + 1)) throw new PngError("truncated image data");
   const rgba = new Uint8ClampedArray(width * 4);
   const maxSample = (1 << bitDepth) - 1;
   const trnsGray = trns && colorType === 0 && trns.length >= 2 ? (trns[0] << 8) | trns[1] : -1;
   const trnsRgb = trns && colorType === 2 && trns.length >= 6 ? [(trns[0] << 8) | trns[1], (trns[2] << 8) | trns[3], (trns[4] << 8) | trns[5]] : null;

   let prev: Uint8Array | null = null;
   for (let y = 0; y < height; y++) {
      const start = y * (stride + 1);
      const filter = raw[start];
      const line = raw.subarray(start + 1, start + 1 + stride);
      // Unfilter in place (the previous row is already unfiltered).
      for (let i = 0; i < stride; i++) {
         const left = i >= bpp ? line[i - bpp] : 0;
         const up = prev ? prev[i] : 0;
         const ul = prev && i >= bpp ? prev[i - bpp] : 0;
         let v = line[i];
         switch (filter) {
            case 0:
               break;
            case 1:
               v += left;
               break;
            case 2:
               v += up;
               break;
            case 3:
               v += (left + up) >> 1;
               break;
            case 4: {
               const pa = Math.abs(up - ul), pb = Math.abs(left - ul), pc = Math.abs(left + up - 2 * ul);
               v += pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
               break;
            }
            default:
               throw new PngError(`bad filter ${filter}`);
         }
         line[i] = v;
      }
      prev = line;
      const sample = (i: number): number => {
         if (bitDepth === 8) return line[i];
         if (bitDepth === 16) return (line[i * 2] << 8) | line[i * 2 + 1];
         const bit = i * bitDepth;
         return (line[bit >> 3] >> (8 - bitDepth - (bit & 7))) & maxSample;
      };
      const to8 = (v: number) => (bitDepth === 8 ? v : bitDepth === 16 ? v >> 8 : Math.round((v * 255) / maxSample));
      for (let x = 0; x < width; x++) {
         const d = x * 4;
         const s = x * channels;
         switch (colorType) {
            case 0: {
               const g = sample(s);
               rgba[d] = rgba[d + 1] = rgba[d + 2] = to8(g);
               rgba[d + 3] = g === trnsGray ? 0 : 255;
               break;
            }
            case 2: {
               const r = sample(s), g = sample(s + 1), b = sample(s + 2);
               rgba[d] = to8(r);
               rgba[d + 1] = to8(g);
               rgba[d + 2] = to8(b);
               rgba[d + 3] = trnsRgb && r === trnsRgb[0] && g === trnsRgb[1] && b === trnsRgb[2] ? 0 : 255;
               break;
            }
            case 3: {
               const i = sample(s);
               rgba[d] = palette![i * 3] ?? 0;
               rgba[d + 1] = palette![i * 3 + 1] ?? 0;
               rgba[d + 2] = palette![i * 3 + 2] ?? 0;
               rgba[d + 3] = trns && i < trns.length ? trns[i] : 255;
               break;
            }
            case 4:
               rgba[d] = rgba[d + 1] = rgba[d + 2] = to8(sample(s));
               rgba[d + 3] = to8(sample(s + 1));
               break;
            case 6:
               rgba[d] = to8(sample(s));
               rgba[d + 1] = to8(sample(s + 1));
               rgba[d + 2] = to8(sample(s + 2));
               rgba[d + 3] = to8(sample(s + 3));
               break;
         }
      }
      onRow(rgba);
   }
   return header;
}

const CRC_TABLE = (() => {
   const t = new Uint32Array(256);
   for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
   }
   return t;
})();

function crc32(parts: Uint8Array[]): number {
   let c = 0xffffffff;
   for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
   return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
   const out = new Uint8Array(12 + data.length);
   const v = new DataView(out.buffer);
   v.setUint32(0, data.length);
   const t = new TextEncoder().encode(type);
   out.set(t, 4);
   out.set(data, 8);
   v.setUint32(8 + data.length, crc32([t, data]));
   return out;
}

/** RGBA (8-bit) → PNG. Opaque images are written as RGB; each row takes the cheapest filter. */
export async function encodePng(img: { data: Uint8ClampedArray; width: number; height: number }): Promise<Uint8Array> {
   const { data, width, height } = img;
   let opaque = true;
   for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 255) {
         opaque = false;
         break;
      }
   }
   const ch = opaque ? 3 : 4;
   const stride = width * ch;
   const raw = new Uint8Array(height * (stride + 1));
   const cur = new Uint8Array(stride);
   const prev = new Uint8Array(stride);
   const cand = new Uint8Array(stride);
   for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) for (let c = 0; c < ch; c++) cur[x * ch + c] = data[(y * width + x) * 4 + c];
      let bestScore = Infinity;
      const start = y * (stride + 1);
      for (let f = 0; f <= 4; f++) {
         let score = 0;
         for (let i = 0; i < stride; i++) {
            const left = i >= ch ? cur[i - ch] : 0;
            const up = y ? prev[i] : 0;
            const ul = y && i >= ch ? prev[i - ch] : 0;
            let p = 0;
            if (f === 1) p = left;
            else if (f === 2) p = up;
            else if (f === 3) p = (left + up) >> 1;
            else if (f === 4) {
               const pa = Math.abs(up - ul), pb = Math.abs(left - ul), pc = Math.abs(left + up - 2 * ul);
               p = pa <= pb && pa <= pc ? left : pb <= pc ? up : ul;
            }
            const v = (cur[i] - p) & 0xff;
            cand[i] = v;
            score += v < 128 ? v : 256 - v;
         }
         if (score < bestScore) {
            bestScore = score;
            raw[start] = f;
            raw.set(cand, start + 1);
         }
      }
      prev.set(cur);
   }
   const idat = await pump(raw, new CompressionStream("deflate"));
   const ihdr = new Uint8Array(13);
   const v = new DataView(ihdr.buffer);
   v.setUint32(0, width);
   v.setUint32(4, height);
   ihdr[8] = 8;
   ihdr[9] = opaque ? 2 : 6;
   const parts = [new Uint8Array(SIG), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
   const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
   let o = 0;
   for (const p of parts) {
      out.set(p, o);
      o += p.length;
   }
   return out;
}
