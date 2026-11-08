/**
 * Open-redirect guard for `/sso/login?return=`. Only same-origin, absolute paths are allowed;
 * anything else (scheme, protocol-relative `//host`, backslashes, control chars, SSO loops) → "/".
 */
export function safeReturnPath(input: string | null | undefined): string {
   if (!input || input.length > 2048) return "/";
   if (!input.startsWith("/") || input.startsWith("//")) return "/";
   // Backslashes are normalized to "/" by browsers ("/\evil.com" → "//evil.com"); control chars can smuggle.
   if (/[\\\u0000-\u001f\u007f]/.test(input)) return "/";
   let url: URL;
   try {
      url = new URL(input, "https://cms.invalid");
   } catch {
      return "/";
   }
   if (url.origin !== "https://cms.invalid") return "/";
   if (url.pathname.startsWith("/sso/")) return "/";
   // Re-check AFTER normalization: "/.//evil.com" and "/a/..//evil.com" normalize to "//evil.com".
   const result = `${url.pathname}${url.search}${url.hash}`;
   if (!result.startsWith("/") || result.startsWith("//") || result.includes("\\")) return "/";
   return result;
}
