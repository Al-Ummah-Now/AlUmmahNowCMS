/**
 * Pluggable AI providers (docs/AI_PROVIDERS.md, AI_ASSIST_SPEC §2.2): the provider contract run against
 * the Workers AI adapter, a fake provider and the generic HTTP provider configured for two unrelated
 * API shapes (one streaming); templates and response paths; settings validation; the fallback router.
 */
import { describe, expect, it } from "vitest";
import { buildHttpRequest, createHttpProvider, type HttpProviderConfig } from "../../src/lib/ai/providers/http.ts";
import { getPath, parsePath, renderBody } from "../../src/lib/ai/providers/shared.ts";
import type { CompletionRequest, WritingAssistProvider } from "../../src/lib/ai/providers/types.ts";
import { createWorkersAiProvider } from "../../src/lib/ai/providers/workers-ai.ts";
import { MODEL_ID, SCHEMAS, seoSystem } from "../../src/lib/ai/prompts.ts";
import { createRouter, shouldFallBack } from "../../src/lib/ai/router.ts";
import { changedPaths, defaultSettings, looksLikeCredential, secretReader, validateSettings, type AiSettings } from "../../src/lib/ai/settings.ts";
import { fakeHttp, fakeProvider, KEY_A, KEY_B, readFake, shapeA, shapeB, shapeBStream } from "../support/fake-http-providers.ts";
import { mockWorkersAi } from "../support/workers-ai-mock.ts";

const seoReq = (model: string): CompletionRequest => ({
   model,
   system: seoSystem("en"),
   messages: [{ role: "user", content: "<document>\n<title>\nRamadan timetable\n</title>\n</document>" }],
   schema: SCHEMAS.seo,
   reasoning: "none",
   maxTokens: 200,
});

interface Subject {
   name: string;
   model: string;
   make: (decide?: Parameters<typeof fakeHttp>[0]) => WritingAssistProvider;
}

const subjects: Subject[] = [
   { name: "workers-ai (binding)", model: MODEL_ID, make: (d) => createWorkersAiProvider(mockWorkersAi(d as never).binding) },
   { name: "http shape A (header key, nested chat JSON)", model: "a-small", make: (d) => createHttpProvider(shapeA(), { readSecret: readFake, fetch: fakeHttp(d).fetch }) },
   { name: "http shape B (query key, model in URL, flat JSON)", model: "b/one", make: (d) => createHttpProvider(shapeB(), { readSecret: readFake, fetch: fakeHttp(d).fetch }) },
   { name: "http shape B streaming (SSE)", model: "b/one", make: (d) => createHttpProvider(shapeBStream(), { readSecret: readFake, fetch: fakeHttp(d).fetch }) },
];

describe.each(subjects)("provider contract: $name", ({ model, make }) => {
   it("answers with validated JSON, usage, cost, provider and model", async () => {
      const r = await make().complete(seoReq(model));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.json).toMatchObject({ seo_title: expect.stringContaining("Ramadan timetable"), seo_description: expect.any(String), social_summary: expect.any(String) });
      expect(r.model).toBe(model);
      expect(r.usage.inputTokens).toBe(1200);
      expect(r.usage.outputTokens).toBe(300);
      expect(r.costUsd).toBeGreaterThan(0);
      expect(r.latencyMs).toBeGreaterThanOrEqual(0);
   });

   it("classifies capacity (retry), refusal and a cut-off answer (no retry), and non-JSON (retry)", async () => {
      const busy = await make(() => ({ kind: "error", code: 3040, status: 429, message: "Capacity exceeded" })).complete(seoReq(model));
      expect(busy).toMatchObject({ ok: false, code: "rate_limited", retryable: true });
      const cut = await make(() => ({ kind: "json", data: { a: 1 }, finish: "length" })).complete(seoReq(model));
      expect(cut).toMatchObject({ ok: false, code: "incomplete", retryable: false });
      const refused = await make(() => ({ kind: "json", data: {}, finish: "content_filter" })).complete(seoReq(model));
      expect(refused).toMatchObject({ ok: false, code: "declined", retryable: false });
      const prose = await make(() => ({ kind: "text", text: "Sure! Here is your SEO copy." })).complete(seoReq(model));
      expect(prose).toMatchObject({ ok: false, code: "invalid_output", retryable: true });
   });
});

