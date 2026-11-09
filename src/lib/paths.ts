/** Path rules for the wrapper: admin UI routes, blocked bknd routes, upload policy. */
import { MEDIA_MAX_BYTES } from "../bknd-config.ts";

/** Where bknd's retired admin UI lived during the move to the staff screens (now redirects to /). */
export const isRetiredBkndAdminPath = (p: string) => p === "/bknd" || p.startsWith("/bknd/");

/** bknd API routes that must never be reachable (SSO only; schema only via migrations). */
export function blockedApiPath(method: string, p: string): boolean {
   if (p.startsWith("/api/auth/")) {
      // Only the session read endpoints stay; password login/register and strategy routes are gone.
      return !(method === "GET" && (p === "/api/auth/me" || p === "/api/auth/strategies"));
   }
   if (p === "/api/data/sync" || p.startsWith("/api/data/sync/")) return true;
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

/** Uploads: images only (jpeg, png, webp, avif — SVG rejected), ≤ 10 MB (SPEC §7). */
export function uploadAllowed(request: Request, path: string): { ok: true } | { ok: false; status: 413 | 415; message: string } {
   const length = Number(request.headers.get("content-length") ?? "0");
   if (length > MEDIA_MAX_BYTES) return { ok: false, status: 413, message: "File is larger than 10 MB" };
   const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
   if (type.startsWith("multipart/form-data")) return { ok: true }; // bknd re-checks the body; the filename is checked below
   const filename = decodeURIComponent(path.split("/").pop() ?? "").toLowerCase();
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
