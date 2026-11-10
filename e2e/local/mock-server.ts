/**
 * Local E2E stand-ins (docs/AI_ASSIST_SPEC.md §9), one HTTP server:
 *   - an auth issuer: /authorize → straight back to the CMS callback, /token, /.well-known/jwks.json
 *     (who signs in is set by the test with POST /__as {roles}); never a real account;
 *   - Workers AI: POST /ai/run/<model> (test/support/workers-ai-mock.ts; the CMS calls it through
 *     AI_MOCK_URL when ENVIRONMENT=local); a title containing "E2E-DECLINE" gets a refusal;
 *   - a third-party AI service for the generic HTTP provider (docs/AI_PROVIDERS.md): POST /v1/chat with
 *     `Authorization: Bearer <E2E_AI_KEY>`, chat-style JSON in and out, same canned replies;
 *   - the videos admin's /public/site-theme (404 → the CMS default theme).
 *
 *   node --experimental-strip-types e2e/local/mock-server.ts   (port MOCK_PORT, default 8798)
 */
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { defaultReply, parseInputs, replyResponse } from "../../test/support/workers-ai-mock.ts";

const PORT = Number(process.env.MOCK_PORT ?? 8798);
const ISSUER = `http://127.0.0.1:${PORT}`;
const CLIENT_ID = process.env.MOCK_CLIENT_ID ?? "e2e-local";
/** The fake key e2e/local/cms.sh binds as AI_KEY_E2E (not a credential). */
export const E2E_AI_KEY = "e2e-local-fake-key";

const { publicKey, privateKey } = await generateKeyPair("ES256");
const jwk = { ...(await exportJWK(publicKey)), kid: "e2e", alg: "ES256", use: "sig" };

let current = { id: "e2e-admin", email: "e2e-admin@example.test", roles: ["Admin"] };
const codes = new Map<string, typeof current>();

async function toResponse(res: import("node:http").ServerResponse, r: Response) {
   res.writeHead(r.status, Object.fromEntries(r.headers));
   res.end(Buffer.from(await r.arrayBuffer()));
}

createServer(async (req, res) => {
   const url = new URL(req.url ?? "/", ISSUER);
   const chunks: Buffer[] = [];
   for await (const c of req) chunks.push(c as Buffer);
   const body = Buffer.concat(chunks).toString("utf8");
   try {
      if (url.pathname === "/__as" && req.method === "POST") {
         current = JSON.parse(body);
         return toResponse(res, Response.json({ ok: true }));
      }
      if (url.pathname === "/authorize") {
         const code = crypto.randomUUID();
         codes.set(code, current);
         const back = new URL(url.searchParams.get("redirect_uri")!);
         back.searchParams.set("code", code);
         back.searchParams.set("state", url.searchParams.get("state") ?? "");
         return toResponse(res, new Response(null, { status: 302, headers: { location: back.toString() } }));
      }
      if (url.pathname === "/token" && req.method === "POST") {
         const who = codes.get(new URLSearchParams(body).get("code") ?? "");
         if (!who) return toResponse(res, Response.json({ error: "invalid_grant" }, { status: 400 }));
         const token = await new SignJWT({ mode: "access", type: "user", properties: who })
            .setProtectedHeader({ alg: "ES256", kid: "e2e" })
            .setSubject(`user:${who.id}`)
            .setIssuer(ISSUER)
            .setAudience(CLIENT_ID)
            .setExpirationTime("10m")
            .sign(privateKey);
         return toResponse(res, Response.json({ access_token: token, refresh_token: "r", expires_in: 600 }));
      }
      if (url.pathname === "/.well-known/jwks.json") return toResponse(res, Response.json({ keys: [jwk] }));
      if (url.pathname.startsWith("/ai/run/") && req.method === "POST") {
         const parsed = parseInputs(decodeURIComponent(url.pathname.slice("/ai/run/".length)), JSON.parse(body));
         if (parsed.user.includes("E2E-DECLINE")) return toResponse(res, replyResponse({ kind: "json", data: {}, refusal: "I can't help with that." }));
         return toResponse(res, replyResponse(defaultReply(parsed)));
      }
      if (url.pathname === "/v1/chat" && req.method === "POST") {
         if (req.headers.authorization !== `Bearer ${E2E_AI_KEY}`) return toResponse(res, Response.json({ error: { message: "bad key" } }, { status: 401 }));
         const b = JSON.parse(body) as { model: string; messages: { role: string; content: string }[] };
         const reply = defaultReply({ model: b.model, system: b.messages.find((m) => m.role === "system")?.content ?? "", user: b.messages.find((m) => m.role === "user")?.content ?? "", inputs: b });
         if (reply.kind === "error") return toResponse(res, Response.json({ error: { message: reply.message } }, { status: reply.status ?? 500 }));
         const content = reply.kind === "json" ? JSON.stringify(reply.data) : reply.text;
         return toResponse(res, Response.json({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 8 } }));
      }
      if (url.pathname === "/healthz") return toResponse(res, new Response("ok"));
      return toResponse(res, new Response("not found", { status: 404 }));
   } catch (error) {
      return toResponse(res, Response.json({ error: String(error) }, { status: 500 }));
   }
}).listen(PORT, "127.0.0.1", () => process.stdout.write(`mock auth + Workers AI on ${ISSUER}\n`));
