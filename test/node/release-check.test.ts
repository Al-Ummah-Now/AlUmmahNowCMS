import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { RELEASE_CHECK_HEADER, RELEASE_CHECK_OK, withReleaseCheck } from '../../src/lib/release-check.ts';

const ID = '48155759-f731-482f-8a64-627bb3a56f48';
const env = { CF_VERSION_METADATA: { id: ID } };
const asks = (value?: string) => new Request('https://x.test/', value === undefined ? {} : { headers: { [RELEASE_CHECK_HEADER]: value } });

describe('withReleaseCheck', () => {
   it('answers ok only to the own version id, and never says the id', () => {
      const res = withReleaseCheck(asks(ID), env, new Response('x', { headers: { a: 'b' } }));
      assert.equal(res.headers.get(RELEASE_CHECK_HEADER), RELEASE_CHECK_OK);
      assert.equal(res.headers.get('a'), 'b');
      assert.ok(![...res.headers.values()].some((v) => v.includes(ID)));
   });

   it('leaves every other response as it is, the same object', () => {
      for (const [request, e] of [
         [asks(), env],
         [asks(''), env],
         [asks(ID.toUpperCase()), env],
         [asks(`${ID}, ${ID}`), env],
         [asks('11111111-1111-1111-1111-111111111111'), env],
         // No version binding: no behaviour, whatever is asked
         ...[undefined, null, {}, { CF_VERSION_METADATA: undefined }, { CF_VERSION_METADATA: {} }, { CF_VERSION_METADATA: { id: '' } }].flatMap((none) => [[asks(ID), none], [asks(''), none], [asks('undefined'), none]] as const),
      ] as [Request, unknown][]) {
         const response = new Response('x');
         assert.equal(withReleaseCheck(request, e, response), response);
         assert.equal(response.headers.has(RELEASE_CHECK_HEADER), false);
      }
   });

   it('never changes the response it was given, and keeps its copy out of the edge cache', () => {
      const response = new Response('x', { headers: { 'Cache-Control': 'public, max-age=60' } });
      const res = withReleaseCheck(asks(ID), env, response);
      assert.notEqual(res, response);
      assert.deepEqual([...response.headers.keys()].sort(), ['cache-control', 'content-type']);
      assert.equal(res.headers.get('Cloudflare-CDN-Cache-Control'), 'no-store');
      // What the caller sees of caching stays, it is checked
      assert.equal(res.headers.get('Cache-Control'), 'public, max-age=60');
   });

   it('drops an ok that came from elsewhere', () => {
      const stored = () => new Response('x', { headers: { [RELEASE_CHECK_HEADER]: RELEASE_CHECK_OK } });
      for (const e of [env, {}]) assert.equal(withReleaseCheck(asks(), e, stored()).headers.has(RELEASE_CHECK_HEADER), false);
      assert.equal(withReleaseCheck(asks('other'), env, stored()).headers.has(RELEASE_CHECK_HEADER), false);
      assert.equal(withReleaseCheck(asks(ID), env, stored()).headers.get(RELEASE_CHECK_HEADER), RELEASE_CHECK_OK);
   });

   it('copies redirects, empty answers and several Set-Cookie', async () => {
      const redirect = withReleaseCheck(asks(ID), env, Response.redirect('https://x.test/en', 307));
      assert.deepEqual([redirect.status, redirect.headers.get('location'), redirect.headers.get(RELEASE_CHECK_HEADER)], [307, 'https://x.test/en', 'ok']);
      for (const status of [204, 304]) {
         const res = withReleaseCheck(asks(ID), env, new Response(null, { status, headers: { etag: '"a"' } }));
         assert.deepEqual([res.status, res.body, res.headers.get('etag'), res.headers.get(RELEASE_CHECK_HEADER)], [status, null, '"a"', 'ok']);
      }
      const cookies = new Headers([['Set-Cookie', 'a=1; Path=/'], ['Set-Cookie', 'b=2; Expires=Wed, 25 Nov 2026 10:00:00 GMT']]);
      const res = withReleaseCheck(asks(ID), env, new Response('x', { status: 403, statusText: 'No', headers: cookies }));
      assert.deepEqual(res.headers.getSetCookie(), ['a=1; Path=/', 'b=2; Expires=Wed, 25 Nov 2026 10:00:00 GMT']);
      assert.deepEqual([res.status, res.statusText, await res.text()], [403, 'No', 'x']);
   });
});
