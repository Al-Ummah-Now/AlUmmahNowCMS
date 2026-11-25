/**
 * Proof of who answered a release check (the same file as AlUmmahNow's packages/shared-types/src/release-check.ts).
 *
 * While a candidate is at 0%, the release's smoke asks for it with the version override, but an edge
 * location that has not learned of the deployment yet answers with the version before. So the smoke sends
 * the candidate's version id in X-Release-Check, and a Worker answers "ok" only when that is its own id.
 * The id itself is never in a response, and nobody else sends it: visitors see no change.
 *
 * No imports: the release scripts read this file as it is.
 */
export const RELEASE_CHECK_HEADER = "X-Release-Check";
export const RELEASE_CHECK_OK = "ok";

interface HeadersOnly {
   headers: { get(name: string): string | null };
}

/**
 * The response as it leaves the Worker: call it last, outside everything that may store a response.
 * It never changes the response it is given (which may be on its way into a cache): the one for the
 * release is a copy, kept out of every edge cache, and any other leaves as it came. Without the version
 * binding, or for any other id, it does nothing; a WebSocket upgrade is never copied.
 */
export function withReleaseCheck<R extends Response>(request: HeadersOnly, env: unknown, response: R): R | Response {
   const own = (env as { CF_VERSION_METADATA?: { id?: unknown } } | null | undefined)?.CF_VERSION_METADATA?.id;
   const asked = typeof own === "string" && own !== "" && request.headers.get(RELEASE_CHECK_HEADER) === own;
   if (response.status === 101) return response;
   // An "ok" that came from elsewhere (a stored or passed-through response) proves nothing here
   if (!asked && !response.headers.has(RELEASE_CHECK_HEADER)) return response;
   const copy = new Response(response.body, response);
   if (asked) {
      copy.headers.set(RELEASE_CHECK_HEADER, RELEASE_CHECK_OK);
      copy.headers.set("Cloudflare-CDN-Cache-Control", "no-store");
   } else {
      copy.headers.delete(RELEASE_CHECK_HEADER);
   }
   return copy;
}
