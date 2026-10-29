import { test } from "node:test";
import assert from "node:assert/strict";

import { CONFIG_FINGERPRINT, computeReputation, isReputationEnabled, type ReputationInputs } from "../compute";
import { thesisCounts } from "../service";
import { GET } from "../../../app/api/reputation/route";

const EMPTY: ReputationInputs = {
  predictions: { resolved: 0, wins: 0 },
  thesisUpdates: { beforeTarget: 0, afterTarget: 0 },
  publishedTheses: { total: 0, withRisksAndInvalidation: 0 },
  posts: { standing: 0, removed: 0 },
};

const byKey = (input: ReputationInputs) => Object.fromEntries(computeReputation(input).dimensions.map((d) => [d.key, d]));

test("a new member shows 'not enough data', never a low score", () => {
  const dims = byKey(EMPTY);
  for (const key of ["predictions", "transparency", "riskAwareness", "contribution"]) assert.equal(dims[key].status, "not_enough_data", key);
  assert.equal(dims.thesisOutcomes.status, "unavailable");
  assert.equal(dims.helpfulness.status, "unavailable");
});

test("each dimension scores only past its own minimum sample, from the raw counts", () => {
  const dims = byKey({
    predictions: { resolved: 20, wins: 14 },
    thesisUpdates: { beforeTarget: 4, afterTarget: 1 },
    publishedTheses: { total: 3, withRisksAndInvalidation: 2 },
    posts: { standing: 9, removed: 1 },
  });
  assert.deepEqual([dims.predictions.status, dims.predictions.status === "scored" && dims.predictions.value], ["scored", 63.3]); // (14+5)/(20+10)
  assert.equal(dims.transparency.status === "scored" && dims.transparency.value, 80);
  assert.equal(dims.riskAwareness.status === "scored" && dims.riskAwareness.value, 66.7);
  assert.equal(dims.contribution.status === "scored" && dims.contribution.value, 90);
  // 19 calls is one short: no score.
  assert.equal(byKey({ ...EMPTY, predictions: { resolved: 19, wins: 19 } }).predictions.status, "not_enough_data");
});

test("recomputing gives the same result, stamped with version and config fingerprint", () => {
  const input = { ...EMPTY, posts: { standing: 30, removed: 2 } };
  assert.deepEqual(computeReputation(input), computeReputation(structuredClone(input)));
  assert.equal(computeReputation(input).version, "rep-1");
  assert.match(CONFIG_FINGERPRINT, /^[0-9a-f]{12}$/);
});

test("likes, votes and followers aren't inputs at all", () => {
  // The input type has no such fields; extra ones are ignored.
  const withNoise = { ...EMPTY, posts: { standing: 12, removed: 0 }, likes: 10_000, followers: 50_000 } as ReputationInputs;
  assert.deepEqual(computeReputation(withNoise), computeReputation({ ...EMPTY, posts: { standing: 12, removed: 0 } }));
});

test("thesis counts: drafts ignored; updates judged against the target date in force; risks from the published version", () => {
  const v = (version: number, created: string, target: string, risks = "", invalidation = "") => ({ version, created_at: created, target_date: target, risks, invalidation });
  const counts = thesisCounts([
    { status: "draft", published_version: null, published_at: null, versions: [v(1, "2026-01-01T00:00:00Z", "2026-06-01", "r", "i")] },
    {
      status: "published",
      published_version: 2,
      published_at: "2026-01-05T00:00:00Z",
      versions: [v(1, "2026-01-01T00:00:00Z", "2026-06-01"), v(2, "2026-01-05T00:00:00Z", "2026-06-01", "rates", "two bad quarters"), v(3, "2026-03-01T00:00:00Z", "2026-06-01"), v(4, "2026-07-01T00:00:00Z", "2026-06-01")],
    },
    { status: "closed", published_version: 1, published_at: "2026-02-01T00:00:00Z", versions: [v(1, "2026-02-01T00:00:00Z", "2026-09-01", "r", "")] },
  ]);
  assert.deepEqual(counts, { thesisUpdates: { beforeTarget: 1, afterTarget: 1 }, publishedTheses: { total: 2, withRisksAndInvalidation: 1 } });
});

test("GET /api/reputation is off unless the flag is on, and validates the handle", async () => {
  const store = { memberId: async (u: string) => (u === "asha" ? "id-1" : null), inputs: async () => EMPTY };
  const off = await GET(new Request("http://x/api/reputation?user=asha"), undefined, store, false);
  assert.equal(off.status, 404);
  assert.equal((await off.json()).code, "REPUTATION_OFF");
  assert.equal((await GET(new Request("http://x/api/reputation?user=bad%20handle!"), undefined, store, true)).status, 400);
  assert.equal((await GET(new Request("http://x/api/reputation?user=nobody"), undefined, store, true)).status, 404);
  const on = await (await GET(new Request("http://x/api/reputation?user=asha"), undefined, store, true)).json();
  assert.equal(on.success, true);
  assert.equal(on.dimensions.length, 6);
  assert.equal(isReputationEnabled({}), false);
  assert.equal(isReputationEnabled({ REPUTATION_ENABLED: "true" }), true);
});
