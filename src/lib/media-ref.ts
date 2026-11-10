/**
 * MediaRef: how the public API serves a library image (docs/PUBLIC_API.md). One builder for covers,
 * body images, block images and card-post slides, so every image carries the same fields, including
 * the resized variants (CMS-10).
 */
import { trimSlash, type Env } from "../env.ts";
import { fallbackFormat, widthsFor } from "./variants/plan.ts";

export interface MediaRef {
   url: string;
   alt: string | null;
   width: number | null;
   height: number | null;
   /** Resized copies in modern formats (CMS-10); null when the original's width is unknown. Additive. */
   variants: MediaVariants | null;
}

/** srcset strings ("<url>?w=320&f=avif 320w, …") per format, for `<picture>` sources. */
export interface MediaVariants {
   widths: number[];
   fallback_type: "image/jpeg" | "image/png";
   avif: string;
   webp: string;
   fallback: string;
}

export function mediaUrl(publicUrl: string, path: string): string {
   return `${trimSlash(publicUrl)}/api/public/v1/media/${path.split("/").map(encodeURIComponent).join("/")}`;
}

function parseMeta(v: unknown): Record<string, unknown> {
   if (v && typeof v === "object") return v as Record<string, unknown>;
   if (typeof v !== "string") return {};
   try {
      const o = JSON.parse(v);
      return o && typeof o === "object" ? (o as Record<string, unknown>) : {};
   } catch {
      return {};
   }
}

export function mediaVariants(url: string, width: number | null, mimeType: string | null): MediaVariants | null {
   const widths = widthsFor(width);
   if (!widths) return null;
   const fallback = fallbackFormat(mimeType);
   const srcset = (f: string) => widths.map((w) => `${url}?w=${w}&f=${f} ${w}w`).join(", ");
   return { widths, fallback_type: fallback === "png" ? "image/png" : "image/jpeg", avif: srcset("avif"), webp: srcset("webp"), fallback: srcset(fallback) };
}

export interface MediaRow {
   path: string;
   metadata: unknown;
   mime_type: string | null;
   /** Displayed size read by the variant job (EXIF orientation applied); preferred over bknd's. */
   v_width: number | null;
   v_height: number | null;
}
export const MEDIA_COLS = "m.path, m.metadata, m.mime_type, v.width AS v_width, v.height AS v_height";

export function mediaRefOf(env: Env, m: MediaRow): MediaRef {
   const meta = parseMeta(m.metadata);
   const num = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
   const width = num(m.v_width) ?? num(meta.width);
   const height = num(m.v_width) ? num(m.v_height) : num(meta.height);
   const url = mediaUrl(env.PUBLIC_URL, m.path);
   return { url, alt: typeof meta.alt === "string" && meta.alt !== "" ? meta.alt : null, width, height, variants: mediaVariants(url, width, m.mime_type) };
}
