import { test } from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_ENDPOINT,
  AgentRequestError,
  friendlyMessage,
  isAgentResponse,
  readErrorBody,
  sendAgentMessage,
} from "@/lib/agent/client/request";

const ANSWER = {
  answer: "TCS last traded at ₹2,054.00.",
  toolCalls: [{ tool: "get_price", input: { symbol: "TCS.NS" }, ok: true, source: "Upstox" }],
  sources: ["Upstox"],
  warnings: [],
  conversationId: "conv-123",
};

/** A fetch stand-in that records what it was called with. */
function stubFetch(response: Response | (() => Promise<Response>)) {
  const calls: { url: string; init: RequestInit }[] = [];

  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });

    if (typeof response === "function") return response();

    // Responses are single-use; hand out a fresh one per call.
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  }) as typeof fetch;

  return { calls, impl };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

test("it posts the request to the existing agent endpoint as JSON", async () => {
  const { calls, impl } = stubFetch(json(ANSWER));

  await sendAgentMessage({ message: "hi" }, impl);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, AGENT_ENDPOINT);
  assert.equal(calls[0].init.method, "POST");
  assert.equal(
    (calls[0].init.headers as Record<string, string>)["Content-Type"],
    "application/json"
  );
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { message: "hi" });
});

test("it returns the AgentResponse unmodified", async () => {
  const { impl } = stubFetch(json(ANSWER));

  const result = await sendAgentMessage({ message: "hi" }, impl);

  assert.deepEqual(result, ANSWER);
  assert.equal(result.conversationId, "conv-123");
  assert.equal(result.toolCalls[0].tool, "get_price");
});

test("message, conversationId and history all cross the wire", async () => {
  const { calls, impl } = stubFetch(json(ANSWER));

  await sendAgentMessage(
    {
      message: "and its news?",
      conversationId: "conv-123",
      history: [{ role: "user", content: "hi" }],
    },
    impl
  );

  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    message: "and its news?",
    conversationId: "conv-123",
    history: [{ role: "user", content: "hi" }],
  });
});

// ---------------------------------------------------------------------------
// Failures that reach the server
// ---------------------------------------------------------------------------

test("a server error code becomes a friendly, non-technical message", async () => {
  const { impl } = stubFetch(
    json({ error: "upstream provider exploded: key sk-abc123", code: "LLM_ERROR" }, 502)
  );

  const error = await sendAgentMessage({ message: "hi" }, impl).catch((e) => e);

  assert.ok(error instanceof AgentRequestError);
  assert.equal(error.code, "LLM_ERROR");
  assert.equal(error.message, friendlyMessage("LLM_ERROR"));
  // The provider's own words stay out of what the user reads.
  assert.doesNotMatch(error.message, /sk-abc123/);
  assert.doesNotMatch(error.message, /upstream provider exploded/);
  // ...but are kept for developers.
  assert.match(String(error.cause), /sk-abc123/);
});

test("a rate-limited response is reported as rate limiting", async () => {
  const { impl } = stubFetch(
    json({ error: "Too many requests.", code: "RATE_LIMITED" }, 429)
  );

  const error = await sendAgentMessage({ message: "hi" }, impl).catch((e) => e);

  assert.equal(error.code, "RATE_LIMITED");
  assert.match(error.message, /moment/i);
});

test("a 429 with no readable body still maps to RATE_LIMITED", async () => {
  const { impl } = stubFetch(new Response("gateway timeout", { status: 429 }));

  const error = await sendAgentMessage({ message: "hi" }, impl).catch((e) => e);

  assert.equal(error.code, "RATE_LIMITED");
});

test("an unreadable error body falls back to INTERNAL_ERROR", async () => {
  const { impl } = stubFetch(new Response("<html>502</html>", { status: 502 }));

  const error = await sendAgentMessage({ message: "hi" }, impl).catch((e) => e);

  assert.equal(error.code, "INTERNAL_ERROR");
  assert.equal(error.message, friendlyMessage("INTERNAL_ERROR"));
});

test("an unknown error code is not trusted as a code", async () => {
  const { impl } = stubFetch(json({ error: "?", code: "SOMETHING_NEW" }, 500));

  const error = await sendAgentMessage({ message: "hi" }, impl).catch((e) => e);

  assert.equal(error.code, "INTERNAL_ERROR");
});

test("a validation failure is reported as an invalid request", async () => {
  const { impl } = stubFetch(
    json({ error: "message is required", code: "INVALID_REQUEST" }, 400)
  );

  const error = await sendAgentMessage({ message: "" }, impl).catch((e) => e);

  assert.equal(error.code, "INVALID_REQUEST");
});

// ---------------------------------------------------------------------------
// Failures that never reach the server
// ---------------------------------------------------------------------------

test("a thrown network error becomes NETWORK_ERROR", async () => {
  const { impl } = stubFetch(() => Promise.reject(new TypeError("fetch failed")));

  const error = await sendAgentMessage({ message: "hi" }, impl).catch((e) => e);

  assert.equal(error.code, "NETWORK_ERROR");
  assert.match(error.message, /connection/i);
});

test("a hung request is abandoned and reported as a timeout", async () => {
  const impl = ((_url: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const abort = new Error("aborted");
        abort.name = "AbortError";
        reject(abort);
      });
    })) as typeof fetch;

  const error = await sendAgentMessage({ message: "hi" }, impl, 5).catch((e) => e);

  assert.equal(error.code, "TIMEOUT");
  assert.equal(error.message, friendlyMessage("TIMEOUT"));
});

test("a success response that is not JSON is malformed, not a crash", async () => {
  const { impl } = stubFetch(new Response("not json", { status: 200 }));

  const error = await sendAgentMessage({ message: "hi" }, impl).catch((e) => e);

  assert.equal(error.code, "MALFORMED_RESPONSE");
});

test("a response carrying no answer is malformed", async () => {
  for (const body of [{}, { answer: "" }, { answer: "   " }, { answer: 42 }]) {
    const { impl } = stubFetch(json(body));

    const error = await sendAgentMessage({ message: "hi" }, impl).catch((e) => e);

    assert.equal(error.code, "MALFORMED_RESPONSE", JSON.stringify(body));
  }
});

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

test("isAgentResponse accepts only a usable answer", () => {
  assert.equal(isAgentResponse(ANSWER), true);
  assert.equal(isAgentResponse({ answer: "ok" }), true);

  assert.equal(isAgentResponse(null), false);
  assert.equal(isAgentResponse("answer"), false);
  assert.equal(isAgentResponse({ answer: "" }), false);
  assert.equal(isAgentResponse({ answer: null }), false);
});

test("readErrorBody keeps the code and the technical detail apart", () => {
  assert.deepEqual(readErrorBody({ error: "boom", code: "LLM_ERROR" }), {
    code: "LLM_ERROR",
    technical: "boom",
  });

  assert.deepEqual(readErrorBody({ code: "NOPE" }), {
    code: null,
    technical: null,
  });

  assert.deepEqual(readErrorBody(null), { code: null, technical: null });
  assert.deepEqual(readErrorBody("plain text"), { code: null, technical: null });
});
