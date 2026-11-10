/**
 * A fake Claude Messages API for tests (worker tests via the SDK's `fetch` option, and the local E2E
 * mock server). Answers streaming requests with SSE, deciding the reply from the system prompt:
 * translation → the source fields marked as translated (URLs and ::video lines kept), SEO → three
 * fields, check → one item per section. No network, no key.
 */

export interface MockRequest {
   model: string;
   system: string;
   user: string;
   betas: string[];
   body: Record<string, unknown>;
}

export type MockReply =
   | { kind: "json"; data: unknown; model?: string; stop?: string; input?: number; output?: number }
   | { kind: "status"; status: number; body?: unknown };

const tag = (text: string, name: string) => text.match(new RegExp(`<${name}>\\n([\\s\\S]*?)\\n</${name}>`))?.[1] ?? "";

/** The default replies by feature (what the local E2E sees). */
export function defaultReply(req: MockRequest): MockReply {
   const s = req.system;
   if (s.includes("Translate the draft")) {
      const toAr = s.includes("into Modern Standard Arabic");
      const mark = (t: string) => (t ? (toAr ? `ترجمة: ${t}` : `Translated: ${t}`) : "");
      const body = tag(req.user, "body");
      const translated = body
         .split("\n")
         .map((l) => (l.startsWith("::video[") || !l.trim() ? l : mark(l)))
         .join("\n");
      if (req.user.includes("<title>")) return { kind: "json", data: { title: mark(tag(req.user, "title")), summary: mark(tag(req.user, "summary")), body: translated }, model: req.model };
      return { kind: "json", data: { body: translated }, model: req.model };
   }
   if (s.includes("search and sharing copy")) {
      const title = tag(req.user, "title");
      return {
         kind: "json",
         data: { seo_title: `${title} — guide`.slice(0, 60), seo_description: `What ${title} covers, in two plain sentences.`, social_summary: `Read: ${title}` },
         model: req.model,
      };
   }
   if (s.includes("Review the draft")) {
      return {
         kind: "json",
         data: {
            summary: "Clear overall; two things to look at.",
            tone: [{ quote: tag(req.user, "title"), note: "A little sensational.", suggestion: "A calmer title." }],
            claims: [{ quote: "1,000", why: "A number without a source.", verify: "Check the figure." }],
            policy: [{ category: "religious_authenticity", severity: "warn", quote: "a hadith", note: "Attribution needs a scholar's check." }],
         },
         model: req.model,
      };
   }
   return { kind: "status", status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "unknown prompt" } } };
}

function sse(model: string, text: string, stop: string, input: number, output: number): string {
   const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
   return (
      ev("message_start", {
         type: "message_start",
         message: { id: "msg_mock", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: input, output_tokens: 1 } },
      }) +
      ev("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }) +
      ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }) +
      ev("content_block_stop", { type: "content_block_stop", index: 0 }) +
      ev("message_delta", { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: output } }) +
      ev("message_stop", { type: "message_stop" })
   );
}

export function parseMockRequest(body: string, headers: Headers): MockRequest {
   const b = JSON.parse(body) as Record<string, unknown>;
   const msgs = (b.messages as { content: unknown }[]) ?? [];
   const user = typeof msgs[0]?.content === "string" ? (msgs[0].content as string) : JSON.stringify(msgs[0]?.content ?? "");
   const system = typeof b.system === "string" ? b.system : JSON.stringify(b.system ?? "");
   return { model: String(b.model), system, user, betas: (headers.get("anthropic-beta") ?? "").split(",").filter(Boolean), body: b };
}

export function replyResponse(reply: MockReply): Response {
   if (reply.kind === "status") return Response.json(reply.body ?? { type: "error", error: { type: "api_error", message: "mock" } }, { status: reply.status });
   const text = JSON.stringify(reply.data);
   return new Response(sse(reply.model ?? "claude-sonnet-5-5", text, reply.stop ?? "end_turn", reply.input ?? 1200, reply.output ?? 300), {
      headers: { "content-type": "text/event-stream" },
   });
}

/** A `fetch` for the SDK. `decide` may override the default reply per request; every request is recorded. */
export function mockAnthropicFetch(decide: (req: MockRequest, n: number) => MockReply | undefined = () => undefined) {
   const requests: MockRequest[] = [];
   const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      const url = new URL(req.url);
      if (!url.pathname.endsWith("/v1/messages")) return new Response("not found", { status: 404 });
      const parsed = parseMockRequest(await req.text(), req.headers);
      requests.push(parsed);
      return replyResponse(decide(parsed, requests.length) ?? defaultReply(parsed));
   }) as typeof fetch;
   return { fetch: fetchImpl, requests };
}
