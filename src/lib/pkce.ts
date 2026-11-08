/** PKCE (RFC 7636, S256) and random state helpers using Web Crypto. */
export function base64url(bytes: ArrayBuffer | Uint8Array): string {
   const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
   let s = "";
   for (const b of arr) s += String.fromCharCode(b);
   return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(bytes = 32): string {
   return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
   const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
   return base64url(digest);
}

export async function createPkce(): Promise<{ verifier: string; challenge: string }> {
   const verifier = randomToken(48); // 64 chars, within 43..128
   return { verifier, challenge: await pkceChallenge(verifier) };
}
