import { test } from "node:test";
import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AI_LIMIT_PER_DAY, AI_LIMIT_PER_MINUTE, bearerToken, takeMemorySlot, takeSharedSlot } from "../access";

const req = (auth?: string) => new Request("http://x", { headers: auth ? { authorization: auth } : {} });

test("bearerToken reads only a Bearer header", () => {
  assert.equal(bearerToken(req("Bearer abc")), "abc");
  assert.equal(bearerToken(req("bearer  abc ")), "abc");
  assert.equal(bearerToken(req("Basic abc")), null);
  assert.equal(bearerToken(req("Bearer ")), null);
  assert.equal(bearerToken(req()), null);
});

test("memory fallback enforces the per-minute limit per user", () => {
  const store = new Map<string, number[]>();
  const t = 1_000_000;
  for (let i = 0; i < AI_LIMIT_PER_MINUTE; i++) assert.equal(takeMemorySlot("a", t + i, store).ok, true);
  const blocked = takeMemorySlot("a", t + 10, store);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.window, "minute");
    assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 60);
  }
  // Another user is unaffected, and the first is allowed again a minute later.
  assert.equal(takeMemorySlot("b", t + 10, store).ok, true);
  assert.equal(takeMemorySlot("a", t + 60_001, store).ok, true);
});

test("memory fallback enforces the daily limit", () => {
  const store = new Map<string, number[]>();
  let t = 0;
  for (let i = 0; i < AI_LIMIT_PER_DAY; i++) {
    assert.equal(takeMemorySlot("a", t, store).ok, true);
    t += 61_000;
  }
  const blocked = takeMemorySlot("a", t, store);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.window, "day");
});

function fakeAdmin(result: { data?: unknown; error?: { code?: string; message?: string } | null }) {
  const calls: unknown[] = [];
  const admin = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ name, args });
      return { data: result.data ?? null, error: result.error ?? null };
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}

test("shared limiter passes the limits to ai_take_slot and reads its answer", async () => {
  const { admin, calls } = fakeAdmin({ data: [{ allowed: true, reason: null, retry_after_seconds: 0 }] });
  assert.deepEqual(await takeSharedSlot("u1", admin), { ok: true, shared: true });
  assert.deepEqual(calls, [
    { name: "ai_take_slot", args: { p_user: "u1", p_per_minute: AI_LIMIT_PER_MINUTE, p_per_day: AI_LIMIT_PER_DAY } },
  ]);

  const denied = fakeAdmin({ data: [{ allowed: false, reason: "day", retry_after_seconds: 1234 }] });
  assert.deepEqual(await takeSharedSlot("u1", denied.admin), { ok: false, window: "day", retryAfterSeconds: 1234, shared: true });
});

test("shared limiter falls back to memory when the migration isn't applied or there's no admin client", async () => {
  const missing = fakeAdmin({ error: { code: "PGRST202", message: "Could not find the function public.ai_take_slot" } });
  const result = await takeSharedSlot("fallback-user", missing.admin, () => 5);
  assert.deepEqual(result, { ok: true, shared: false });
  assert.deepEqual(await takeSharedSlot("fallback-user-2", null, () => 5), { ok: true, shared: false });
});
