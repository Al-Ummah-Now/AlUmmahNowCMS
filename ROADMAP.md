# Roadmap

**Done (v1):** bknd 0.21 code mode, content model + migrations with schema check and migration guard,
SSO (public PKCE client) with role mapping, public read API for www, video picker, security headers,
unit + Workers-runtime tests, Playwright E2E, QA deploy, stage-then-promote release with rollback.

**Done since v1:**
- Staff admin screens replacing bknd's admin UI — [#22](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/pull/22), [#25](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/pull/25), [#29](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/pull/29), retired in [#30](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/pull/30).
- Draft preview on www (signed, 30-minute links) — [#38](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/pull/38).
- Scheduled publishing for pages and posts — [#41](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/pull/41).
- Image variants (AVIF/WebP/JPEG widths from a queued job, WASM codecs in the Worker rather than Cloudflare Images) — [#42](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/pull/42).
- Revisions: history, diff and restore for pages and posts — [#43](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/pull/43).
- AI writing assist (translate en↔ar, SEO copy, pre-publish checks) — [#47](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/pull/47); pluggable providers and a monthly budget stop — [#65](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/pull/65).
- Page blocks and card posts — [#48](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/pull/48); home timeline in Workers KV — [#51](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/pull/51).
- Soft deletes with a 30-day purge — [#63](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/pull/63).
- Scholar pages and the `writer` role (auth "Scholar") — [#67](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/pull/67).
- Curated and filter pages, CMS video library — [#92](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/pull/92); translation flags and glossary — [#93](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/pull/93).
- Go-live prerequisites: the CMS auth clients are registered (AlUmmahNowAuth `0011_www_cms_clients.sql`),
  `BKND_JWT_SECRET` is set on all three Workers (`/healthz?deep=1` reports `config: ok`), and
  `src/lib/embeds.ts` follows the AlUmmahNow embed contract (`docs/embeds/README.md`).
- The stray `bknd` Worker never existed on the account; nothing to retire ([#11](https://github.com/Al-Ummah-Now/AlUmmahNowCMS/issues/11)).

**Queued:** a dedicated "Content Editor" auth role (today Moderator maps to `editor`).
