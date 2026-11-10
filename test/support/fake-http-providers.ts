/**
 * Two invented HTTP AI APIs with nothing in common, to prove the generic HTTP provider is configured
 * entirely by data (docs/AI_PROVIDERS.md). Both answer from the same canned replies as the Workers AI
 * mock (test/support/workers-ai-mock.ts defaultReply), so the features see identical results.
 *
 *   Shape A  POST https://a.example/v1/chat           key in `Authorization: Bearer …`
 *            { model, messages:[system,user], max_tokens, temperature, response_format{schema} }
 *            → { choices:[{ message:{content}, finish_reason }], usage:{prompt_tokens, completion_tokens} }
 *            errors: { error:{ message } }
 *   Shape B  PUT  https://b.example/v2/generate/<model> key in `?key=…`, no schema parameter
 *            { task:{ instructions, input }, limits:{ output } }
 *            → { data:{ outputs:[{ text, stop }] }, meta:{ tokens:{ in, out } } }       (or SSE events)
 *            errors: { problem:{ detail } }
 */
import type { HttpProviderConfig } from "../../src/lib/ai/providers/http.ts";
import type { CompletionRequest, CompletionResult, WritingAssistProvider } from "../../src/lib/ai/providers/types.ts";
import { defaultReply, type MockReply, type MockRequest } from "./workers-ai-mock.ts";

export const KEY_A = "test-key-a-not-real";
export const KEY_B = "test-key-b-not-real";

export const shapeA = (over: Partial<HttpProviderConfig> = {}): HttpProviderConfig => ({
   id: "shape-a",
   kind: "http",
   label: "Shape A",
   enabled: true,
   method: "POST",
   url: "https://a.example/v1/chat",
   auth: { type: "header", header: "Authorization", prefix: "Bearer ", secret: "AI_KEY_A" },
   headers: [{ name: "X-Api-Version", value: "2026-01" }],
   bodyTemplate:
      '{"model": {{model}}, "messages": {{messages_with_system_json}}, "max_tokens": {{max_tokens}}, "temperature": {{temperature}}, "response_format": {"type": "json_schema", "schema": {{json_schema}}}}',
   response: { text: "choices[0].message.content", inputTokens: "usage.prompt_tokens", outputTokens: "usage.completion_tokens", error: "error.message", finish: "choices[0].finish_reason" },
   streaming: false,
   timeoutMs: 5000,
   pricing: { inputPer1k: 0.001, outputPer1k: 0.002 },
   models: ["a-small", "a-large"],
   ...over,
});

export const shapeB = (over: Partial<HttpProviderConfig> = {}): HttpProviderConfig => ({
   id: "shape-b",
   kind: "http",
   label: "Shape B",
   enabled: true,
   method: "PUT",
   url: "https://b.example/v2/generate/{{model}}",
   auth: { type: "query", param: "key", secret: "AI_KEY_B" },
   headers: [],
   bodyTemplate: '{"task": {"instructions": {{system}}, "input": {{prompt}}}, "limits": {"output": {{max_tokens}}}}',
   response: { text: "data.outputs[0].text", inputTokens: "meta.tokens.in", outputTokens: "meta.tokens.out", error: "problem.detail", finish: "data.outputs[0].stop" },
   streaming: false,
   timeoutMs: 5000,
   pricing: { inputPer1k: 0.01, outputPer1k: 0.03 },
   models: ["b/one"],
   ...over,
});

/** Shape B with server-sent events: text pieces in `delta.t`, usage and stop on the last event. */
export const shapeBStream = (over: Partial<HttpProviderConfig> = {}): HttpProviderConfig =>
   shapeB({ id: "shape-b-stream", streaming: true, response: { text: "delta.t", inputTokens: "meta.tokens.in", outputTokens: "meta.tokens.out", error: "problem.detail", finish: "stop" }, ...over });

export interface Seen {
   url: URL;
   method: string;
   headers: Headers;
   body: Record<string, unknown>;
   req: MockRequest;
}

type Decide = (req: MockRequest, n: number) => MockReply | { kind: "http"; status: number; body: string } | undefined;

const text = (r: MockReply) => (r.kind === "json" ? JSON.stringify(r.data) : r.kind === "text" ? r.text : "");

/** A `fetch` serving both shapes. `decide` may override the default reply per request. */
export function fakeHttp(decide: Decide = () => undefined) {
   const seen: Seen[] = [];
   const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      let req: MockRequest;
      if (url.host === "a.example") {
         if (headers.get("authorization") !== `Bearer ${KEY_A}`) return Response.json({ error: { message: `bad key ${headers.get("authorization")}` } }, { status: 401 });
         const msgs = body.messages as { role: string; content: string }[];
         req = { model: String(body.model), system: msgs.find((m) => m.role === "system")?.content ?? "", user: msgs.find((m) => m.role === "user")?.content ?? "", inputs: body };
      } else if (url.host === "b.example") {
         if (url.searchParams.get("key") !== KEY_B) return Response.json({ problem: { detail: "who are you" } }, { status: 403 });
         const task = body.task as { instructions: string; input: string };
         req = { model: decodeURIComponent(url.pathname.split("/").pop() ?? ""), system: task.instructions, user: task.input, inputs: body };
      } else return new Response("no such host", { status: 404 });
      seen.push({ url, method, headers, body, req });
      const reply = decide(req, seen.length) ?? defaultReply(req);
      if (reply.kind === "http") return new Response(reply.body, { status: reply.status, headers: { "content-type": "application/json" } });
      if (reply.kind === "error") {
         const status = reply.status ?? 500;
         return url.host === "a.example" ? Response.json({ error: { message: reply.message ?? "error" } }, { status }) : Response.json({ problem: { detail: reply.message ?? "error" } }, { status });
      }
      const out = text(reply);
      const finish = reply.finish ?? "stop";
      if (url.host === "a.example") {
         return Response.json({ choices: [{ message: { content: out }, finish_reason: finish }], usage: { prompt_tokens: 1200, completion_tokens: 300 } });
      }
      if (headers.get("accept") === "text/event-stream") {
         const mid = Math.floor(out.length / 2);
         const events = [{ delta: { t: out.slice(0, mid) } }, { delta: { t: out.slice(mid) } }, { stop: finish === "stop" ? "done" : finish, meta: { tokens: { in: 1200, out: 300 } } }];
         return new Response(`${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
      }
      return Response.json({ data: { outputs: [{ text: out, stop: finish === "stop" ? "done" : finish }] }, meta: { tokens: { in: 1200, out: 300 } } });
   }) as typeof fetch;
   return { fetch: impl, seen };
}

/** Secrets as a Worker would see them. */
export const fakeSecrets: Record<string, string> = { AI_KEY_A: KEY_A, AI_KEY_B: KEY_B };
export const readFake = async (name: string) => fakeSecrets[name] ?? null;

/** An in-memory provider: scripted results, every request recorded (the contract's reference implementation). */
export function fakeProvider(id: string, script: (req: CompletionRequest, n: number) => Partial<CompletionResult> & { ok: boolean }) {
   const calls: CompletionRequest[] = [];
   const provider: WritingAssistProvider = {
      id,
      kind: "http",
      async complete(req) {
         calls.push(req);
         const r = script(req, calls.length);
         const base = { provider: id, kind: "http" as const, model: req.model, latencyMs: 1, usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0 }, costUsd: 0.0001 };
         return (r.ok ? { ...base, text: "", ...r } : { ...base, retryable: true, code: "unavailable", ...r }) as CompletionResult;
      },
   };
   return { provider, calls };
}