describe("generic HTTP provider: the request is pure configuration", () => {
   it("shape A: POST, Bearer header from the secret, static header, JSON placeholders in place", () => {
      const { url, init } = buildHttpRequest(shapeA(), seoReq("a-large"), KEY_A);
      expect(url).toBe("https://a.example/v1/chat");
      expect(init.method).toBe("POST");
      const h = new Headers(init.headers);
      expect(h.get("authorization")).toBe(`Bearer ${KEY_A}`);
      expect(h.get("x-api-version")).toBe("2026-01");
      const body = JSON.parse(String(init.body));
      expect(body).toEqual({
         model: "a-large",
         messages: [{ role: "system", content: seoSystem("en") }, seoReq("a").messages[0]],
         max_tokens: 200,
         temperature: 0.2,
         response_format: { type: "json_schema", schema: SCHEMAS.seo },
      });
   });

   it("shape B: PUT, model in the path (encoded), key in the query, schema moved into the instructions", () => {
      const { url, init } = buildHttpRequest(shapeB(), seoReq("b/one"), KEY_B);
      const u = new URL(url);
      expect(u.pathname).toBe("/v2/generate/b%2Fone");
      expect(u.searchParams.get("key")).toBe(KEY_B);
      expect(init.method).toBe("PUT");
      const body = JSON.parse(String(init.body));
      expect(Object.keys(body)).toEqual(["task", "limits"]);
      expect(body.task.input).toContain("Ramadan timetable");
      expect(body.task.instructions).toContain(seoSystem("en"));
      expect(body.task.instructions).toContain(JSON.stringify(SCHEMAS.seo));
      expect(body.limits).toEqual({ output: 200 });
   });

   it("errors: status classes, the mapped message as detail, and the key never in what is returned", async () => {
      const echo = (status: number) => () => ({ kind: "http" as const, status, body: JSON.stringify({ error: { message: `key ${KEY_A} is not allowed` } }) });
      const p = (d: Parameters<typeof fakeHttp>[0]) => createHttpProvider(shapeA(), { readSecret: readFake, fetch: fakeHttp(d).fetch });
      const auth = await p(echo(401)).complete(seoReq("a-small"));
      expect(auth).toMatchObject({ ok: false, code: "auth", retryable: false });
      expect(JSON.stringify(auth)).not.toContain(KEY_A);
      expect(auth.ok ? "" : auth.detail).toContain("[redacted]");
      expect(await p(echo(400)).complete(seoReq("a-small"))).toMatchObject({ code: "bad_request", retryable: false });
      expect(await p(echo(503)).complete(seoReq("a-small"))).toMatchObject({ code: "unavailable", retryable: true });
      // An error message inside a 200
      const soft = await p(() => ({ kind: "http", status: 200, body: JSON.stringify({ error: { message: "overloaded" } }) })).complete(seoReq("a-small"));
      expect(soft).toMatchObject({ ok: false, code: "unknown", retryable: true, detail: "overloaded" });
      // Wrong key → the provider's 401, the key is refused
      const wrong = await createHttpProvider(shapeA(), { readSecret: async () => "nope", fetch: fakeHttp().fetch }).complete(seoReq("a-small"));
      expect(wrong).toMatchObject({ code: "auth" });
   });

   it("missing secret, disabled provider, network failure and timeout", async () => {
      const missing = await createHttpProvider(shapeA(), { readSecret: async () => null, fetch: fakeHttp().fetch }).complete(seoReq("a-small"));
      expect(missing).toMatchObject({ ok: false, code: "not_configured", retryable: false });
      const off = await createHttpProvider(shapeA({ enabled: false }), { readSecret: readFake, fetch: fakeHttp().fetch }).complete(seoReq("a-small"));
      expect(off).toMatchObject({ ok: false, code: "not_configured" });
      const down = await createHttpProvider(shapeA(), { readSecret: readFake, fetch: (async () => Promise.reject(new TypeError("fetch failed"))) as typeof fetch }).complete(seoReq("a-small"));
      expect(down).toMatchObject({ ok: false, code: "network", retryable: true });
      const hang = (async (_: unknown, init?: RequestInit) =>
         new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("t"), { name: "TimeoutError" }))))) as typeof fetch;
      const slow = await createHttpProvider(shapeA({ timeoutMs: 20 }), { readSecret: readFake, fetch: hang }).complete(seoReq("a-small"));
      expect(slow).toMatchObject({ ok: false, code: "network", detail: "timeout" });
   });

   it("without token paths, usage is estimated high (never under-reported)", async () => {
      const cfg = shapeA({ response: { text: "choices[0].message.content" } });
      const r = await createHttpProvider(cfg, { readSecret: readFake, fetch: fakeHttp().fetch }).complete(seoReq("a-small"));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const sent = JSON.stringify(buildHttpRequest(cfg, seoReq("a-small"), KEY_A).init.body);
      expect(r.usage.inputTokens).toBeGreaterThanOrEqual(Math.floor(sent.length / 4));
      expect(r.usage.outputTokens).toBeGreaterThan(0);
   });

   it("paths and templates", () => {
      expect(parsePath("choices[0].message.content")).toEqual(["choices", 0, "message", "content"]);
      expect(parsePath("$.data.outputs[0].text")).toEqual(["data", "outputs", 0, "text"]);
      for (const bad of ["", "a..b", "a[x]", "a.b.", "__proto__.x[", "a b"]) expect(parsePath(bad)).toBeNull();
      expect(getPath({ a: [{ b: 2 }] }, "a[0].b")).toBe(2);
      expect(getPath({ a: 1 }, "constructor")).toBeUndefined();
      expect(getPath({ a: [1] }, "a.length")).toBeUndefined();
      expect(renderBody('{"s": {{system}}, "n": {{ max_tokens }}}', { system: 'quote " and \\n', max_tokens: 5 })).toBe('{"s": "quote \\" and \\\\n", "n": 5}');
   });
});

