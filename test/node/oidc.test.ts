import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { buildAuthorizeUrl, exchangeCode, OidcError, verifyAccessToken } from "../../src/lib/oidc.ts";
import { pkceChallenge } from "../../src/lib/pkce.ts";

const ISSUER = "https://auth.test";
const CLIENT = "client-1";
let privateKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
   const pair = await generateKeyPair("ES256");
   privateKey = pair.privateKey as CryptoKey;
   otherKey = (await generateKeyPair("ES256")).privateKey as CryptoKey;
   const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "ES256", use: "sig" };
   jwks = createLocalJWKSet({ keys: [jwk] });
});

async function token(over: { iss?: string; aud?: string; exp?: number; key?: CryptoKey; props?: object; mode?: string } = {}) {
   return new SignJWT({
      mode: over.mode ?? "access",
      type: "user",
      properties: over.props ?? { id: "u1", email: "Admin@Example.com", roles: ["Admin"] },
   })
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setSubject("user:u1")
      .setIssuer(over.iss ?? ISSUER)
      .setAudience(over.aud ?? CLIENT)
      .setExpirationTime(over.exp ?? Math.floor(Date.now() / 1000) + 600)
      .sign(over.key ?? privateKey);
}

describe("verifyAccessToken (local JWKS)", () => {
   it("accepts a valid token and extracts the identity", async () => {
      const id = await verifyAccessToken(await token(), { issuer: ISSUER, clientId: CLIENT, jwks });
      expect(id).toEqual({ sub: "u1", email: "admin@example.com", roles: ["Admin"] });
   });
   it.each([
      ["wrong issuer", { iss: "https://evil.test" }],
      ["wrong audience", { aud: "other-client" }],
      ["expired", { exp: Math.floor(Date.now() / 1000) - 3600 }],
      ["not an access token", { mode: "refresh" }],
      ["no email", { props: { id: "u1", roles: ["Admin"] } }],
   ])("rejects %s", async (_n, over) => {
      await expect(verifyAccessToken(await token(over), { issuer: ISSUER, clientId: CLIENT, jwks })).rejects.toBeInstanceOf(OidcError);
   });
   it("rejects a token signed by an unknown key", async () => {
      await expect(verifyAccessToken(await token({ key: otherKey }), { issuer: ISSUER, clientId: CLIENT, jwks })).rejects.toThrow(/rejected/);
   });
   it("rejects garbage", async () => {
      await expect(verifyAccessToken("not.a.jwt", { issuer: ISSUER, clientId: CLIENT, jwks })).rejects.toBeInstanceOf(OidcError);
   });
});

describe("buildAuthorizeUrl", () => {
   it("sends client_id, the exact redirect_uri and PKCE S256", () => {
      const url = new URL(
         buildAuthorizeUrl({ issuer: ISSUER, clientId: CLIENT, redirectUri: "https://cms.test/sso/callback", state: "s", codeChallenge: "c" }),
      );
      expect(url.origin + url.pathname).toBe(`${ISSUER}/authorize`);
      expect(Object.fromEntries(url.searchParams)).toEqual({
         client_id: CLIENT,
         redirect_uri: "https://cms.test/sso/callback",
         response_type: "code",
         state: "s",
         code_challenge: "c",
         code_challenge_method: "S256",
      });
   });
});

describe("pkceChallenge", () => {
   it("matches the RFC 7636 test vector", async () => {
      expect(await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
   });
});

describe("exchangeCode", () => {
   it("posts a public-client PKCE grant (no client secret)", async () => {
      let seen: { url: string; body: URLSearchParams } | undefined;
      const fake = (async (url: string, init: RequestInit) => {
         seen = { url, body: new URLSearchParams(String(init.body)) };
         return Response.json({ access_token: "at", refresh_token: "rt", expires_in: 60 });
      }) as unknown as typeof fetch;
      const out = await exchangeCode({ issuer: ISSUER, clientId: CLIENT, redirectUri: "https://cms.test/sso/callback", code: "c1", codeVerifier: "v1" }, fake);
      expect(out.access_token).toBe("at");
      expect(seen?.url).toBe(`${ISSUER}/token`);
      expect(Object.fromEntries(seen!.body)).toEqual({
         grant_type: "authorization_code",
         code: "c1",
         redirect_uri: "https://cms.test/sso/callback",
         client_id: CLIENT,
         code_verifier: "v1",
      });
      expect(seen!.body.has("client_secret")).toBe(false);
   });
   it("fails on a non-2xx or a body without access_token", async () => {
      const bad = (async () => new Response("no", { status: 400 })) as unknown as typeof fetch;
      await expect(exchangeCode({ issuer: ISSUER, clientId: CLIENT, redirectUri: "r", code: "c", codeVerifier: "v" }, bad)).rejects.toThrow(/400/);
      const empty = (async () => Response.json({})) as unknown as typeof fetch;
      await expect(exchangeCode({ issuer: ISSUER, clientId: CLIENT, redirectUri: "r", code: "c", codeVerifier: "v" }, empty)).rejects.toThrow(/access_token/);
   });
});
