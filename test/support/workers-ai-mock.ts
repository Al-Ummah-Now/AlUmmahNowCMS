/**
 * A fake Workers AI for tests: a binding (`env.AI`) for the worker tests and the same replies over
 * HTTP for the local E2E mock server (`POST /ai/run/<model>`, src/lib/ai/config.ts mockBinding).
 * Answers chat requests in the OpenAI-compatible shape Workers AI returns, deciding the reply from the
 * system prompt: translation → the source fields marked as translated (URLs and ::video lines kept),
 * SEO → three fields, check → one item per section. No network, no account.
 */
import { MODEL_ID } from "../../src/lib/ai/prompts.ts";

export interface MockRequest {
   model: string;
   system: string;
   user: string;
   inputs: Record<string, unknown>;
}

export type MockReply =
   | { kind: "json"; data: unknown; finish?: string; refusal?: string; input?: number; output?: number; neurons?: number | null }
   | { kind: "text"; text: string; finish?: string }
   /** A Workers AI error (developers.cloudflare.com/workers-ai/platform/errors): 3040 out of capacity, 5007 no such model, … */
   | { kind: "error"; code: number; status?: number; message?: string };

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
      if (req.user.includes("<title>")) return { kind: "json", data: { title: mark(tag(req.user, "title")), summary: mark(tag(req.user, "summary")), body: translated } };
      return { kind: "json", data: { body: translated } };
   }
   if (s.includes("search and sharing copy")) {
      const title = tag(req.user, "title");
      return {
         kind: "json",
         data: { seo_title: `${title} — guide`.slice(0, 60), seo_description: `What ${title} covers, in two plain sentences.`, social_summary: `Read: ${title}` },
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
      };
   }
   return { kind: "error", code: 3003, status: 400, message: "unknown prompt" };
}

export function parseInputs(model: string, inputs: Record<string, unknown>): MockRequest {
   const msgs = (inputs.messages as { role: string; content: unknown }[]) ?? [];
   const str = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v ?? ""));
   return { model, system: str(msgs.find((m) => m.role === "system")?.content), user: str(msgs.find((m) => m.role === "user")?.content), inputs };
}

/** Neurons for a call on the chosen model (catalogue rates, src/lib/ai/pricing.ts). */
export const mockNeurons = (input: number, output: number) => Math.round(((input * 27_273 + output * 109_091) / 1e6) * 1000) / 1000;

/** The binding's output for a reply, or throws the binding's error. */
export function replyOutput(reply: MockReply): unknown {
   if (reply.kind === "error") throw new Error(`AiError: ${reply.message ?? "mock error"} (${reply.code})`);
   const content = reply.kind === "json" ? JSON.stringify(reply.data) : reply.text;
   const input = reply.kind === "json" ? (reply.input ?? 1200) : 1200;
   const output = reply.kind === "json" ? (reply.output ?? 300) : 300;
   const neurons = reply.kind === "json" && reply.neurons !== undefined ? reply.neurons : mockNeurons(input, output);
   const usage: Record<string, unknown> = { prompt_tokens: input, completion_tokens: output, total_tokens: input + output, prompt_tokens_details: { cached_tokens: 0 } };
   if (neurons !== null) usage.neurons = neurons;
   return {
      id: "chatcmpl-mock",
      object: "chat.completion",
      model: MODEL_ID,
      choices: [{ index: 0, message: { role: "assistant", content, refusal: reply.kind === "json" ? (reply.refusal ?? null) : null }, finish_reason: reply.finish ?? "stop" }],
      usage,
   };
}

/** The REST shape (`{ result }` or `{ errors }`) for the local mock server. */
export function replyResponse(reply: MockReply): Response {
   if (reply.kind === "error") return Response.json({ success: false, result: null, errors: [{ code: reply.code, message: reply.message ?? "mock error" }] }, { status: reply.status ?? 500 });
   return Response.json({ success: true, result: replyOutput(reply), errors: [] });
}

/** A fake `env.AI`. `decide` may override the default reply per request; every request is recorded. */
export function mockWorkersAi(decide: (req: MockRequest, n: number) => MockReply | undefined = () => undefined) {
   const requests: MockRequest[] = [];
   const binding = {
      async run(model: string, inputs: Record<string, unknown>) {
         const req = parseInputs(model, inputs);
         requests.push(req);
         return replyOutput(decide(req, requests.length) ?? defaultReply(req));
      },
   };
   return { binding, requests };
}