const local = { local: false };
const withProviders = (...extra: HttpProviderConfig[]): AiSettings => {
   const d = defaultSettings();
   return { ...d, providers: [...d.providers, ...extra] };
};

describe("settings validation", () => {
   it("the defaults are valid: Workers AI only, a $50 cap, no fallback", () => {
      const d = defaultSettings();
      expect(validateSettings(d, local)).toEqual({ ok: true, settings: d });
      expect(d.providers.map((p) => p.id)).toEqual(["workers-ai"]);
      expect(d.monthlyBudgetUsd).toBe(50);
   });

   it("accepts both shapes, a feature on one of them and a fallback on the other", () => {
      const s = { ...withProviders(shapeA(), shapeB()), features: { ...defaultSettings().features, seo: { provider: "shape-a", model: "a-large" } }, fallback: { provider: "workers-ai", model: MODEL_ID } };
      const v = validateSettings(s, local);
      expect(v.ok).toBe(true);
   });

   const errorsOf = (s: unknown, opts = local) => {
      const v = validateSettings(s, opts);
      return v.ok ? [] : v.errors.map((e) => `${e.path}:${e.code}`);
   };

   it("refuses keys anywhere in the config, non-https endpoints and auth headers with static values", () => {
      const leaky = shapeA({
         url: "http://a.example/v1/chat",
         headers: [
            { name: "Authorization", value: "Bearer x" },
            { name: "X-Trace", value: "sk-Zr8kQ2mW9xN4pL7vB3cT6yH1jF5gD0aS" }, // secret-scan:allow (fake)
         ],
         bodyTemplate: '{"model": {{model}}, "messages": {{messages_json}}, "api_key": "AbCdEf0123456789GhIjKlMnOpQrStUv"}',
      });
      expect(errorsOf(withProviders(leaky))).toEqual(
         expect.arrayContaining(["providers.1.url:not_https", "providers.1.headers.0.name:auth_header", "providers.1.headers.1.value:credential", "providers.1.bodyTemplate:credential"]),
      );
      expect(errorsOf(withProviders(shapeA({ url: "https://user:pw@a.example/x" })))).toContain("providers.1.url:credential");
      // A local mock on loopback is fine only in a local run
      expect(errorsOf(withProviders(shapeA({ url: "http://127.0.0.1:8788/v1/chat" })), { local: true })).toEqual([]);
      expect(errorsOf(withProviders(shapeA({ url: "http://127.0.0.1:8788/v1/chat" })))).toContain("providers.1.url:not_https");
   });

   it("secrets are names with the AI_KEY_ prefix (so a provider can't be pointed at the session secret)", () => {
      expect(errorsOf(withProviders(shapeA({ auth: { type: "header", header: "Authorization", prefix: "Bearer ", secret: "BKND_JWT_SECRET" } })))).toContain("providers.1.auth.secret:secret_name");
      expect(errorsOf(withProviders(shapeB({ auth: { type: "query", param: "key", secret: "ai_key_lower" } })))).toContain("providers.1.auth.secret:secret_name");
   });

   it("checks templates and paths on save", () => {
      expect(errorsOf(withProviders(shapeA({ bodyTemplate: '{"model": {{model}}, "p": {{prompt}}, "x": {{api_key}}}' })))).toContain("providers.1.bodyTemplate:unknown_placeholder");
      expect(errorsOf(withProviders(shapeA({ bodyTemplate: '{"model": {{model}}}' })))).toContain("providers.1.bodyTemplate:bad_template");
      expect(errorsOf(withProviders(shapeA({ bodyTemplate: '{"text": "System: {{system}}"}' })))).toContain("providers.1.bodyTemplate:bad_template");
      expect(errorsOf(withProviders(shapeA({ bodyTemplate: "[{{prompt}}]" })))).toContain("providers.1.bodyTemplate:bad_template");
      expect(errorsOf(withProviders(shapeA({ response: { text: "choices[0]..content", inputTokens: "usage tokens" } })))).toEqual(
         expect.arrayContaining(["providers.1.response.text:bad_path", "providers.1.response.inputTokens:bad_path"]),
      );
      expect(errorsOf(withProviders(shapeA({ url: "https://a.example/{{secret}}" })))).toContain("providers.1.url:unknown_placeholder");
   });

   it("ids, routes, pricing and budget", () => {
      expect(errorsOf(withProviders(shapeA(), shapeA()))).toContain("providers.2.id:duplicate");
      expect(errorsOf(withProviders(shapeA({ id: "workers-ai" })))).toContain("providers.1.id:reserved");
      expect(errorsOf({ ...defaultSettings(), providers: [shapeA()] })).toContain("providers:required");
      const route = (provider: string, model: string) => ({ ...withProviders(shapeA({ enabled: false })), features: { ...defaultSettings().features, check: { provider, model } } });
      expect(errorsOf(route("shape-a", "a-small"))).toContain("features.check.provider:disabled_provider");
      expect(errorsOf(route("nobody", "a-small"))).toContain("features.check.provider:unknown_provider");
      expect(errorsOf(route("workers-ai", "a-small"))).toContain("features.check.model:unknown_model");
      expect(errorsOf(withProviders(shapeA({ pricing: { inputPer1k: -1, outputPer1k: 99 } })))).toEqual(
         expect.arrayContaining(["providers.1.pricing.inputPer1k:out_of_range", "providers.1.pricing.outputPer1k:out_of_range"]),
      );
      expect(errorsOf({ ...defaultSettings(), monthlyBudgetUsd: 501 })).toContain("monthlyBudgetUsd:out_of_range");
      expect(errorsOf({ ...defaultSettings(), monthlyBudgetUsd: 0 })).toContain("monthlyBudgetUsd:out_of_range");
      expect(validateSettings({ ...defaultSettings(), monthlyBudgetUsd: null }, local).ok).toBe(true);
   });

   it("credential heuristic and audit paths", () => {
      expect(looksLikeCredential("2026-01")).toBe(false);
      expect(looksLikeCredential("application/json")).toBe(false);
      expect(looksLikeCredential("ABCDEF0123456789abcdef0123456789")).toBe(true);
      const before = withProviders(shapeA(), shapeB());
      const after = { ...before, providers: [before.providers[0], { ...shapeB(), enabled: false }, shapeA()], monthlyBudgetUsd: 20 };
      expect(changedPaths(before, after).sort()).toEqual(["monthlyBudgetUsd", "providers.shape-b.enabled"]);
   });

   it("reads secrets by allowed name only: Worker secrets and Secrets Store bindings", async () => {
      const read = secretReader({ AI_KEY_X: " k1 ", AI_KEY_STORE: { get: async () => "k2" }, BKND_JWT_SECRET: "never", AI_KEY_EMPTY: "" });
      expect(await read("AI_KEY_X")).toBe("k1");
      expect(await read("AI_KEY_STORE")).toBe("k2");
      expect(await read("BKND_JWT_SECRET")).toBeNull();
      expect(await read("AI_KEY_EMPTY")).toBeNull();
      expect(await read("AI_KEY_NONE")).toBeNull();
   });
});

