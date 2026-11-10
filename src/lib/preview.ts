/**
 * Draft preview tokens (docs/PUBLIC_API.md "Preview API"). A token lets www read ONE page or post,
 * whatever its status, for PREVIEW_TTL_SEC. Format:
 *
 *   v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(key, "v1." + payload))>
 *   payload: { k: "pages" | "posts", id: number, iat: number, exp: number }   (seconds)
 *
 * Only the CMS mints and verifies tokens; www only reads `k`, `id` and `exp` from the payload to
 * name its cookie and never trusts them (every render goes back to the CMS with the token).
 *
 * Key: HMAC-SHA256(BKND_JWT_SECRET, PREVIEW_KEY_LABEL). A key derived for this one purpose from the
 * Worker's existing secret: no new secret to provision, and a preview token can never be confused
 * with a session or SSO-state signature (different key). Rotating BKND_JWT_SECRET ends every
 * session and every open preview link together.
 */
import { base64url } from "./pkce.ts";

export type PreviewKind = "pages" | "posts";
export interface PreviewClaims {
   k: PreviewKind;
   id: number;
   iat: number;
   exp: number;
}

/** 30 minutes: long enough to review and share with a colleague, short enough to not linger. */
export const PREVIEW_TTL_SEC = 30 * 60;
export const PREVIEW_KEY_LABEL = "al-ummah-now/cms/preview-token/v1";
const VERSION = "v1";
const MAX_TOKEN_LENGTH = 512;
const enc = new TextEncoder();

export const isPreviewKind = (k: unknown): k is PreviewKind => k === "pages" || k === "posts";

const keys = new Map<string, Promise<CryptoKey>>();
function previewKey(secret: string): Promise<CryptoKey> {
   let key = keys.get(secret);
   if (!key) {
      key = (async () => {
         const root = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
         const derived = await crypto.subtle.sign("HMAC", root, enc.encode(PREVIEW_KEY_LABEL));
         return crypto.subtle.importKey("raw", derived, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
      })();
      keys.set(secret, key);
   }
   return key;
}

function fromBase64url(s: string): Uint8Array {
   const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
   const out = new Uint8Array(bin.length);
   for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
   return out;
}

export async function mintPreviewToken(secret: string, kind: PreviewKind, id: number, nowSec = Math.floor(Date.now() / 1000)) {
   const claims: PreviewClaims = { k: kind, id, iat: nowSec, exp: nowSec + PREVIEW_TTL_SEC };
   const body = `${VERSION}.${base64url(enc.encode(JSON.stringify(claims)))}`;
   const sig = await crypto.subtle.sign("HMAC", await previewKey(secret), enc.encode(body));
   return { token: `${body}.${base64url(sig)}`, claims };
}

export type VerifyResult = { ok: true; claims: PreviewClaims } | { ok: false; reason: "invalid" | "expired" };

/** Checks the signature (constant time), the shape, and the expiry. */
export async function verifyPreviewToken(secret: string, token: string | null | undefined, nowSec = Math.floor(Date.now() / 1000)): Promise<VerifyResult> {
   if (!token || token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "invalid" };
   const parts = token.split(".");
   if (parts.length !== 3 || parts[0] !== VERSION || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) {
      return { ok: false, reason: "invalid" };
   }
   let claims: PreviewClaims;
   try {
      const valid = await crypto.subtle.verify("HMAC", await previewKey(secret), fromBase64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
      if (!valid) return { ok: false, reason: "invalid" };
      claims = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1]))) as PreviewClaims;
   } catch {
      return { ok: false, reason: "invalid" };
   }
   if (!claims || !isPreviewKind(claims.k) || !Number.isSafeInteger(claims.id) || claims.id <= 0 || typeof claims.exp !== "number") {
      return { ok: false, reason: "invalid" };
   }
   if (claims.exp <= nowSec) return { ok: false, reason: "expired" };
   return { ok: true, claims };
}

/** Reads `Authorization: Bearer <token>`. */
export function bearer(header: string | undefined): string | null {
   const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
   return m ? m[1] : null;
}
