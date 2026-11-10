import { describe, expect, it } from "vitest";
import { bearer, mintPreviewToken, PREVIEW_TTL_SEC, verifyPreviewToken } from "../../src/lib/preview.ts";

const SECRET = "test-secret-0123456789abcdef0123456789abcdef";
const NOW = 1_800_000_000;

describe("preview tokens", () => {
   it("round-trips one kind and id, expiring after PREVIEW_TTL_SEC", async () => {
      const { token, claims } = await mintPreviewToken(SECRET, "posts", 42, NOW);
      expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(claims).toEqual({ k: "posts", id: 42, iat: NOW, exp: NOW + PREVIEW_TTL_SEC });
      expect(PREVIEW_TTL_SEC).toBe(1800);
      expect(await verifyPreviewToken(SECRET, token, NOW + 60)).toEqual({ ok: true, claims });
      expect(await verifyPreviewToken(SECRET, token, NOW + PREVIEW_TTL_SEC)).toEqual({ ok: false, reason: "expired" });
   });

   it("rejects another secret, a changed payload or signature, and junk", async () => {
      const { token } = await mintPreviewToken(SECRET, "pages", 7, NOW);
      expect((await verifyPreviewToken("another-secret-0123456789abcdef0123456789", token, NOW)).ok).toBe(false);
      const [v, payload, sig] = token.split(".");
      const forged = Buffer.from(JSON.stringify({ k: "pages", id: 8, iat: NOW, exp: NOW + 99999 })).toString("base64url");
      expect(await verifyPreviewToken(SECRET, `${v}.${forged}.${sig}`, NOW)).toEqual({ ok: false, reason: "invalid" });
      expect(await verifyPreviewToken(SECRET, `${v}.${payload}.${sig.slice(0, -2)}AA`, NOW)).toEqual({ ok: false, reason: "invalid" });
      for (const junk of [null, "", "v1", "v2.a.b", `${token}.x`, "v1.!!.??", "x".repeat(600)]) {
         expect(await verifyPreviewToken(SECRET, junk, NOW)).toEqual({ ok: false, reason: "invalid" });
      }
   });

   it("is not the session signature: the key is derived for previews only", async () => {
      // The same claims HMAC'd with the raw secret (as a session-style signature would be) don't verify.
      const { token } = await mintPreviewToken(SECRET, "pages", 7, NOW);
      const body = token.split(".").slice(0, 2).join(".");
      const raw = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = Buffer.from(await crypto.subtle.sign("HMAC", raw, new TextEncoder().encode(body))).toString("base64url");
      expect((await verifyPreviewToken(SECRET, `${body}.${sig}`, NOW)).ok).toBe(false);
   });

   it("reads a bearer token", () => {
      expect(bearer("Bearer abc.def")).toBe("abc.def");
      expect(bearer("bearer abc")).toBe("abc");
      expect(bearer("Basic abc")).toBeNull();
      expect(bearer(undefined)).toBeNull();
   });
});