describe("router: provider per feature, one fallback", () => {
   const settings = (fallback: AiSettings["fallback"]): AiSettings => ({
      ...withProviders(shapeA(), shapeB()),
      features: { translate: { provider: "shape-a", model: "a-small" }, seo: { provider: "shape-a", model: "a-small" }, check: { provider: "workers-ai", model: MODEL_ID } },
      fallback,
   });

   it("falls back once on an outage and reports both attempts", async () => {
      const a = fakeProvider("shape-a", () => ({ ok: false, code: "unavailable", retryable: true }));
      const b = fakeProvider("shape-b", () => ({ ok: true, json: { ok: 1 }, text: "{}" }));
      const seen: string[] = [];
      const r = await createRouter(settings({ provider: "shape-b", model: "b/one" }), { ENVIRONMENT: "qa" }, { providers: { "shape-a": a.provider, "shape-b": b.provider } }).complete(
         "seo",
         { system: "s", messages: [{ role: "user", content: "u" }], maxTokens: 10 },
         async ({ route, result }) => void seen.push(`${route.provider}/${route.model}:${result.ok ? "ok" : result.code}`),
      );
      expect(r).toMatchObject({ ok: true, provider: "shape-b", model: "b/one" });
      expect(seen).toEqual(["shape-a/a-small:unavailable", "shape-b/b/one:ok"]);
      expect(a.calls[0].model).toBe("a-small");
   });

   it("never falls back on a refusal or a cut-off answer; with no fallback the error stands", async () => {
      expect(shouldFallBack("declined")).toBe(false);
      expect(shouldFallBack("incomplete")).toBe(false);
      expect(shouldFallBack("auth")).toBe(true);
      const a = fakeProvider("shape-a", () => ({ ok: false, code: "declined", retryable: false }));
      const b = fakeProvider("shape-b", () => ({ ok: true }));
      const deps = { providers: { "shape-a": a.provider, "shape-b": b.provider } };
      const r = await createRouter(settings({ provider: "shape-b", model: "b/one" }), { ENVIRONMENT: "qa" }, deps).complete("seo", { system: "s", messages: [], maxTokens: 1 }, async () => {});
      expect(r).toMatchObject({ ok: false, code: "declined" });
      expect(b.calls).toHaveLength(0);
      const down = fakeProvider("shape-a", () => ({ ok: false, code: "unavailable", retryable: true }));
      const none = await createRouter(settings(null), { ENVIRONMENT: "qa" }, { providers: { "shape-a": down.provider } }).complete("seo", { system: "s", messages: [], maxTokens: 1 }, async () => {});
      expect(none).toMatchObject({ ok: false, code: "unavailable", retryable: true });
   });

   it("when both fail, the retryable failure wins so the job is retried", async () => {
      const a = fakeProvider("shape-a", () => ({ ok: false, code: "unavailable", retryable: true }));
      const b = fakeProvider("shape-b", () => ({ ok: false, code: "auth", retryable: false }));
      const r = await createRouter(settings({ provider: "shape-b", model: "b/one" }), { ENVIRONMENT: "qa" }, { providers: { "shape-a": a.provider, "shape-b": b.provider } }).complete("translate", { system: "s", messages: [], maxTokens: 1 }, async () => {});
      expect(r).toMatchObject({ ok: false, code: "unavailable", retryable: true });
   });

   it("the real HTTP adapters behind the router: shape A down → shape B answers", async () => {
      const http = fakeHttp((req) => (req.model === "a-small" ? { kind: "error", code: 0, status: 503, message: "down" } : undefined));
      const env = { ENVIRONMENT: "qa", AI_KEY_A: KEY_A, AI_KEY_B: KEY_B } as never;
      const r = await createRouter(settings({ provider: "shape-b", model: "b/one" }), env, { fetch: http.fetch }).complete("seo", { system: seoSystem("en"), messages: seoReq("x").messages, schema: SCHEMAS.seo, maxTokens: 100 }, async () => {});
      expect(r).toMatchObject({ ok: true, provider: "shape-b" });
      expect(http.seen.map((s) => s.url.host)).toEqual(["a.example", "b.example"]);
   });
});
