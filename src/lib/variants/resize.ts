/**
 * Downscaling by area averaging (each output pixel = the coverage-weighted mean of the source
 * pixels under it), streamed one source row at a time so the full-size image never has to exist
 * twice. Colour is averaged premultiplied by alpha, so transparent pixels don't darken edges.
 *
 * Plain JS on purpose: a WASM resizer copies the whole source into its own heap, and WASM heaps
 * never shrink, which a 128 MB Worker cannot afford for a 12 MP photo.
 */

export interface Rgba {
   data: Uint8ClampedArray;
   width: number;
   height: number;
}

interface Tap {
   start: number;
   weights: Float32Array;
}

/** For each output index, the first source index it covers and the weight of each covered one. */
function taps(src: number, dst: number): Tap[] {
   const scale = src / dst;
   const out: Tap[] = [];
   for (let i = 0; i < dst; i++) {
      const a = i * scale;
      const b = Math.min(src, (i + 1) * scale);
      const start = Math.floor(a);
      const end = Math.min(src, Math.ceil(b));
      const weights = new Float32Array(end - start);
      for (let s = start; s < end; s++) weights[s - start] = (Math.min(b, s + 1) - Math.max(a, s)) / scale;
      out.push({ start, weights });
   }
   return out;
}

export class AreaResizer {
   readonly out: Uint8ClampedArray;
   private readonly cols: Tap[];
   private readonly rows: Tap[];
   /** Output rows still accumulating: index → premultiplied RGBA sums (r·a, g·a, b·a, a). */
   private readonly acc = new Map<number, Float64Array>();
   private readonly line: Float64Array;
   private nextOut = 0;
   private y = 0;

   constructor(
      readonly srcWidth: number,
      readonly srcHeight: number,
      readonly width: number,
      readonly height: number,
   ) {
      if (width < 1 || height < 1 || width > srcWidth || height > srcHeight) throw new Error(`cannot scale ${srcWidth}×${srcHeight} to ${width}×${height}`);
      this.out = new Uint8ClampedArray(width * height * 4);
      this.cols = taps(srcWidth, width);
      this.rows = taps(srcHeight, height);
      this.line = new Float64Array(width * 4);
   }

   /** Adds the next source row: `srcWidth` RGBA pixels starting at `offset`. */
   pushRow(row: ArrayLike<number>, offset = 0): void {
      const sy = this.y++;
      if (sy >= this.srcHeight) throw new Error("too many rows");
      const line = this.line;
      for (let x = 0; x < this.width; x++) {
         const { start, weights } = this.cols[x];
         let r = 0, g = 0, b = 0, a = 0;
         for (let k = 0; k < weights.length; k++) {
            const p = offset + (start + k) * 4;
            const wa = weights[k] * row[p + 3];
            r += row[p] * wa;
            g += row[p + 1] * wa;
            b += row[p + 2] * wa;
            a += wa;
         }
         const o = x * 4;
         line[o] = r;
         line[o + 1] = g;
         line[o + 2] = b;
         line[o + 3] = a;
      }
      // Output rows this source row falls under (at most two when downscaling).
      for (let oy = this.nextOut; oy < this.height; oy++) {
         const { start, weights } = this.rows[oy];
         if (start > sy) break;
         const k = sy - start;
         if (k >= weights.length) continue;
         let sums = this.acc.get(oy);
         if (!sums) this.acc.set(oy, (sums = new Float64Array(this.width * 4)));
         const wy = weights[k];
         for (let i = 0; i < sums.length; i++) sums[i] += line[i] * wy;
         if (k === weights.length - 1) this.flush(oy);
      }
   }

   private flush(oy: number): void {
      const sums = this.acc.get(oy)!;
      this.acc.delete(oy);
      const base = oy * this.width * 4;
      for (let x = 0; x < this.width; x++) {
         const o = x * 4;
         const a = sums[o + 3];
         const out = this.out;
         if (a <= 0) {
            out[base + o] = out[base + o + 1] = out[base + o + 2] = out[base + o + 3] = 0;
            continue;
         }
         out[base + o] = sums[o] / a;
         out[base + o + 1] = sums[o + 1] / a;
         out[base + o + 2] = sums[o + 2] / a;
         out[base + o + 3] = a;
      }
      while (this.nextOut < this.height && !this.acc.has(this.nextOut) && this.rows[this.nextOut].start + this.rows[this.nextOut].weights.length <= this.y) this.nextOut++;
   }

   result(): Rgba {
      if (this.y !== this.srcHeight) throw new Error(`expected ${this.srcHeight} rows, got ${this.y}`);
      return { data: this.out, width: this.width, height: this.height };
   }
}

/** Scales a whole RGBA image (a copy even when the size is unchanged: `src` may be a view into a codec heap). */
export function resizeRgba(src: Rgba, width: number, height: number): Rgba {
   if (width === src.width && height === src.height) return { data: new Uint8ClampedArray(src.data), width, height };
   const r = new AreaResizer(src.width, src.height, width, height);
   const stride = src.width * 4;
   for (let y = 0; y < src.height; y++) r.pushRow(src.data, y * stride);
   return r.result();
}
