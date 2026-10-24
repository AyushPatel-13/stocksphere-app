import { test } from "node:test";
import assert from "node:assert/strict";

import type { AgentAccess, SlotResult } from "@/lib/agent/access";
import type { runAgent } from "@/lib/agent/orchestrator";
import { POST } from "../route";

const TOKEN = "good-token";

function makeRequest(body: unknown, token: string | null = TOKEN): Request {
  return new Request("http://localhost/api/agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Accepts TOKEN as user-1 and allows every request unless told otherwise. */
function fakeAccess(slot: () => SlotResult = () => ({ ok: true, shared: true })) {
  const calls: string[] = [];
  const access: AgentAccess = {
    async verifyToken(token) {
      return token === TOKEN ? "user-1" : null;
    },
    async takeSlot(userId) {
      calls.push(userId);
      return slot();
    },
  };
  return { access, calls };
}

let counter = 0;
const fakeRun = (async (input) => ({
  answer: `answer ${++counter}`,
  conversationId: input.conversationId ?? "c1",
  toolCalls: [],
  sources: [],
  warnings: [],
})) as typeof runAgent;

test("a request with no token is refused with 401 SIGNED_OUT", async () => {
  const { access, calls } = fakeAccess();
  const response = await POST(makeRequest({ message: "hi" }, null), undefined, access, fakeRun);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, "SIGNED_OUT");
  assert.equal(calls.length, 0);
});

test("an invalid token is refused with 401 SIGNED_OUT", async () => {
  const { access } = fakeAccess();
  const response = await POST(makeRequest({ message: "hi" }, "forged"), undefined, access, fakeRun);
  assert.equal(response.status, 401);
});

test("invalid JSON is 400 INVALID_REQUEST and uses no quota", async () => {
  const { access, calls } = fakeAccess();
  const response = await POST(makeRequest("{not json"), undefined, access, fakeRun);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INVALID_REQUEST");
  assert.equal(calls.length, 0);
});

test("a missing or over-long message, or a bad history role, is 400", async () => {
  const { access } = fakeAccess();
  for (const body of [{}, { message: "a".repeat(1000) }, { message: "hi", history: [{ role: "system", content: "x" }] }]) {
    const response = await POST(makeRequest(body), undefined, access, fakeRun);
    assert.equal(response.status, 400);
  }
});

test("a signed-in member gets an answer and one slot is taken for their account", async () => {
  const { access, calls } = fakeAccess();
  const response = await POST(makeRequest({ message: "route test unique question 1" }), undefined, access, fakeRun);
  assert.equal(response.status, 200);
  assert.match((await response.json()).answer, /^answer/);
  assert.deepEqual(calls, ["user-1"]);
});

test("over the limit is 429 RATE_LIMITED with Retry-After, and the agent isn't run", async () => {
  const { access } = fakeAccess(() => ({ ok: false, window: "day", retryAfterSeconds: 3600, shared: true }));
  let ran = false;
  const run = (async (input: Parameters<typeof runAgent>[0]) => {
    ran = true;
    return fakeRun(input);
  }) as typeof runAgent;
  const response = await POST(makeRequest({ message: "route test unique question 2" }), undefined, access, run);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("Retry-After"), "3600");
  const json = await response.json();
  assert.equal(json.code, "RATE_LIMITED");
  assert.match(json.error, /today/);
  assert.equal(ran, false);
});

test("a cached repeat of a stand-alone question doesn't use quota", async () => {
  const { access, calls } = fakeAccess();
  const message = "route test cached question";
  const first = await POST(makeRequest({ message }), undefined, access, fakeRun);
  const second = await POST(makeRequest({ message }), undefined, access, fakeRun);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).answer, (await first.json()).answer);
  assert.equal(calls.length, 1);
});
