import { test } from "node:test";
import assert from "node:assert/strict";

import { hasStoredSession } from "../storedSession";

const storage = (keys: string[]) => ({ length: keys.length, key: (i: number) => keys[i] ?? null });

test("the signed-in hint is true only when this browser holds a Supabase session", () => {
  assert.equal(hasStoredSession(storage(["theme", "sb-yapaaszcgxfuadylllvn-auth-token"])), true);
  // Other Supabase keys (the PKCE verifier kept while a sign-in is in progress) aren't a session.
  assert.equal(hasStoredSession(storage(["sb-yapaaszcgxfuadylllvn-auth-token-code-verifier", "stocksphere.ai.portfolioConsent"])), false);
  assert.equal(hasStoredSession(storage([])), false);
  // The server, and a browser that blocks storage, are signed out until Supabase says otherwise.
  assert.equal(hasStoredSession(null), false);
  const blocked = { get length(): number { throw new Error("SecurityError"); }, key: () => null };
  assert.equal(hasStoredSession(blocked), false);
});
