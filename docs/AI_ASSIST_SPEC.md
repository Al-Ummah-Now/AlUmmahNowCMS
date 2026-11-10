# AI writing assist for editors — Spec

**Status:** v1, 2026-11-10
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
| **Translate** en ↔ ar | "AI assist" card in the editor's side panel | title, summary/excerpt and body in the other language, Markdown, links and `::video[ID]` lines kept | `claude-opus-5-5`, effort `high` |
| **SEO and sharing** | "Search & sharing" card, "Suggest" | SEO title (≤ 60 chars), meta description (≤ 160), social summary (≤ 200) | `claude-sonnet-5-5`, effort `low` |
| **Pre-publish check** | Publishing card, "Check before publishing" | tone notes, factual claims to verify, community-policy findings | `claude-sonnet-5-5`, effort `medium` |

Model choice: translation is the one output that is published nearly verbatim in a second language,
in a religious context where a wrong word is costly, so it gets the strongest model. SEO copy and
checks are short, advisory, and reviewed by a person every time; Sonnet is fast and half the price.
All three send `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) so a false-positive
safety decline is retried server-side instead of failing (a religious text that quotes battle verses is
exactly the case AI-MODERATION §1.3 warns about).

### 1.1 Translate

- Source: the form's **current** values (title, summary or excerpt, body), so unsaved edits are
  translated. Target: the other locale.
- Kept byte-for-byte: Markdown structure (headings, lists, emphasis, quotes, code), link and image
  URLs (link text is translated), `::video[ID]` lines, bare URLs, Qur'an/hadith references in their
  conventional form. Honorifics are carried over as written (ﷺ stays ﷺ); none are added or removed.
- The Worker checks the result: same number of `::video[…]` lines with the same IDs in the same order,
  and the same multiset of link URLs. A mismatch is not a failure: the result is shown with a warning
  ("Check the links and videos: they differ from the original").
- Long bodies are split into chunks of ≤ 12,000 characters at blank lines outside code fences; each
  chunk is one call; chunk results are stored as they finish, so a retry resumes (§3).
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

### 1.4 Epic 28 alignment and the vendor question

AI-MODERATION.md §1.4 says user content stays inside Cloudflare (Workers AI, "no third-party AI
vendors"). That rule is about **user-generated content and personal data**. This feature sends only
**staff-authored drafts that are about to be published** (no user content, no personal data beyond the
text the editor wrote), and issue #17 (owner) names the Claude API. Recorded here as a deliberate,
scoped exception; epic 28's user-content pipeline is unchanged. We keep
the text only in the job row, deleted after 30 days (§3).

## 2. Access, configuration and failure modes

- **Roles:** every endpoint checks the session role is `admin` or `editor` (SPEC §3: Super Admin and
  Admin → `admin`, Moderator → `editor`), the existing `sessionUser` gate. All endpoints are under
  `/admin/api/ai/*`, which is behind the session gate and the same-origin `Origin` check. There is no
  public endpoint. A job is readable only by the user who started it, or by an admin.
- **Key:** `ANTHROPIC_API_KEY`, either a Secrets Store binding (preferred: secret
  `anthropic-api-key` in the account store, `secrets_store_secrets` binding per env) or a Worker secret
  (`wrangler secret put ANTHROPIC_API_KEY --env qa`). The code accepts both shapes. Neither exists today
  (checked by name, 2026-11-10), so the binding is **not** declared in `wrangler.jsonc` yet: a binding to
  a missing store secret would fail the deploy. Enabling an env = create the store secret and add the
  binding (one-line config PR), or put the Worker secret. The value is never logged or returned.
- **Not configured** (no key, or an empty value) in an env:
  - `GET /admin/api/ai/status` → `{ configured: false }`; feature endpoints → `503 { error: "ai_not_configured" }`.
  - Admins see one muted card in the editor: "AI assist isn't set up for this site" with "An admin adds
    the Anthropic key to this environment's Secrets Store." No buttons.
  - Editors (Moderator) see nothing: no card, no buttons.
- **Errors are never raw.** The client maps every failure to a sentence: rate limit ("You've used AI
  assist a lot just now. Try again in N minutes."), too long, the model declined, temporarily
  unavailable, failed after retries. Provider messages and stack traces stay in logs.
- **Secrets manifest:** `ANTHROPIC_API_KEY` is listed as an **optional** secret (the check reports it,
  missing is not a failure), and a check fails if it is ever set as a plain var.

## 3. Jobs (queue, idempotency, retries)

Every AI request is a job. Translation of a long post can run for minutes (Opus, adaptive thinking,
up to 64k output tokens per chunk), past what a browser request should wait for; SEO and checks
usually take 5–30 s but can exceed that on a long body. One path for all three gives one set of
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
            retryable (429, 5xx, overloaded, network, timeout) → msg.retry({ delaySeconds: min(300, 15·2^attempt) })
            permanent (400, refusal after fallback, invalid output twice) → status 'failed', ack, flag
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

## 5. Usage logging (for the cost dashboard, AlUmmahNow #266)

One `ai_usage` row per Messages API call: `at`, `day` (UTC), `env`, `user_id`, `feature`, `model`
(the model that answered, so a fallback is attributed correctly), `job_id`, `input_tokens`,
`output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd` (estimate from a price table in
`src/lib/ai/pricing.ts`: Opus 5.5 $4/$20, Sonnet 5.5 $2/$10 per MTok, cache reads $0.20), `status`.

- `GET /admin/api/ai/usage?from=YYYY-MM-DD&to=YYYY-MM-DD` (**admin only**, as #266 limits cost data to
  Super Admin and Admin) returns daily rows in the cost spec's `vendor_costs_daily` shape
  (`{ day, vendor: "anthropic", line_item: <model>, env, amount_usd, source: "estimate" }`) plus token
  totals by feature and by user, ready for the collector.
- The collector side (vendor `anthropic` in #266's product list, and a server-to-server read of this
  rollup) is AlUmmahNow work; a `queue` issue is filed there.

## 6. Data (expand-only migration `0003_ai_assist.sql`)

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
         cache_write_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL, status TEXT NOT NULL)
  -- index: (day)
```

## 7. Prompts and safety

- System prompts are fixed per feature and versioned (`PROMPT_VERSION`, part of the dedupe key).
- The editor's text is wrapped in `<document>` tags and the system prompt says it is content to work
  on, never instructions (prompt-injection guard).
- Output uses structured outputs (`output_config.format` JSON schema); the Worker validates the shape
  and lengths again before storing. `stop_reason: "refusal"` (after fallback) → a permanent failure
  "The AI declined this text", no retry.
- No user data beyond the text and the job's own ids goes to the API.

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

## 9. Tests

- **Unit (node):** chunking (fences, blank lines, limits), Markdown invariants check, dedupe key,
  rate-limit windows, price math, policy categories match the epic 28 list, output validators.
- **Worker (vitest-pool-workers) with a mocked Anthropic client** (the SDK's `fetch` option): role
  matrix (admin, editor 200/202; no session 401; cross-origin 403), not configured (503 + admin notice
  rendered, editor sees nothing), rate limit 429, too long 413, dedupe returns the same job, consumer
  success per feature, chunked translation resumes after a failure without re-calling done chunks,
  retryable error → `retry` with backoff, permanent error and DLQ → failed + flagged, usage rows written
  with the answering model, usage endpoint admin-only and shaped like `vendor_costs_daily`, Overview
  failure card for admins only.
- **E2E (Playwright):**
  - *Local, every PR (new CI job):* `wrangler dev` + a local mock auth issuer and a mock Anthropic API
    (`ANTHROPIC_BASE_URL`, honoured only when `ENVIRONMENT=local`). One test per editor flow
    (translate → create draft; translate → fill existing sibling; SEO suggest → use; check → dialog),
    in the English and Arabic UI (RTL), light and dark, with axe and accessible-name assertions, plus
    the not-set-up states (admin notice, editor hidden).
  - *QA (deployed):* no key on QA today, so it asserts the admin "isn't set up" notice and that a
    moderator sees no AI controls. When a QA key is added, the same suite gains a smoke run.

## 10. Out of scope (queue issues)

- Collector support for vendor `anthropic` in the cost monitor (AlUmmahNow).
- A per-site monthly AI budget with a hard stop (needs #266's budgets).
- AI assist for navigation labels and site settings.
