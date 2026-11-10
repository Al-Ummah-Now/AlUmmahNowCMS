# AI assist providers — adding one by configuration

AI writing assist (translate, search & sharing suggestions, pre-publish check — `docs/AI_ASSIST_SPEC.md`)
runs on **Cloudflare Workers AI** by default, through the Worker's `AI` binding, with no key. Any other AI
service that has an HTTP API can be added **without code**. An admin describes it in
**CMS → AI assist** (`/ai-settings`) as one *HTTP provider*. The CMS has no vendor-specific code, presets or
adapters: there is the built-in Workers AI provider and one generic HTTP provider that you configure.

## In one paragraph

Put the service's API key in this environment's Worker as a secret whose name starts with `AI_KEY_`
(`wrangler secret put AI_KEY_MYSERVICE --env qa`, or bind a Secrets Store secret under that name). Then
open **AI assist → Add a provider**. Fill in the endpoint URL and method, how the key is sent (a header
plus an optional prefix such as `Bearer `, or a query parameter) and the secret's name (pick it from the
list). Add a JSON body template with placeholders, the JSON paths where the response carries the answer
text (and, optionally, the token counts, the error message and the stop reason), the timeout, and the
price per 1,000 input and output tokens. List the model ids, run **Test connection** until it shows
"Connected", switch the provider on, choose it (and a model) for one or more features, optionally set a
fallback, and **Save settings**.

## Fields

| Field | What it is | Checked on save |
|---|---|---|
| Name, ID | Free name; the ID (`a-z 0-9 -`, 2–32 characters) appears in usage reports as vendor `http:<id>` and can't change later | ID unique, not `workers-ai` |
| Enabled | New providers start **off**. A feature can only use an enabled provider | — |
| HTTP method | `POST`, `PUT` or `PATCH` | — |
| Endpoint URL | `https://` only. May contain `{{model}}` (URL-encoded), e.g. `https://host/v2/models/{{model}}:generate` | https, no user/password, no key-looking text, no other placeholders |
| How the key is sent | *In a header* (header name + optional prefix), *in a query parameter* (name), or *no key* | header/param names are valid |
| Secret name | A Worker secret or Secrets Store binding named `AI_KEY_…`. Only the name is stored; the key is read when a call is made and never shown | must start with `AI_KEY_` (so a provider can never be pointed at another secret) |
| Extra headers | Fixed, non-secret headers (an API version, a feature flag) | no credential-named header (`Authorization`, `*-Key`, `*Token*`…), no key-looking value |
| Request body template | A JSON object with placeholders (below) | valid JSON after filling in, includes the prompt, only known placeholders, no key-looking text |
| Response paths | Where things are in the JSON response: `choices[0].message.content`, `$.data.outputs[0].text`… | each is a valid path |
| Streaming | Server-sent events: the *answer text* path is read from every `data:` event and joined; token counts and stop reason from the last event that has them | — |
| Timeout | 1–300 seconds per call | range |
| Price | USD per 1,000 input tokens and per 1,000 output tokens (for the cost estimate and the monthly budget) | 0–10 |
| Models | One id per line; offered in the feature pickers | 1–20 ids |

### Body placeholders

Each placeholder stands on its own as a JSON **value** and is replaced by that value JSON-encoded (so
write `"model": {{model}}`, not `"model": "{{model}}"`).

| Placeholder | Value |
|---|---|
| `{{model}}` | the model id chosen for the feature |
| `{{system}}` | the feature's system instructions (string) |
| `{{prompt}}` | the editor's document (string) |
| `{{messages_json}}` | `[{"role":"user","content":…}]` |
| `{{messages_with_system_json}}` | the same with `{"role":"system","content":…}` first |
| `{{max_tokens}}` | the output limit for the feature (number) |
| `{{temperature}}` | `0.2` |
| `{{json_schema}}` | the JSON schema the answer must follow (object) |
| `{{reasoning}}` | `"none"`, `"low"` or `"high"` |

If the template does not use `{{json_schema}}`, the schema is added to the system instructions instead.
Either way the CMS validates the answer against it (and retries an unusable answer), exactly as it does for
Workers AI: prompts, chunking (6,000 characters per translation chunk) and validation don't depend on the
provider.

### Two examples (made-up services)

A chat-style API, key in a header:

```
URL       https://ai.example.net/v1/chat            POST
Key       header "Authorization", prefix "Bearer ", secret AI_KEY_EXAMPLE
Body      {"model": {{model}}, "messages": {{messages_with_system_json}}, "max_tokens": {{max_tokens}},
           "temperature": {{temperature}}, "response_format": {"type": "json_schema", "schema": {{json_schema}}}}
Paths     text choices[0].message.content · input usage.prompt_tokens · output usage.completion_tokens
          error error.message · stop choices[0].finish_reason
```

A task-style API, model in the URL, key in the query:

```
URL       https://gen.example.org/v2/generate/{{model}}   PUT
Key       query "key", secret AI_KEY_GEN
Body      {"task": {"instructions": {{system}}, "input": {{prompt}}}, "limits": {"output": {{max_tokens}}}}
Paths     text data.outputs[0].text · input meta.tokens.in · output meta.tokens.out
          error problem.detail · stop data.outputs[0].stop
```

Both are in the tests (`test/support/fake-http-providers.ts`, `test/node/ai-providers.test.ts`), with
streaming. To log, cache and rate-limit calls in Cloudflare, point the URL at an AI Gateway endpoint for
that service. It is a URL like any other.

## Feature routing, fallback and budget

- **Who answers each feature:** a provider and a model for translation, search & sharing, and the
  pre-publish check.
- **Fallback:** one provider and model, tried **once** when the first one fails with a rate limit,
  an outage, a network error or timeout, a refused key, a rejected request or a missing secret. It is not
  tried when the model declined the text or the answer was cut off. Every attempt is logged.
- **Monthly budget:** the month-to-date estimate (`ai_usage.cost_usd`, UTC month, this environment)
  against the cap. When the estimate reaches the cap, new jobs get `402 budget_reached`. Running jobs
  stop before their next call, and editors see "AI assist has reached this month's budget…". Default
  $50, maximum $500 (the platform cap).

## What "Test connection" does

It sends one tiny fixed prompt (asking for `{"reply":"ok"}` with a schema) through the provider **as the
form is now**, saved or not and on or off. It shows the latency, tokens and estimated cost, or the failure
class, the mapped error message and the response as received (truncated, and with the key blanked out if
the service echoes it). The call is logged in `ai_usage` (feature `test`) and in the audit trail.

## Safety rules (enforced)

- Keys are never stored in D1, never shown and never logged. The settings hold only the secret's
  **name**, which must start with `AI_KEY_`. `scripts/check-secrets.ts` (pre-promote gate) fails when an
  `AI_KEY_*` binding is a plain variable, or when **any other** credential-named binding exists.
  `scripts/check-wrangler-config.ts` refuses key-like `vars`, and `scripts/check-committed-secrets.mjs`
  refuses committed key literals.
- Only admins can see or change these settings, or run a test. Every save is versioned (a stale form is
  refused) and written to `ai_settings_audit` with who, when and which settings changed. Tests are audited
  too.
- Draft text goes to whichever provider a feature uses. Before you enable a third-party provider for a
  feature, make sure that is acceptable for this environment's content.
