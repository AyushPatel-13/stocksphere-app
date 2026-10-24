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

// --- research workflows -------------------------------------------------

import type { runDefaultWorkflow } from "@/lib/agent/workflows";

function fakeWorkflow(answerFor: (userId: string) => string | null) {
  const calls: { type: string; userId: string }[] = [];
  const impl = (async (workflow, _question, ctx) => {
    calls.push({ type: workflow.type, userId: ctx.userId });
    const answer = answerFor(ctx.userId);
    return answer === null ? null : { answer, toolCalls: [], sources: [], warnings: [], conversationId: "w" };
  }) as typeof runDefaultWorkflow;
  return { impl, calls };
}

test("a research question runs as a workflow for the verified account", async () => {
  const { access } = fakeAccess();
  const wf = fakeWorkflow(() => "research note");
  const response = await POST(makeRequest({ message: "Research TCS for the route test" }), undefined, access, fakeRun, wf.impl);
  assert.equal((await response.json()).answer, "research note");
  assert.deepEqual(wf.calls, [{ type: "research", userId: "user-1" }]);
});

test("a workflow that can't identify the company falls back to the tool loop", async () => {
  const { access } = fakeAccess();
  const wf = fakeWorkflow(() => null);
  const response = await POST(makeRequest({ message: "Research zzqx route fallback" }), undefined, access, fakeRun, wf.impl);
  assert.match((await response.json()).answer, /^answer/);
});

test("portfolio answers are never served from or stored in the shared cache", async () => {
  const wf = fakeWorkflow((userId) => `portfolio of ${userId}`);
  const tokens: Record<string, string> = { "tok-a": "user-a", "tok-b": "user-b" };
  const access: AgentAccess = { verifyToken: async (t) => tokens[t] ?? null, takeSlot: async () => ({ ok: true, shared: true }) };

  const a = await POST(makeRequest({ message: "Analyze my portfolio" }, "tok-a"), undefined, access, fakeRun, wf.impl);
  const b = await POST(makeRequest({ message: "Analyze my portfolio" }, "tok-b"), undefined, access, fakeRun, wf.impl);
  assert.equal((await a.json()).answer, "portfolio of user-a");
  assert.equal((await b.json()).answer, "portfolio of user-b");
  assert.deepEqual(wf.calls.map((c) => c.userId), ["user-a", "user-b"]);
});

test("an explicit workflow is validated, and the body can't choose whose data is read", async () => {
  const { access } = fakeAccess();
  const wf = fakeWorkflow((userId) => `for ${userId}`);
  const bad = await POST(makeRequest({ message: "x", workflow: { type: "compare", queries: ["TCS"] } }), undefined, access, fakeRun, wf.impl);
  assert.equal(bad.status, 400);
  const unknown = await POST(makeRequest({ message: "x", workflow: { type: "run_sql", query: "drop table" } }), undefined, access, fakeRun, wf.impl);
  assert.equal(unknown.status, 400);
  const sneaky = await POST(makeRequest({ message: "my portfolio please", workflow: { type: "portfolio" }, userId: "victim" }), undefined, access, fakeRun, wf.impl);
  assert.equal((await sneaky.json()).answer, "for user-1");
});
