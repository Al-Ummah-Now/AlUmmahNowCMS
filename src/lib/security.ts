/** Security headers (SPEC §7) and the same-origin check for mutating API calls. */
import { base64url } from "./pkce.ts";

export function nonce(): string {
   return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

export function contentSecurityPolicy(opts: { nonce: string; frameSrc?: string[] }): string {
   return [
      "default-src 'self'",
      `script-src 'self' 'nonce-${opts.nonce}'`,
      // bknd's admin UI (Mantine) injects <style> tags at runtime.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      `frame-src ${opts.frameSrc?.length ? opts.frameSrc.join(" ") : "'none'"}`,
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
   ].join("; ");
}

/** Headers for every non-public response (admin UI, SSO, picker, bknd API). */
export function applyPrivateHeaders(headers: Headers, csp?: string, ownOrigin?: string): void {
   // Belt and braces over bknd's CORS config: never let a foreign origin read a private response.
   const acao = headers.get("Access-Control-Allow-Origin");
   if (acao && acao !== ownOrigin) {
      for (const h of [...headers.keys()]) if (h.toLowerCase().startsWith("access-control-")) headers.delete(h);
   }
   headers.set("Cache-Control", "private, no-store");
   headers.set("X-Robots-Tag", "noindex, nofollow");
   headers.set("X-Content-Type-Options", "nosniff");
   headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
   headers.set("X-Frame-Options", "DENY");
   headers.set("Cross-Origin-Opener-Policy", "same-origin");
   headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
   headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
   if (csp) headers.set("Content-Security-Policy", csp);
}

/**
 * CSRF defence for bknd mutations: a non-GET/HEAD request to /api/* (other than the public API)
 * must carry an Origin header equal to our own origin. Browsers always send Origin on cross-site
 * and same-site POST/PATCH/DELETE; a missing Origin is rejected too.
 */
export function sameOriginOk(request: Request, publicUrl: string): boolean {
   const method = request.method.toUpperCase();
   if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
   const origin = request.headers.get("Origin");
   if (!origin) return false;
   return origin === new URL(publicUrl).origin || origin === new URL(request.url).origin;
}
