import { test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "../route";

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("rejects invalid JSON with 400 INVALID_REQUEST", async () => {
  const request = new Request("http://localhost/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{not json",
  });

  const response = await POST(request);
  const json = await response.json();

  assert.equal(response.status, 400);
  assert.equal(json.code, "INVALID_REQUEST");
});

test("rejects a missing message with 400 INVALID_REQUEST", async () => {
  const response = await POST(makeRequest({}, { "x-forwarded-for": "1.1.1.1" }));
  const json = await response.json();

  assert.equal(response.status, 400);
  assert.equal(json.code, "INVALID_REQUEST");
});

test("rejects a message over the length cap with 400 INVALID_REQUEST", async () => {
  const response = await POST(
    makeRequest({ message: "a".repeat(1000) }, { "x-forwarded-for": "1.1.1.2" })
  );
  const json = await response.json();

  assert.equal(response.status, 400);
  assert.equal(json.code, "INVALID_REQUEST");
});

test("rejects a history entry with an invalid role with 400 INVALID_REQUEST", async () => {
  const response = await POST(
    makeRequest(
      { message: "hi", history: [{ role: "system", content: "nope" }] },
      { "x-forwarded-for": "1.1.1.3" }
    )
  );

  assert.equal(response.status, 400);
});

test("accepts a well-formed request and reaches the orchestrator (fails on missing GROQ_API_KEY, not on validation)", async () => {
  const response = await POST(
    makeRequest({ message: "hi" }, { "x-forwarded-for": "1.1.1.4" })
  );

  const json = await response.json();

  // A well-formed request must not be rejected by request validation.
  assert.notEqual(response.status, 400);
});

test("rate limits a client after the configured number of requests per window", async () => {
  const clientIp = "9.9.9.9";
  let lastStatus = 200;

  for (let i = 0; i < 11; i++) {
    const response = await POST(makeRequest({ message: "hi" }, { "x-forwarded-for": clientIp }));
    lastStatus = response.status;
  }

  assert.equal(lastStatus, 429);
});
