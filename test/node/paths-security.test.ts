import { describe, expect, it } from "vitest";
import { blockedApiPath, isRetiredBkndAdminPath, uploadAllowed } from "../../src/lib/paths.ts";
import { applyPrivateHeaders, contentSecurityPolicy, sameOriginOk } from "../../src/lib/security.ts";
import { ConfigError, runtimeConfig, type Env } from "../../src/env.ts";

describe("admin UI paths", () => {
   it.each(["/bknd", "/bknd/", "/bknd/data/entity/posts", "/bknd/media"])("%s is the retired bknd admin path", (p) => expect(isRetiredBkndAdminPath(p)).toBe(true));
   it.each(["/", "/data", "/healthz", "/api/data/entity/posts", "/picker", "/database", "/assets/main.js", "/sso/login", "/bkndx"])("%s is not the retired bknd admin path", (p) =>
      expect(isRetiredBkndAdminPath(p)).toBe(false),
   );
});

describe("blocked bknd routes", () => {
   it.each([
      ["POST", "/api/auth/password/login"],
      ["POST", "/api/auth/password/register"],
      ["POST", "/api/auth/register"],
      ["GET", "/api/auth/password/actions/create/schema.json"],
      ["POST", "/api/auth/password/actions/create"],
      ["GET", "/api/data/sync"],
      ["POST", "/api/system/config/set/data"],
      ["PATCH", "/api/system/config/patch/auth/roles"],
      ["POST", "/api/system/build"],
   ])("%s %s → 404", (m, p) => expect(blockedApiPath(m, p)).toBe(true));
   it.each([
      ["GET", "/api/auth/me"],
      ["GET", "/api/auth/strategies"],
      ["GET", "/api/data/entity/posts"],
      ["POST", "/api/data/entity/posts"],
      ["GET", "/api/system/config"],
   ])("%s %s stays", (m, p) => expect(blockedApiPath(m, p)).toBe(false));
});

describe("upload policy", () => {
   const req = (type: string, length = 100) => new Request("https://cms.test/x", { method: "POST", headers: { "content-type": type, "content-length": String(length) } });
   it("accepts jpeg/png/webp/avif", () => {
      expect(uploadAllowed(req("image/png"), "/api/media/upload/a.png").ok).toBe(true);
      expect(uploadAllowed(req("image/jpeg"), "/api/media/upload/a.JPG").ok).toBe(true);
      expect(uploadAllowed(req("image/avif"), "/api/media/entity/posts/1/cover").ok).toBe(true);
   });
   it("rejects svg, other types, mismatched extensions and > 10 MB", () => {
      expect(uploadAllowed(req("image/svg+xml"), "/api/media/upload/a.svg")).toMatchObject({ ok: false, status: 415 });
      expect(uploadAllowed(req("image/png"), "/api/media/upload/a.svg")).toMatchObject({ ok: false, status: 415 });
      expect(uploadAllowed(req("text/html"), "/api/media/upload/a.html")).toMatchObject({ ok: false, status: 415 });
      expect(uploadAllowed(req("image/png", 11 * 1024 * 1024), "/api/media/upload/a.png")).toMatchObject({ ok: false, status: 413 });
   });
});

describe("security headers and CSRF", () => {
   it("CSP forbids framing and pins scripts to self + nonce", () => {
      const csp = contentSecurityPolicy({ nonce: "abc" });
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("script-src 'self' 'nonce-abc'");
      expect(csp).toContain("frame-src 'none'");
      expect(contentSecurityPolicy({ nonce: "n", frameSrc: ["https://videos.test"] })).toContain("frame-src https://videos.test");
   });
   it("private headers: no-store, noindex; foreign CORS stripped", () => {
      const h = new Headers({ "Access-Control-Allow-Origin": "https://evil.example", "Access-Control-Allow-Credentials": "true" });
      applyPrivateHeaders(h, "default-src 'self'", "https://cms.test");
      expect(h.get("Cache-Control")).toBe("private, no-store");
      expect(h.get("X-Robots-Tag")).toContain("noindex");
      expect(h.get("Access-Control-Allow-Origin")).toBeNull();
      expect(h.get("Access-Control-Allow-Credentials")).toBeNull();
      const own = new Headers({ "Access-Control-Allow-Origin": "https://cms.test" });
      applyPrivateHeaders(own, undefined, "https://cms.test");
      expect(own.get("Access-Control-Allow-Origin")).toBe("https://cms.test");
   });
   it("sameOriginOk", () => {
      const r = (method: string, origin?: string) => new Request("https://cms.test/api/data/entity/posts", { method, headers: origin ? { origin } : {} });
      expect(sameOriginOk(r("GET"), "https://cms.test")).toBe(true);
      expect(sameOriginOk(r("POST", "https://cms.test"), "https://cms.test")).toBe(true);
      expect(sameOriginOk(r("POST", "https://evil.example"), "https://cms.test")).toBe(false);
      expect(sameOriginOk(r("DELETE"), "https://cms.test")).toBe(false);
      expect(sameOriginOk(r("PATCH", "null"), "https://cms.test")).toBe(false);
   });
});

describe("runtimeConfig (fail closed)", () => {
   const base = { ENVIRONMENT: "qa", PUBLIC_URL: "https://cms.test/", AUTH_ISSUER: "https://auth.test", AUTH_CLIENT_ID: "c", VIDEOS_API_URL: "https://v", VIDEOS_WEB_URL: "https://w", WWW_URL: "https://www.test", WWW_ORIGINS: "https://www.test, https://x.test" } as unknown as Env;
   it("throws without BKND_JWT_SECRET outside local", () => {
      expect(() => runtimeConfig(base)).toThrow(ConfigError);
      expect(() => runtimeConfig({ ...base, BKND_JWT_SECRET: "short" })).toThrow(/too short/);
   });
   it("derives the exact redirect URI and origins", () => {
      const cfg = runtimeConfig({ ...base, BKND_JWT_SECRET: "x".repeat(64) });
      expect(cfg.redirectUri).toBe("https://cms.test/sso/callback");
      expect(cfg.wwwOrigins).toEqual(["https://www.test", "https://x.test"]);
   });
   it("allows a dev fallback only for ENVIRONMENT=local", () => {
      const cfg = runtimeConfig({ ...base, ENVIRONMENT: "local", PUBLIC_URL: "http://localhost:8585" });
      expect(cfg.isLocal).toBe(true);
      expect(cfg.redirectUri).toBe("http://localhost:8585/sso/callback");
   });
});
