/**
 * Image size from the file header (no decoding), and the JPEG EXIF orientation. Browsers show
 * originals rotated by EXIF; the decoders don't, so the consumer applies it to every variant and
 * all sizes here are as displayed (orientations 5–8 swap width and height).
 */

export interface Probe {
   /** Width × height as displayed. */
   width: number;
   height: number;
   /** EXIF orientation 1–8 (1 = as stored). */
   orientation: number;
}

const u16 = (b: Uint8Array, p: number, le = false) => (le ? b[p] | (b[p + 1] << 8) : (b[p] << 8) | b[p + 1]);
const u32 = (b: Uint8Array, p: number, le = false) => (le ? (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 0x1000000 : b[p] * 0x1000000 + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]));
const u24le = (b: Uint8Array, p: number) => b[p] | (b[p + 1] << 8) | (b[p + 2] << 16);

function exifOrientation(b: Uint8Array, start: number, end: number): number {
   // "Exif\0\0" then a TIFF header.
   if (end - start < 14 || String.fromCharCode(b[start], b[start + 1], b[start + 2], b[start + 3]) !== "Exif") return 1;
   const t = start + 6;
   const le = b[t] === 0x49;
   if (!le && b[t] !== 0x4d) return 1;
   const ifd = t + u32(b, t + 4, le);
   if (ifd + 2 > end) return 1;
   const n = u16(b, ifd, le);
   for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > end) break;
      if (u16(b, e, le) === 0x0112) {
         const v = u16(b, e + 8, le);
         return v >= 1 && v <= 8 ? v : 1;
      }
   }
   return 1;
}

function jpeg(b: Uint8Array): Probe | null {
   if (b[0] !== 0xff || b[1] !== 0xd8) return null;
   let orientation = 1;
   for (let p = 2; p + 4 <= b.length; ) {
      if (b[p] !== 0xff) return null;
      const marker = b[p + 1];
      if (marker === 0xff) {
         p++;
         continue;
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
         p += 2;
         continue;
      }
      const len = u16(b, p + 2);
      if (marker === 0xe1) orientation = exifOrientation(b, p + 4, Math.min(b.length, p + 2 + len));
      // SOF0–SOF15 except DHT (C4), JPG (C8), DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
         if (p + 9 > b.length) return null;
         const h = u16(b, p + 5);
         const w = u16(b, p + 7);
         if (!w || !h) return null;
         return orientation >= 5 ? { width: h, height: w, orientation } : { width: w, height: h, orientation };
      }
      p += 2 + len;
   }
   return null;
}

function png(b: Uint8Array): Probe | null {
   if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || String.fromCharCode(b[12], b[13], b[14], b[15]) !== "IHDR") return null;
   const width = u32(b, 16), height = u32(b, 20);
   return width && height ? { width, height, orientation: 1 } : null;
}

function webp(b: Uint8Array): Probe | null {
   if (b.length < 30 || String.fromCharCode(b[0], b[1], b[2], b[3]) !== "RIFF" || String.fromCharCode(b[8], b[9], b[10], b[11]) !== "WEBP") return null;
   const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
   if (kind === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1, orientation: 1 };
   if (kind === "VP8L" && b[20] === 0x2f) {
      const bits = u32(b, 21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, orientation: 1 };
   }
   if (kind === "VP8 " && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
      return { width: u16(b, 26, true) & 0x3fff, height: u16(b, 28, true) & 0x3fff, orientation: 1 };
   }
   return null;
}

/**
 * AVIF/HEIF: the `ispe` (image spatial extent) properties inside meta → iprp → ipco. A file can
 * carry several (thumbnails, alpha planes); the largest is taken, so the pixel cap is never
 * checked against a smaller item than the one decoded. The decoder's own size is checked again.
 */
function avif(b: Uint8Array): Probe | null {
   if (b.length < 16 || String.fromCharCode(b[4], b[5], b[6], b[7]) !== "ftyp") return null;
   let best: Probe | null = null;
   const walk = (start: number, end: number): void => {
      for (let p = start; p + 8 <= end; ) {
         let size = u32(b, p);
         const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
         let header = 8;
         if (size === 1) {
            size = u32(b, p + 8) * 0x100000000 + u32(b, p + 12);
            header = 16;
         } else if (size === 0) size = end - p;
         if (size < header || p + size > end) return;
         if (type === "ispe" && size >= 20) {
            const width = u32(b, p + 12), height = u32(b, p + 16);
            if (width && height && (!best || width * height > best.width * best.height)) best = { width, height, orientation: 1 };
         }
         if (type === "meta") walk(p + header + 4, p + size); // full box: version + flags
         else if (type === "iprp" || type === "ipco") walk(p + header, p + size);
         p += size;
      }
   };
   walk(0, b.length);
   return best;
}

export function probeImage(bytes: Uint8Array, type: string): Probe | null {
   switch (type) {
      case "image/jpeg":
         return jpeg(bytes);
      case "image/png":
         return png(bytes);
      case "image/webp":
         return webp(bytes);
      case "image/avif":
         return avif(bytes);
      default:
         return null;
   }
}

/**
 * Feeds the displayed (EXIF-oriented) rows of a stored `w`×`h` RGBA image to `onRow`.
 * Orientation 1 passes row views straight through; the others build each row by sampling.
 */
export function orientedRows(data: Uint8ClampedArray, w: number, h: number, orientation: number, onRow: (row: Uint8ClampedArray, offset: number) => void): void {
   if (orientation === 1) {
      for (let y = 0; y < h; y++) onRow(data, y * w * 4);
      return;
   }
   const swap = orientation >= 5;
   const ow = swap ? h : w;
   const oh = swap ? w : h;
   const row = new Uint8ClampedArray(ow * 4);
   for (let yo = 0; yo < oh; yo++) {
      for (let xo = 0; xo < ow; xo++) {
         let x: number, y: number;
         switch (orientation) {
            case 2: x = w - 1 - xo; y = yo; break;
            case 3: x = w - 1 - xo; y = h - 1 - yo; break;
            case 4: x = xo; y = h - 1 - yo; break;
            case 5: x = yo; y = xo; break;
            case 6: x = yo; y = h - 1 - xo; break;
            case 7: x = w - 1 - yo; y = h - 1 - xo; break;
            default: x = w - 1 - yo; y = xo; break; // 8
         }
         const s = (y * w + x) * 4;
         const d = xo * 4;
         row[d] = data[s];
         row[d + 1] = data[s + 1];
         row[d + 2] = data[s + 2];
         row[d + 3] = data[s + 3];
      }
      onRow(row, 0);
   }
}
