# CLAUDE.md

Guidance for Claude Code in AlUmmahNowCMS (the www content manager). Start with `README.md`, `ARCHITECTURE.md` and `CONTRIBUTING.md`.

## Copy

- **Tone (en + ar)** for everything www visitors read, including seeded defaults and examples: Al Ummah Now is a content-sharing site, not a lectures library. Use YouTube's neutral words: videos, Shorts, live streams, posts, playlists, channels, creators, the community; verbs watch, upload, share, subscribe, save, explore. Never describe the platform as lessons, lectures, courses, a library or "beneficial knowledge" («دروس، محاضرات، مكتبة، العلم النافع»), and no entertainment or hype words. Full guide: wiki page "Copy Tone Guide".
- "Library" in the CMS admin is the editors' media/videos library; that internal name stays.
- **Arabic word for "video"**: «مرئي / مرئيات»; «المقاطع القصيرة» stays for Shorts. See the wiki page "Arabic glossary".
- Live www texts (hero, tagline, About, list intros) are edited in the CMS, not by migration: migrations are expand-only (`scripts/migration-guard.ts`).

## Numbers

- Arabic shows **Eastern Arabic (Hindi) numerals ٠–٩** in every formatted value (counts, dates, times, durations, money); English shows Arabic numerals 0–9. Format only through `src/lib/format.ts` (`ar-u-nu-arab`, money in Arabic by currency name); `test/node/format-guard.test.ts` fails on `Intl.*` / `toLocale*String` elsewhere and on `ar-SA` / `ar-EG` / `nu-latn` literals. No digits written into strings: use `{0}` placeholders or `N(...)` in `src/admin/i18n.ts`. Ids, slugs, URLs, codes and typed input keep 0–9; number fields accept ٠–٩ (`initDigitInputs`).
