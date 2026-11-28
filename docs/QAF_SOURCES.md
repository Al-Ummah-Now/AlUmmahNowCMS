# Find a source

On **AI assist** (`/ai-settings`), enter a [Qaf API key](https://docs.qaf.ai/api/quickstart) under **Qaf sources**. The CMS seals the key with AES-GCM using a key derived from the existing `BKND_JWT_SECRET`. It never returns the stored value. Re-enter the Qaf key after rotating the CMS session secret. Removing or replacing the key clears the search cache and starts a new CMS quota estimate.

Admins and editors can search from a standard page or article editor. Select text in the draft or type a topic. **Suggest a search** uses Workers AI to propose a short Arabic query you can edit. Genre, author, book and author death year filters can be combined. Author and book lookup resolves names to the IDs Qaf expects.

Results show the Arabic text, the book and author in the interface language, and every printed page reported by Qaf. **Show context** loads two neighboring passages on either side and any available footnotes. **Insert quotation** adds a literal Markdown block and a linked citation in the draft language. On pages it uses the selected Markdown field or adds a Markdown block. Review and save through the usual editor controls.

## Requests and usage

- The authenticated proxy uses the same-origin admin API at `/admin/api/ai/qaf`. A search sends the edited query and selected filters to Qaf. The optional Workers AI job receives the selection as JSON data and returns only a query. The writing assistant masks marked Qaf quotations in model inputs and restores the original passage in translation results. The query suggestion uses the existing queue, retry, dead-letter, per-user rate and monthly budget checks, and records an `ai_usage` entry for each attempt as `source-query`.
- Search cache entries are shared within the CMS environment for seven days and keyed by the SHA-256 of the normalized request and current key generation. The cache stores Qaf results. The cleanup cron removes expired entries and usage older than seven days.
- The weekly figure on AI assist estimates remaining searches from successful CMS cache misses. Qaf's headers describe the minute window only, so other Qaf API and MCP clients aren't included in that estimate. Check Qaf account usage for the exact allowance. A weekly refusal sets the CMS figure to zero until the reset in `Retry-After`. Cached results, reading and lookup remain available. [Qaf rate limits](https://docs.qaf.ai/api/rate-limits)
- The proxy retries a minute refusal once after `Retry-After` and backs off on 5xx. A weekly or credential refusal stops the affected requests and appears with Qaf's request ID on Overview and AI assist. For a credential refusal, check the key or use **Retry** after the cooldown. Retry checks the catalog and leaves the search allowance untouched.
- Passages stay inside a Markdown fence sized to contain any delimiters in the source. Readers with Markdown support display the quoted text literally. The citation points to the Qaf passage and includes the reported printed pages. The editor provides a separate Turath link where available. [Qaf citation guide](https://docs.qaf.ai/guides/citations)

## Local verification

`npx vitest run qaf` exercises validation, encryption, quotas, routing, prompt output and literal rendering. `npx playwright test -c playwright.local.config.ts e2e/local/qaf.local.spec.ts` runs the English and Arabic editor and settings flows with a fake Qaf and Workers AI. Set `QAF_CAPTURE=1` for dark-mode screenshots in `e2e-artifacts/`.
