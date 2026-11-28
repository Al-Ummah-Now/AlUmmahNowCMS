/** Path rules for the wrapper: admin UI routes, blocked bknd routes, upload policy. */
import { MEDIA_MAX_BYTES } from "../bknd-config.ts";

/** Where bknd's retired admin UI lived during the move to the staff screens (now redirects to /). */
export const isRetiredBkndAdminPath = (p: string) => p === "/bknd" || p.startsWith("/bknd/");

/** `/api/data/entity/<content entity>` (the collection, not one row). */
export const contentCollectionPath = (p: string) => /^\/api\/data\/entity\/(pages|posts|nav_items|curated_videos|site_settings)\/?$/.test(p);

/** bknd API routes that must never be reachable (SSO only; schema only via migrations). */
export function blockedApiPath(method: string, p: string): boolean {
   if (p.startsWith("/api/auth/")) {
      // Only the session read endpoints stay; password login/register and strategy routes are gone.
      return !(method === "GET" && (p === "/api/auth/me" || p === "/api/auth/strategies"));
   }
   if (p === "/api/data/sync" || p.startsWith("/api/data/sync/")) return true;
   // Mass update skips bknd's mutator events: no content rules, no lock, no history (#8).
   if (method === "PATCH" && contentCollectionPath(p)) return true;
   if (p.startsWith("/api/system/config/") && method !== "GET") return true;
   if (p === "/api/system/build") return true;
   return false;
}

export const ALLOWED_UPLOAD = new Map([
   ["image/jpeg", ["jpg", "jpeg"]],
   ["image/png", ["png"]],
   ["image/webp", ["webp"]],
   ["image/avif", ["avif"]],
]);

export type SniffedImageType = "image/jpeg" | "image/png" | "image/webp" | "image/avif";

/**
 * Magic-byte image sniffing for the four allowlisted upload formats (injection audit CMS-4).
 * Refuses SVG, HTML, scripts, and arbitrary binary payloads disguised as images.
 */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
   if (bytes.length < 3) return null;
   // JPEG: FF D8 FF
   if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
   // PNG: 89 50 4E 47 0D 0A 1A 0A
   if (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
   ) {
      return "image/png";
   }
   // WebP: "RIFF" .... "WEBP"
   if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
   ) {
      return "image/webp";
   }
   // AVIF (ISO BMFF): .... "ftyp" <major_brand> [minor_version] [compatible_brands...]
   if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      const fourcc = (off: number) => String.fromCharCode(bytes[off]!, bytes[off + 1]!, bytes[off + 2]!, bytes[off + 3]!);
      const major = fourcc(8);
      if (major === "avif" || major === "avis") return "image/avif";
      if (major === "mif1" || major === "msf1") {
         const boxSize = ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0;
         const end = Math.min(bytes.length, boxSize >= 16 ? boxSize : bytes.length, 64);
         if (end < 20) return "image/avif";
         for (let off = 16; off + 4 <= end; off += 4) {
            const b = fourcc(off);
            if (b === "avif" || b === "avis") return "image/avif";
         }
      }
   }
   return null;
}

/**
 * Validates an R2 media key / filename (injection audit CMS-5):
 * rejects traversal segments (`..`, `.`), leading/trailing/double slashes, backslashes,
 * query/fragment delimiters, control chars, and the reserved `_variants/` prefix.
 */
export function validMediaKey(name: string, opts: { allowVariantPrefix?: boolean } = {}): boolean {
   if (typeof name !== "string" || name.length === 0 || name.length > 255) return false;
   if (name !== name.trim()) return false;
   if (/[\u0000-\u001f\u007f\\?#]/.test(name)) return false;
   if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) return false;
   if (!opts.allowVariantPrefix && name.startsWith("_variants/")) return false;
   const segments = name.split("/");
   if (segments.some((seg) => !seg || seg === "." || seg === "..")) return false;
   return true;
}

/** Sanitizes a basename for a quoted `Content-Disposition` filename parameter (injection audit CMS-6). */
export function safeDispositionFilename(path: string, extOverride?: string): string {
   const base = (path.split("/").pop() ?? "file").replace(/[\u0000-\u001f\u007f"\\;/?#]/g, "_").trim().slice(0, 120) || "file";
   if (!extOverride) return base;
   const stem = base.replace(/\.[^.]+$/, "") || "file";
   return `${stem}.${extOverride}`;
}

/** Uploads: images only (jpeg, png, webp, avif — SVG rejected), ≤ 10 MB (SPEC §7). */
export function uploadAllowed(request: Request, path: string): { ok: true } | { ok: false; status: 413 | 415; message: string } {
   const rawLength = request.headers.get("content-length");
   if (rawLength !== null) {
      const length = Number(rawLength);
      if (!Number.isFinite(length) || length < 0 || length > MEDIA_MAX_BYTES) {
         return { ok: false, status: 413, message: "File is larger than 10 MB" };
      }
   }
   const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
   if (type.startsWith("multipart/form-data")) return { ok: true }; // body & magic bytes are re-checked in multipartAllowed
   let filename: string;
   try {
      filename = decodeURIComponent(path.split("/").pop() ?? "").toLowerCase();
   } catch {
      return { ok: false, status: 415, message: "Only JPEG, PNG, WebP and AVIF images can be uploaded" };
   }
   const ext = filename.includes(".") ? filename.split(".").pop()! : "";
   const allowedExts = ALLOWED_UPLOAD.get(type);
   if (!allowedExts || (ext && !allowedExts.includes(ext))) {
      return { ok: false, status: 415, message: "Only JPEG, PNG, WebP and AVIF images can be uploaded" };
   }
   return { ok: true };
}


/** The client-chosen name of `POST /api/media/upload/<name>`, or null (no name: bknd generates one). */
export function uploadName(path: string): string | null {
   const m = /^\/api\/media\/upload\/(.+)$/.exec(path);
   if (!m) return null;
   try {
      return decodeURIComponent(m[1]);
   } catch {
      return null;
   }
}

/** bknd entities whose rows an admin may delete (soft: src/lib/trash.ts). */
export const DATA_DELETABLE = ["pages", "posts", "nav_items", "curated_videos", "site_settings", "media"] as const;
export type DataDeletable = (typeof DATA_DELETABLE)[number];

export type DeleteTarget =
   | { type: "row"; entity: string; id: string }
   | { type: "bulk"; entity: string }
   | { type: "file"; path: string | null };

/**
 * bknd's delete routes (`DELETE /api/data/entity/:e/:id`, `/api/data/entity/:e`, `/api/media/file/:name`).
 * The Worker answers them itself with a soft delete; none of them reaches bknd.
 */
export function deleteTarget(method: string, p: string): DeleteTarget | null {
   if (method !== "DELETE") return null;
   let m = /^\/api\/data\/entity\/([^/]+)\/([^/]+)\/?$/.exec(p);
   if (m) return { type: "row", entity: m[1], id: m[2] };
   m = /^\/api\/data\/entity\/([^/]+)\/?$/.exec(p);
   if (m) return { type: "bulk", entity: m[1] };
   m = /^\/api\/media\/file\/(.+)$/.exec(p);
   if (m) {
      try {
         return { type: "file", path: decodeURIComponent(m[1]) };
      } catch {
         return { type: "file", path: null };
      }
   }
   return null;
}
