# Roadmap

**Done (v1):** bknd 0.21 code mode, content model + migrations with schema check and migration guard,
SSO (public PKCE client) with role mapping, public read API for www, video picker, security headers,
unit + Workers-runtime tests, Playwright E2E, QA deploy, stage-then-promote release with rollback.

**Before go-live (other repos / owner):**
- AlUmmahNowAuth: register the CMS clients (`0011_www_cms_clients.sql`) — E2E needs it.
- Set `BKND_JWT_SECRET` on `al-ummah-now-cms`, `-stage`, `-qa`.
- Replace the placeholder embed URLs in `src/lib/embeds.ts` once AlUmmahNow `docs/embeds/README.md` lands.

**Queued (out of scope for v1):** a dedicated "Content Editor" auth role; scheduled publishing;
revisions/history; draft preview on www; image resizing via Cloudflare Images; retiring the stray
`bknd` Worker.
