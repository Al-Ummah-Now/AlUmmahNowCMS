/**
 * Image variants (CMS-10, docs/PUBLIC_API.md "Image variants"): which sizes and formats exist for
 * an original, where they live in R2, and how a request asks for one.
 *
 * Originals are never changed (CMS-1). Variants are derived copies under `_variants/v1/<path>/`,
 * made by the queue consumer (src/lib/variants/jobs.ts) and served by `/api/public/v1/media/*`
 * with `?w=<width>&f=<avif|webp|jpeg|png>`.
 */

/** Widths made for every original wider than them, plus the original's own width when ≤ the max. */
export const VARIANT_WIDTHS = [320, 640, 960, 1280, 1600] as const;
export const MAX_VARIANT_WIDTH = 1600;

export type VariantFormat = "avif" | "webp" | "jpeg" | "png";
export const VARIANT_FORMATS: readonly VariantFormat[] = ["avif", "webp", "jpeg", "png"];
export const VARIANT_TYPES: Record<VariantFormat, string> = {
   avif: "image/avif",
   webp: "image/webp",
   jpeg: "image/jpeg",
   png: "image/png",
};
const EXT: Record<VariantFormat, string> = { avif: "avif", webp: "webp", jpeg: "jpg", png: "png" };

/** Everything under this prefix is derived; uploads may not use it (src/lib/paths.ts). */
export const VARIANT_ROOT = "_variants/";
const PREFIX = `${VARIANT_ROOT}v1/`;

/** Source types the consumer can decode (= the upload policy, src/lib/paths.ts ALLOWED_UPLOAD). */
export const SOURCE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
export const isSourceType = (t: string | null | undefined): t is SourceType => SOURCE_TYPES.includes(t as SourceType);

/**
 * Largest source (in pixels) the consumer decodes. A Worker isolate has 128 MB; the decoders hold
 * the whole RGBA image (4 bytes/pixel) while it is scaled down. Larger originals stay as uploaded
 * and are flagged to admins (Library → "Sizes not made").
 */
export const MAX_SOURCE_PIXELS: Record<SourceType, number> = {
   "image/jpeg": 4096 * 4096,
   "image/png": 4096 * 4096,
   "image/webp": 4096 * 4096,
   // The AVIF decoder keeps YUV planes next to the RGBA output.
   "image/avif": 4096 * 2048,
};

/** Widths to make for an original `width` px wide, ascending; null when the width is unknown. */
export function widthsFor(width: number | null | undefined): number[] | null {
   if (typeof width !== "number" || !Number.isInteger(width) || width < 1) return null;
   const top = Math.min(width, MAX_VARIANT_WIDTH);
   const out: number[] = VARIANT_WIDTHS.filter((w) => w < top);
   out.push(top);
   return out;
}

/** Height of a `width`-px variant of a `w`×`h` original (aspect kept, at least 1 px). */
export const heightFor = (w: number, h: number, width: number) => Math.max(1, Math.round((h * width) / w));

/** The format for browsers without AVIF/WebP: PNG keeps transparency, everything else is JPEG. */
export const fallbackFormat = (sourceType: string | null | undefined): "jpeg" | "png" => (sourceType === "image/png" ? "png" : "jpeg");

/** The formats made for each width: AVIF, WebP and the fallback. */
export const formatsFor = (sourceType: string | null | undefined): VariantFormat[] => ["avif", "webp", fallbackFormat(sourceType)];

export const variantPrefix = (path: string) => `${PREFIX}${path}/`;
export const variantKey = (path: string, width: number, format: VariantFormat) => `${variantPrefix(path)}${width}.${EXT[format]}`;

/**
 * `?w=&f=` of a media request: null when neither is given (the original is wanted), "bad" when
 * they are malformed. Any width up to the max is accepted; a variant that does not exist is
 * answered with the original (short cache) and queued.
 */
export function parseVariantQuery(params: URLSearchParams): { width: number; format: VariantFormat } | null | "bad" {
   const w = params.get("w");
   const f = params.get("f");
   if (w === null && f === null) return null;
   if (w === null || f === null || !/^[1-9]\d{0,3}$/.test(w)) return "bad";
   const width = Number(w);
   if (width > MAX_VARIANT_WIDTH || !VARIANT_FORMATS.includes(f as VariantFormat)) return "bad";
   return { width, format: f as VariantFormat };
}

/** Queue retry delay after `attempt` failures: 30 s doubling to at most 30 min. */
export const backoffSeconds = (attempt: number) => Math.min(30 * 2 ** Math.max(0, attempt - 1), 1800);

/** Won't succeed by retrying (too large, undecodable, unsupported): the job fails at once. */
export class PermanentVariantError extends Error {}
