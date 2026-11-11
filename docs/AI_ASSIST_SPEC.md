# AI writing assist for editors — Spec

**Status:** v3, 2026-11-10 (v1 used the Claude API; v2 moved to Workers AI by owner decision the same day;
v3: Workers AI default, third-party providers pluggable and admin-enabled — `docs/AI_PROVIDERS.md`)
**Issue:** AlUmmahNowCMS #17 (salvaged from the superseded Copilot draft #2).
**Related:** `docs/SPEC.md` (roles, security), `docs/ADMIN_UI_SPEC.md` (staff screens, components, a11y),
AlUmmahNow `docs/specs/AI-MODERATION.md` (epic 28: policy categories, Islamic-context rules),
AlUmmahNow `docs/cost-monitoring/README.md` (#266: usage and cost dashboard).

## 1. What it is

Three helpers inside the page and post editor. Every result is a **suggestion**: the editor accepts it
(fills the form, unsaved), edits it, or discards it. Nothing is saved, and nothing is ever published, by
the AI. Publishing stays the editor's Save/Publish button.

| Feature | Where | Output | Model |
|---|---|---|---|
| **Translate** en ↔ ar | "AI assist" card in the editor's side panel | title, summary/excerpt and body in the other language, Markdown, links and `::video[ID]` lines kept | `@cf/deepseek-ai/deepseek-v4.1-flash-1017`, reasoning off |
| **SEO and sharing** | "Search & sharing" card, "Suggest" | SEO title (≤ 60 chars), meta description (≤ 160), social summary (≤ 200) | `@cf/deepseek-ai/deepseek-v4.1-flash-1017`, reasoning off |
| **Pre-publish check** | Publishing card, "Check before publishing" | tone notes, factual claims to verify, community-policy findings | `@cf/deepseek-ai/deepseek-v4.1-flash-1017`, reasoning `low` |

**Workers AI default; third-party providers pluggable, admin-enabled.** By default all three run on
**Cloudflare Workers AI** through the Worker's `AI` binding: no API key, and the text stays in Cloudflare
(the same rule as AI-MODERATION §1.4). One model for all three: the best Arabic on the catalogue in our
tests (§1.5), a 1M-token context, JSON-schema output, and no deprecation date. An admin may add any
other AI service as a generic HTTP provider (configuration, not code: §2.2, `docs/AI_PROVIDERS.md`) and
choose the provider and model per feature. Every call asks for a JSON schema, so the output is checked
against it whoever answers. Default model ids live in `src/lib/ai/prompts.ts` (`MODELS`).

### 1.1 Translate

- Source: the form's **current** values (title, summary or excerpt, body), so unsaved edits are
  translated. Target: the other locale.
- Kept byte-for-byte: Markdown structure (headings, lists, emphasis, quotes, code), link and image
  URLs (link text is translated), `::video[ID]` lines, bare URLs, Qur'an/hadith references in their
  conventional form. Honorifics are carried over as written (ﷺ stays ﷺ); none are added or removed.
- The Worker checks the result: same number of `::video[…]` lines with the same IDs in the same order,
  and the same multiset of link URLs. A mismatch is not a failure: the result is shown with a warning
  ("Check the links and videos: they differ from the original").
- Long bodies are split into chunks of ≤ 6,000 characters at blank lines outside code fences; each
  chunk is one call; chunk results are stored as they finish, so a retry resumes (§3). 6,000, not
  more: longer chunks drifted on Workers AI (§1.5).
- Review dialog: editable title, summary/excerpt and body (body with a write/preview toggle).
  - **No version in the other language yet:** "Create Arabic draft" (or English) creates the sibling
    row through bknd (`status: "draft"` always, same `translation_key`, the slug copied, or
    `<slug>-<locale>` if taken) and opens it. The source row needs to be saved once first.
  - **A version exists:** "Open the Arabic version and fill it in" opens the sibling editor with
    `?ai=<jobId>`; the editor fills its fields from the job result as **unsaved changes** (the dirty bar
    shows) and the editor reviews and saves. A published sibling is never overwritten by the AI.
  - "Discard" closes the dialog.

### 1.2 SEO and sharing

Suggest → a suggestion panel under the SEO fields with three editable values and length counters.
"Use" per field (and "Use all") copies into the SEO title and description inputs (unsaved). The social
summary has no field in the content model (www doesn't read one, `docs/PUBLIC_API.md`), so it gets a
"Copy" button for sharing posts; no schema change.

### 1.3 Pre-publish check

"Check before publishing" → a dialog with three sections, each item quoting the passage it is about:

- **Tone:** notes against the site's voice (respectful, clear, not sensational), with a suggested
  rewording.
- **Factual claims:** statements a reader would expect a source for (numbers, dates, quotes, medical,
  legal or religious rulings, hadith attributions), with why and what to verify. The model does not
  browse; it flags, it does not fact-check.
- **Community policy:** findings in the **AI-MODERATION.md §3 categories** (the Llama Guard base set and
  the platform extensions: `sectarian_hate`, `violent_extremism`, `charity_scam`, `impersonation`,
  `harassment`, `spam`, `sexual`, `misinfo_health`, `religious_authenticity`) with severity
  (`info`/`warn`/`high`) and the default action that category would get on user content, as context.
  The Islamic-context rules of §1.3 of that spec are part of the prompt (scripture, fiqh and history
  are not violations; fabricated hadith attribution is "flag for scholar review").
  The policy text lives once in `src/lib/ai/policy.ts`, copied from AlUmmahNow
  `docs/specs/AI-MODERATION.md` at commit `b4596fbe` with that pointer; no CMS-only categories.

The check is advisory and never blocks Publish. "Nothing to flag" is a normal result.

### 1.4 Epic 28 alignment

AI in the platform runs on Cloudflare Workers AI by default (owner decision, 2026-11-10;
AI-MODERATION.md §1.4). Out of the box, drafts go to Workers AI in the same Cloudflare account and
nowhere else. The owner later asked for "a way for any third party provider for the future as a
writing assistant" (2026-11-10). Third-party providers can now be plugged in, but none ships enabled.
An admin must add one, bind its key as an `AI_KEY_*` secret, test it and switch it on before a draft
can reach it (§2.2). We keep the text only in the job row, deleted after 30 days (§3).

### 1.5 Model choice: evidence (2026-11-10)

Catalogue checked with `wrangler ai models list` on 2026-11-10. Models with a deprecation date
of 2026-11-20 (Kimi K2.6, GLM 5.3 Flash, Qwen3 30B, DeepSeek V4 Flash 0731, Llama 3.1 8B, …) were
left out. Each candidate ran the real prompts of this spec on two real-shaped drafts: an English
community report (Markdown headings and list, a link, a `::video` line, a Tirmidhi hadith with ﷺ, an
unsourced medical claim, a takfir-style line) and an Arabic zakat al-fitr guide (Abu Dawud hadith, a
companion's athar, a fundraising call with a "send to this account" line).

| Model | en → ar | ar → en | JSON | Notes |
|---|---|---|---|---|
| **DeepSeek V4.1 Flash** (reasoning off) | best: the canonical hadith wording «من فطّر صائمًا كان له مثل أجره» (الترمذي 807), correct gender agreement, Markdown/links/video kept | good | 6/6 | 3–7 s per call; reasoning on is ~8× the Neurons and no better for translation |
| gpt-oss-120b | **failed twice**: empty fields, then the English returned unchanged | good | 6/6 | ruled out for translation |
| Llama 3.3 70B | a Vietnamese token in the title ("cộngوتنا"), "قال عائشة" (wrong gender) | good | 6/6 | 24k context |
| Mistral Small 3.1 24B | ungrammatical title ("كيف تغذينا مجتمعنا"), "تفتّر" for "break the fast" | good | 6/6 | |
| Gemma 4 26B | ran out of tokens thinking (en → ar) | good | 4/6 | 55–145 s |
| GLM 5.3 | ran out of tokens thinking on every call | – | 0/6 | ~3,000 Neurons a call |
| Qwen 3.8 27B | timed out (408) | – | 0/6 | |
| **m2m100-1.2b** (translation model) | unusable: replaced the hadith with a different one, broke the Markdown links, "مجلس الوزراء" for "city council" | unusable: "Rhinoplasty" and "Zika Rainbow" for زكاة الفطر, dropped ﷺ | n/a | plain text only; Markdown and `::video` lines would need re-assembly |

The pre-publish check runs with reasoning `low`: on the samples it found the title/body number
mismatch and the quote's attribution as extra claims, and it flagged `misinfo_health` (high),
`sectarian_hate` and `charity_scam` correctly, for ~570 Neurons (≈ $0.006). Chunk size: with ~12,000
characters per call en → ar repeated sections in 2 of 2 runs (the invariant check caught it); with
~6,000 it was exact in 4 of 4, at ~13 s per call. Sample outputs: the PR that moved the feature
(AlUmmahNowCMS, "AI assist on Workers AI").

## 2. Access, configuration and failure modes

- **Roles:** every endpoint checks the session role is `admin` or `editor` (SPEC §3: Super Admin and
  Admin → `admin`, Moderator → `editor`), the existing `sessionUser` gate. All endpoints are under
  `/admin/api/ai/*`, which is behind the session gate and the same-origin `Origin` check. There is no
  public endpoint. A job is readable only by the user who started it, or by an admin.
- **Model:** by default the Workers AI binding, `"ai": { "binding": "AI" }`, declared in every env of
  `wrangler.jsonc` (bindings aren't inherited; `scripts/check-wrangler-config.ts` fails without it).
  It needs no key. The feature is on wherever the `AI_JOBS` queue exists and some feature's provider can
  run: the binding for Workers AI, or an enabled HTTP provider (§2.2).
- **Keys:** a third-party key is only ever a Worker secret or a Secrets Store binding named `AI_KEY_*`.
  It is referenced by name from the settings and read at call time. It is never in D1, never shown and
  never logged. The secrets check (pre-promote) allows `AI_KEY_*` only as a secret, and fails on any
  other credential-named binding. The committed-secrets scan blocks key literals in the repo.
- **Local runs:** `wrangler dev` always calls the real Workers AI for the `AI` binding (it needs
  Cloudflare credentials and is billed). The local E2E drops the binding from its config and sets
  `AI_MOCK_URL` (honoured only when `ENVIRONMENT=local`) to a mock of the Workers AI REST shape.
- **Not configured** (no queue, or no feature whose provider can run) in an env:
  - `GET /admin/api/ai/status` → `{ configured: false }`; feature endpoints → `503 { error: "ai_not_configured" }`.
  - Admins see one muted card in the editor: "AI assist isn't set up for this site", which points to
    AI assist settings. No buttons.
  - Editors (Moderator) see nothing: no card, no buttons.
- **Errors are never raw.** The client maps every failure to a sentence: rate limit ("You've used AI
  assist a lot just now. Try again in N minutes."), too long, the model declined, temporarily
  unavailable, failed after retries. Provider messages and stack traces stay in logs.
- **Budget reached** (§5.1): `POST /jobs` → `402 { error: "budget_reached" }`; a running job fails with
  `budget_reached` before its next call. Editors see "AI assist has reached this month's budget for the
  site…".
- **Errors** from Workers AI are classified by their code (developers.cloudflare.com/workers-ai/platform/errors):
  out of capacity (3040), timeouts (3007, 3046), aborted, internal and 5xx → retry with backoff; no
  such model / deprecated / request too large / invalid input (5007, 5028, 3006, 3003, …) → permanent
  `bad_request`; account or model not allowed (3023, 3041, 5018, 5035) → permanent `auth`. Each call
  also has a 5-minute timeout (retryable).

### 2.1 Provider contract

Features call one interface, `WritingAssistProvider.complete({ model, system, messages, schema?,
reasoning?, maxTokens })` (`src/lib/ai/providers/types.ts`). It returns either `{ ok: true, text, json,
usage: { inputTokens, outputTokens, cachedTokens, neurons? }, costUsd, provider, model, latencyMs }` or
`{ ok: false, code, retryable, … }`. An adapter never throws: timeouts, refusals (`declined`), cut-off
answers (`incomplete`), unusable output (`invalid_output`), rate limits, outages, network, `auth`,
`bad_request` and `not_configured` (disabled, or the key secret is missing) are classified outcomes.
Prompts, chunking and output validation stay in `prompts.ts` / `runner.ts`, so they are the same for every
provider. There are two adapters: `workers-ai` (the binding) and `http` (generic, configured as data). No
adapter knows any vendor.

### 2.2 Admin settings (`/ai-settings`, admins only)

One row per environment (`ai_settings`, migration `0011_ai_providers.sql`), edited on the
"AI assist" screen and through `GET/PUT /admin/api/ai/settings` and `POST /admin/api/ai/settings/test`:

- **Providers:** the built-in Workers AI (on by default) and any number of HTTP providers. They start off
  and each is configured as data: URL and method, key header/prefix or query parameter + `AI_KEY_*`
  secret name, static headers, a JSON body template with placeholders, JSON response paths for the
  text, JSON, token counts, error and stop reason, streaming, timeout, price per 1,000 tokens and models.
  Every field is validated on save (`src/lib/ai/settings.ts`).
- **Per feature:** provider and model; plus one **fallback** tried once on a failure another provider
  could fix (not on a refusal or a cut-off answer).
- **Test connection:** a tiny fixed prompt through the form as it is. It shows latency, tokens and cost,
  or the failure, the mapped message and the raw response with the key redacted.
- **Audit:** every save is versioned (a stale form gets 409) and written to `ai_settings_audit` (who,
  when, changed setting paths, before/after), and tests are audited too. Settings never contain a key.

## 3. Jobs (queue, idempotency, retries)

Every AI request is a job. Translation of a long post can run for minutes (a 6,000-character chunk
takes ~13 s, and the longest allowed body is ~17 chunks), past what a browser request should wait
for; SEO takes 2–7 s and checks ~30–45 s (they reason). One path for all three gives one set of
idempotency, retry, DLQ and usage rules.

```
editor ── POST /admin/api/ai/jobs {feature, kind, id?, locale, fields} ──► Worker
             role + configured + validate + rate limit
             dedupe_key = sha256(user, feature, kind, id, locale, target, fields, PROMPT_VERSION)
             existing queued/running/done job with that key (< 24 h) → return it (no new call, no charge)
             else INSERT ai_jobs (queued) → AI_JOBS.send({ jobId }) → 202 { job }
editor ◄─ GET /admin/api/ai/jobs/:id  (poll 1.5 s, then 3 s) ── { status, result?, error? }

queue al-ummah-now-cms-ai[-env] (batch 1, max_retries 5, DLQ al-ummah-now-cms-ai-dlq[-env])
  consumer: load job; done/failed → ack (duplicate delivery is a no-op)
            claim: UPDATE … SET status='running', attempts=attempts+1 WHERE id=? AND status IN ('queued','running')
            run the steps; each finished chunk is stored in ai_jobs.partial (a retry skips it)
            success → status 'done', result JSON
            retryable (out of capacity, 5xx, network, timeout, invalid JSON) → msg.retry({ delaySeconds: min(300, 15·2^attempt) })
            permanent (bad request, account/model not allowed, refusal or content filter, cut off at max_tokens) → status 'failed', ack, flag
  DLQ consumer: status 'failed' (error 'retries_exhausted'), flag
```

- **Flag admins:** a failed job sets `flagged = 1`. The Overview shows admins an "AI assist needs a
  look" card with the last failures (feature, who, when, reason) and "Dismiss"; a structured
  `console.error({ msg: "ai_job_failed", … })` goes to Workers Logs. Editors see their own job's failure
  in the dialog.
- **Stale jobs:** a job `running` for more than 20 minutes is shown as failed to the client and
  flagged by the next poll (the queue redelivers it if the consumer died).
- **Retention:** job rows (they hold the text) are deleted after 30 days by the existing cron.

## 4. Rate limits (per user)

Counted on `ai_jobs` rows the user created (deduplicated hits don't count): **10 jobs per 10 minutes**
and **60 per day**; translations count 3 (they are the expensive ones). Over the limit →
`429 { error: "rate_limited", retryAfter }` with `Retry-After`. Body size: ≤ 100,000 characters for
translation and ≤ 60,000 for SEO and checks (`413 { error: "too_long" }`).

## 5. Usage and cost (for the cost dashboard, AlUmmahNow #266)

Workers AI bills in **Neurons**: $0.011 per 1,000, after 10,000 free Neurons a day per account (the
account is shared with other projects, so don't count on the free part). DeepSeek V4.1 Flash costs
27,273 Neurons per M input tokens (545 cached) and 109,091 per M output tokens ($0.30 / $1.20 per M).

One `ai_usage` row per model call (each provider attempt, fallback included; "Test connection" calls
use feature `test`): `at`, `day` (UTC), `env`, `user_id`, `feature`, `provider` (0011), `model`,
`job_id`, `input_tokens`, `output_tokens`, `cache_read_tokens` (prompt tokens served from the prefix
cache), `cache_write_tokens` (always 0 on Workers AI), `neurons` (as Workers AI reports them per call;
estimated from the tokens with the rates in `src/lib/ai/pricing.ts` when missing), `cost_usd`
(Neurons × $0.011 / 1,000 on Workers AI; tokens × the provider's configured price per 1,000 on an HTTP
provider, with missing token counts estimated high), `status`. Each call also writes an `ai_usage` JSON
line to Workers Logs.

Measured per action (real runs, 2026-11-10):

| Action | Neurons | USD |
|---|---|---|
| SEO suggestions | 25–30 | $0.0003 |
| Translate a short post (~1,000 characters) | ~50 | $0.0006 |
| Translate, per 6,000-character chunk | ~245 | $0.0027 |
| Translate the longest allowed body (100,000 characters, ~17 chunks) | ~4,200 | $0.046 |
| Pre-publish check (reasoning `low`) | 500–620 | $0.006–0.007 |

Per month: **expected** use, 10 editors × 22 working days × (3 translations of ~2 chunks + 5 SEO +
5 checks) ≈ 960,000 Neurons ≈ **$11/month**. **Ceiling** set by the per-user rate limit (§4: 60 weight
a day) if every one of 10 editors maxed it every day of the month with 100,000-character
translations: 20 × 4,200 × 10 × 30 ≈ 25M Neurons ≈ $277/month. The realistic figure is well inside
the $500/month whole-platform cap, and even the theoretical ceiling stays under it at 10 editors. The
monthly budget stop (§5.1) removes the dependence on editor count.

### 5.1 Monthly budget

`monthlyBudgetUsd` in the settings (default $50, at most $500, empty = no cap) per environment. The
month-to-date sum of `ai_usage.cost_usd` (UTC calendar month, this env) is checked before a job is
created (`402 budget_reached`) and before every model call of a running job (the job fails with
`budget_reached`, flagged). The editor sees a plain sentence, and admins see the spend against the cap on
the settings screen.

- `GET /admin/api/ai/usage?from=YYYY-MM-DD&to=YYYY-MM-DD` (**admin only**, as #266 limits cost data to
  Super Admin and Admin) returns daily rows in the cost spec's `vendor_costs_daily` shape
  (`{ day, vendor: "cloudflare-workers-ai" | "http:<provider id>", provider, line_item: <model>, env, amount_usd, source: "estimate", neurons }`)
  plus token and Neuron totals by feature and by user. The account-wide Workers AI bill is also in
  Cloudflare's own usage data (the collector's GraphQL source); this rollup attributes the CMS share of it.

## 6. Data (expand-only migrations `0008_ai_assist.sql`, `0009_ai_usage_neurons.sql`, `0011_ai_providers.sql`)

Worker-owned tables, outside bknd's schema (so bknd's data API never exposes them):

```sql
ai_jobs(id TEXT PK, dedupe_key TEXT NOT NULL, user_id INTEGER NOT NULL, feature TEXT NOT NULL,
        kind TEXT NOT NULL, row_id INTEGER, locale TEXT NOT NULL, target_locale TEXT,
        input TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
        partial TEXT, result TEXT, error TEXT, flagged INTEGER NOT NULL DEFAULT 0,
        weight INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)
  -- indexes: (dedupe_key, created_at), (user_id, created_at), (flagged, status)
ai_usage(id TEXT PK, at INTEGER NOT NULL, day TEXT NOT NULL, env TEXT NOT NULL, user_id INTEGER,
         feature TEXT NOT NULL, model TEXT NOT NULL, job_id TEXT, input_tokens INTEGER NOT NULL,
         output_tokens INTEGER NOT NULL, cache_read_tokens INTEGER NOT NULL DEFAULT 0,
         cache_write_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL, status TEXT NOT NULL,
         neurons REAL NOT NULL DEFAULT 0 -- 0009,
         provider TEXT NOT NULL DEFAULT 'workers-ai' -- 0011)
  -- indexes: (day), (env, day)
ai_settings(id INTEGER PK CHECK (id = 1), data TEXT NOT NULL, version INTEGER NOT NULL,
            updated_at INTEGER NOT NULL, updated_by TEXT)                       -- 0011, never a key
ai_settings_audit(id TEXT PK, at INTEGER NOT NULL, user_id INTEGER, email TEXT, action TEXT NOT NULL,
                  version INTEGER, changed TEXT NOT NULL, before TEXT, after TEXT) -- 0011
```

## 7. Prompts and safety

- System prompts are fixed per feature and versioned (`PROMPT_VERSION`, part of the dedupe key).
- The editor's text is wrapped in `<document>` tags and the system prompt says it is content to work
  on, never instructions (prompt-injection guard).
- Output asks for a JSON schema (`response_format: { type: "json_schema", strict: true }`); the Worker
  parses it (a ```json fence is tolerated), validates the shape and lengths before storing, and retries
  invalid JSON. A refusal or `finish_reason: "content_filter"` → a permanent failure "The AI declined
  this text", no retry; `finish_reason: "length"` → permanent `incomplete`.
- With the default settings nothing leaves Cloudflare: the text and the job's own ids go to Workers AI in
  the same account. A feature routed to an admin-enabled HTTP provider sends the same request to that
  provider instead (§2.2).

## 8. UI

Built with the existing staff components and tokens (`card`, `btn`, `badge`, `dialog`, `seg`,
`--fanous-*` / `--m-*`), the same as the editor around it: no new colours, logical properties only.

- **AI assist card** (side panel, under Translations): heading "AI assist", a short line ("Suggestions
  only. Nothing is saved until you save."), "Translate to Arabic/English", and a status line
  (`role="status"`) for running jobs ("Translating… this can take a minute for long posts").
- **SEO:** a "Suggest" button (sparkle icon + text) in the Search & sharing card header.
- **Check:** "Check before publishing" in the Publishing card under the actions.
- **Dialogs** (`<dialog>`, focus trapped, Escape closes, focus returns): translation review, check
  results. Each has one `h2`, labelled controls, and `aria-busy` while loading.
- en/ar: every string in `src/admin/i18n.ts` in both languages; suggestion fields take `lang`/`dir`
  from the **suggestion's** locale (an Arabic translation is typed RTL in the English UI).
- Light and dark from the existing `data-mode`; 44 px targets; visible focus; reduced motion respected
  for the progress indicator.

### 8.1 English page and post addresses (owner decision 2026-11-11)

The address (slug) of a new page or post comes from its title (`src/lib/slug-suggest.ts`). The order is:
1. An English title: the row's own, or its linked English version's.
2. The Arabic title translated to a 3–8 word English phrase. This is one inline call through the router on the **translate** route (the same provider and model as ar↔en), not a queued job: `POST /admin/api/ai/slug`. Its limits:
   - an 8 s timeout;
   - the env's monthly budget is checked first;
   - each call is logged in `ai_usage` as feature `slug`;
   - results are cached by title hash in the Cache API for 30 days, and "Regenerate from title" skips the cache.
3. Transliteration (`src/lib/slug.ts`).

Qur'an and hadith in a title are rendered literally and neutrally, never interpreted. The answer must slugify to 2–8 plain English words, or the transliteration is used. The editor sees which one it got and can always change it.

E2E accounts (`isTestAccount`) never reach a provider on a deployed env. Worker tests inject a mocked binding, and the local E2E uses the mock server. The data API's own slug fill (content rules) does not call AI.

## 9. Tests

- **Providers (node, `test/node/ai-providers.test.ts`):** one contract suite run against Workers AI, the
  generic HTTP provider configured for two unrelated API shapes (header vs query key, nested vs flat
  JSON, model in body vs URL, one streaming), and a fake provider. It covers request rendering, response
  paths, error classes, key redaction, settings validation (keys, https, templates, paths, routes,
  budget) and the fallback router. **Worker (`test/worker/ai-providers.test.ts`):** the settings API
  (admin-only, versioned, audited, no key in D1), Test connection, the settings screen (en/ar), the
  budget stop for new and running jobs, features on HTTP providers, and the fallback to Workers AI.
- **Unit (node):** chunking (fences, blank lines, limits), Markdown invariants check, dedupe key,
  rate-limit windows, price math, policy categories match the epic 28 list, output validators.
- **Worker (vitest-pool-workers) with a mocked Workers AI binding** (`test/support/workers-ai-mock.ts`;
  the pool runs with `remoteBindings: false`, so tests never reach the real model): role
  matrix (admin, editor 200/202; no session 401; cross-origin 403), not configured (503 + admin notice
  rendered, editor sees nothing), rate limit 429, too long 413, dedupe returns the same job, consumer
  success per feature, chunked translation resumes after a failure without re-calling done chunks,
  retryable error → `retry` with backoff, permanent error and DLQ → failed + flagged, usage rows written
  with the answering model, usage endpoint admin-only and shaped like `vendor_costs_daily`, Overview
  failure card for admins only.
- **E2E (Playwright):**
  - *Local, every PR (CI job):* `wrangler dev` (config without the `AI` binding) + a local mock auth
    issuer and a mock Workers AI (`AI_MOCK_URL`, honoured only when `ENVIRONMENT=local`). One test per editor flow
    (translate → create draft; translate → fill existing sibling; SEO suggest → use; check → dialog),
    in the English and Arabic UI (RTL), light and dark, with axe and accessible-name assertions, plus
    the not-set-up states (admin notice, editor hidden).
  - *QA (deployed):* QA has the binding, so both roles get the AI controls (an env without the binding
    shows admins the notice and moderators nothing). Real model calls are checked by hand on QA, not in
    CI (they cost Neurons and depend on capacity).

## 10. Out of scope (queue issues)

- AI assist for navigation labels and site settings.
