/**
 * OAuth 2.1 client for the Al Ummah Now auth server (openauth fork).
 *
 * The CMS is a PUBLIC PKCE client (SPEC §3, deviation): auth does not verify client secrets on
 * the authorization_code grant, so none is sent. Protection = PKCE S256 + the exact registered
 * redirect_uri + a signed-token check (JWKS, iss, aud, exp) + the role check.
 */
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * `prompt` values the CMS may send. The normal sign-in sends NONE: auth then signs the browser's
 * active account in silently, or shows its sign-in form when there is no browser session.
 *  - "login": "Add another account" (auth shows the sign-in form; the new account becomes active).
 *  - "none":  silent re-authorization after an account switch; auth answers `error=login_required`
 *             instead of showing any UI.
 * `select_account` is never sent: the account chooser lives on the CMS's own pages.
 */
export type Prompt = "login" | "none";

/** Only "login" and "none" are accepted from `/sso/login?prompt=`; anything else means no prompt. */
export function parsePrompt(value: string | null | undefined): Prompt | undefined {
   return value === "login" || value === "none" ? value : undefined;
}

export interface AuthorizeParams {
   issuer: string;
   clientId: string;
   redirectUri: string;
   state: string;
   codeChallenge: string;
   prompt?: Prompt;
   /** The sign-in page language (auth reads it from ?lang= only). Only "ar" is sent; English is the default. */
   lang?: "en" | "ar";
}

/** "ar" when the sign-in starts from an Arabic page (?lang=ar on /sso/login or on the return path). */
export function signInLang(query: string | undefined, returnPath: string): "ar" | undefined {
   if (query === "ar") return "ar";
   try {
      return new URL(returnPath, "https://cms.invalid").searchParams.get("lang") === "ar" ? "ar" : undefined;
   } catch {
      return undefined;
   }
}

export function buildAuthorizeUrl(p: AuthorizeParams): string {
   const url = new URL(`${p.issuer}/authorize`);
   url.searchParams.set("client_id", p.clientId);
   url.searchParams.set("redirect_uri", p.redirectUri);
   url.searchParams.set("response_type", "code");
   url.searchParams.set("state", p.state);
   url.searchParams.set("code_challenge", p.codeChallenge);
   url.searchParams.set("code_challenge_method", "S256");
   if (p.prompt) url.searchParams.set("prompt", p.prompt);
   if (p.lang === "ar") url.searchParams.set("lang", "ar");
   return url.toString();
}

export interface TokenResponse {
   access_token: string;
   refresh_token?: string;
   expires_in?: number;
}

export class OidcError extends Error {
   readonly kind: "token_exchange" | "invalid_token";
   constructor(kind: "token_exchange" | "invalid_token", message: string) {
      super(message);
      this.kind = kind;
   }
}

export async function exchangeCode(
   p: { issuer: string; clientId: string; redirectUri: string; code: string; codeVerifier: string },
   fetchImpl: typeof fetch = fetch,
): Promise<TokenResponse> {
   const res = await fetchImpl(`${p.issuer}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
         grant_type: "authorization_code",
         code: p.code,
         redirect_uri: p.redirectUri, // byte-identical to the one sent to /authorize
         client_id: p.clientId,
         code_verifier: p.codeVerifier,
      }).toString(),
   });
   if (!res.ok) throw new OidcError("token_exchange", `token endpoint answered ${res.status}`);
   const body = (await res.json().catch(() => null)) as Partial<TokenResponse> | null;
   if (!body || typeof body.access_token !== "string") {
      throw new OidcError("token_exchange", "token response has no access_token");
   }
   return body as TokenResponse;
}

export interface SsoIdentity {
   sub: string;
   email: string;
   roles: string[];
}

const jwksCache = new Map<string, JWTVerifyGetKey>();

export function remoteJwks(issuer: string): JWTVerifyGetKey {
   let jwks = jwksCache.get(issuer);
   if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`), { cooldownDuration: 30_000 });
      jwksCache.set(issuer, jwks);
   }
   return jwks;
}

/** Verifies the access token's signature, iss, aud and exp, and extracts the identity. */
export async function verifyAccessToken(
   token: string,
   p: { issuer: string; clientId: string; jwks?: JWTVerifyGetKey },
): Promise<SsoIdentity> {
   let payload: Record<string, unknown>;
   try {
      ({ payload } = await jwtVerify(token, p.jwks ?? remoteJwks(p.issuer), {
         issuer: p.issuer,
         audience: p.clientId,
         requiredClaims: ["exp", "sub"],
         clockTolerance: 30,
      }));
   } catch (error) {
      throw new OidcError("invalid_token", `access token rejected: ${(error as Error).message}`);
   }
   if (payload.mode !== undefined && payload.mode !== "access") {
      throw new OidcError("invalid_token", "not an access token");
   }
   const props = (payload.properties ?? {}) as { id?: unknown; email?: unknown; roles?: unknown };
   const email = typeof props.email === "string" ? props.email.trim().toLowerCase() : "";
   if (!email) throw new OidcError("invalid_token", "token has no email");
   const sub = typeof props.id === "string" && props.id ? props.id : String(payload.sub);
   const roles = Array.isArray(props.roles) ? props.roles.filter((r): r is string => typeof r === "string") : [];
   return { sub, email, roles };
}
