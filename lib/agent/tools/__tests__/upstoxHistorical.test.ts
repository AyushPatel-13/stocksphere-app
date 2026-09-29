import { test } from "node:test";
import assert from "node:assert/strict";

// lib/apis/upstoxHistorical.ts captures UPSTOX_ACCESS_TOKEN when the module is
// first evaluated, following the convention of lib/apis/upstox.ts and
// upstoxNews.ts. The variable therefore has to be set before that import
// happens, which is why this file imports the client dynamically inside a test
// body and nothing here imports it statically.
//
// Nothing else in the suite depends on this: `tsx --test` runs each test file in
// its own process, so the token set here cannot leak into the other test files
// (which rely on it being absent — see the missing-token case in
// historicalTool.test.ts).
process.env.UPSTOX_ACCESS_TOKEN = "test-token-not-a-real-secret";

async function loadClient() {
  return import("@/lib/apis/upstoxHistorical");
}

/** Replaces global fetch for one test, and records the URLs it was asked for. */
async function withFetch<T>(
  responder: (url: string) => {
    ok: boolean;
    status: number;
    body?: unknown;
    text?: string;
  },
  run: (calls: string[]) => Promise<T>
): Promise<T> {
  const original = globalThis.fetch;
  const calls: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    const { ok, status, body, text } = responder(url);

    return {
      ok,
      status,
      json: async () => body,
      text: async () => text ?? JSON.stringify(body ?? ""),
    } as unknown as Response;
  }) as typeof fetch;

  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

/** The live envelope shape: { status: "success", data: { candles: [...] } }. */
function successEnvelope(candles: unknown[]) {
  return { ok: true, status: 200, body: { status: "success", data: { candles } } };
}

const TCS_KEY = "NSE_EQ|INE467B01029";

test("the instrument key is URL-encoded and the date order is to/from", async () => {
  const { getUpstoxHistoricalCandles } = await loadClient();

  await withFetch(
    () => successEnvelope([]),
    async (calls) => {
      await getUpstoxHistoricalCandles(TCS_KEY, "2026-09-01", "2026-09-25");

      assert.equal(calls.length, 1);
      // The "|" in the instrument key is percent-encoded: a raw "|" is legal in
      // a path but is not what Upstox documents, and encoding removes any
      // chance of it being read as a delimiter.
      assert.equal(
        calls[0],
        "https://api.upstox.com/v3/historical-candle/NSE_EQ%7CINE467B01029/days/1/2026-09-25/2026-09-01"
      );
      assert.equal(calls[0].includes("|"), false);
      // v3, not v2: the v2 path rejects "days/1" with HTTP 400.
      assert.equal(calls[0].includes("/v3/historical-candle/"), true);
      assert.equal(calls[0].includes("/days/1/"), true);
    }
  );
});

test("the newest bound is sent first, as a bare date with no time part", async () => {
  const { getUpstoxHistoricalCandles } = await loadClient();

  await withFetch(
    () => successEnvelope([]),
    async (calls) => {
      await getUpstoxHistoricalCandles(TCS_KEY, "2025-09-28", "2026-09-28");

      // .../days/1/{to_date}/{from_date}
      assert.match(calls[0], /\/days\/1\/2026-09-28\/2025-09-28$/);
    }
  );
});

test("the request carries the bearer token and is never cached", async () => {
  const { getUpstoxHistoricalCandles } = await loadClient();
  const original = globalThis.fetch;
  let seen: RequestInit | undefined;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seen = init;
    return {
      ok: true,
      status: 200,
      json: async () => successEnvelope([]).body,
      text: async () => "",
    } as unknown as Response;
  }) as typeof fetch;

  try {
    await getUpstoxHistoricalCandles(TCS_KEY, "2026-09-01", "2026-09-25");

    const headers = seen?.headers as Record<string, string>;

    assert.equal(headers.Authorization, "Bearer test-token-not-a-real-secret");
    assert.equal(seen?.cache, "no-store");
  } finally {
    globalThis.fetch = original;
  }
});

test("a live candle row is copied into six slots, dropping open interest", async () => {
  const { getUpstoxHistoricalCandles } = await loadClient();

  await withFetch(
    () =>
      successEnvelope([
        ["2026-09-25T00:00:00+05:30", 2054, 2090.2, 2038.1, 2082, 3342195, 0],
      ]),
    async () => {
      const rows = await getUpstoxHistoricalCandles(TCS_KEY, "2026-09-01", "2026-09-25");

      assert.deepEqual(rows, [
        ["2026-09-25T00:00:00+05:30", 2054, 2090.2, 2038.1, 2082, 3342195],
      ]);
      // Exactly six slots: the seventh (open interest) is gone at this boundary.
      assert.equal(rows?.[0].length, 6);
    }
  );
});

test("upstream order is preserved, so the adapter decides the ordering", async () => {
  const { getUpstoxHistoricalCandles } = await loadClient();

  await withFetch(
    () =>
      successEnvelope([
        ["2026-09-25T00:00:00+05:30", 2054, 2090.2, 2038.1, 2082, 3342195, 0],
        ["2026-09-24T00:00:00+05:30", 2076, 2096.9, 2067.1, 2087, 1760662, 0],
      ]),
    async () => {
      const rows = await getUpstoxHistoricalCandles(TCS_KEY, "2026-09-01", "2026-09-25");

      assert.equal(rows?.[0][0], "2026-09-25T00:00:00+05:30");
      assert.equal(rows?.[1][0], "2026-09-24T00:00:00+05:30");
    }
  );
});

test("an empty candle list is an empty array, not null", async () => {
  const { getUpstoxHistoricalCandles } = await loadClient();

  await withFetch(() => successEnvelope([]), async () => {
    const rows = await getUpstoxHistoricalCandles(TCS_KEY, "2026-09-01", "2026-09-25");

    // Upstox answered; there is simply nothing in that window. A real answer.
    assert.notEqual(rows, null);
    assert.deepEqual(rows, []);
  });
});

test("a refused request is null, whatever the status", async () => {
  const { getUpstoxHistoricalCandles } = await loadClient();

  for (const status of [400, 401, 403, 404, 429, 500]) {
    await withFetch(
      () => ({ ok: false, status, text: '{"errors":[{"message":"refused"}]}' }),
      async () => {
        assert.equal(
          await getUpstoxHistoricalCandles(TCS_KEY, "2026-09-01", "2026-09-25"),
          null
        );
      }
    );
  }
});

test("a response we cannot read is null, not an empty window", async () => {
  const { getUpstoxHistoricalCandles } = await loadClient();

  const unreadable = [
    { ok: true, status: 200, body: undefined },
    { ok: true, status: 200, body: {} },
    // Right envelope, wrong status field.
    { ok: true, status: 200, body: { status: "error", data: { candles: [] } } },
    // No data object at all.
    { ok: true, status: 200, body: { status: "success" } },
    // data present but candles missing or mistyped.
    { ok: true, status: 200, body: { status: "success", data: {} } },
    { ok: true, status: 200, body: { status: "success", data: { candles: null } } },
    { ok: true, status: 200, body: { status: "success", data: { candles: "nope" } } },
    { ok: true, status: 200, body: { status: "success", data: [] } },
  ];

  for (const response of unreadable) {
    await withFetch(() => response, async () => {
      assert.equal(
        await getUpstoxHistoricalCandles(TCS_KEY, "2026-09-01", "2026-09-25"),
        null,
        `unexpected result for ${JSON.stringify(response.body)}`
      );
    });
  }
});

test("non-array and short candle rows are skipped rather than kept", async () => {
  const { getUpstoxHistoricalCandles } = await loadClient();

  await withFetch(
    () =>
      successEnvelope([
        "2026-09-25T00:00:00+05:30",
        null,
        [],
        ["2026-09-25T00:00:00+05:30", 2054],
        ["2026-09-25T00:00:00+05:30", 2054, 2090.2, 2038.1, 2082, 3342195, 0],
      ]),
    async () => {
      const rows = await getUpstoxHistoricalCandles(TCS_KEY, "2026-09-01", "2026-09-25");

      assert.equal(rows?.length, 1);
      assert.equal(rows?.[0].length, 6);
    }
  );
});

test("a network failure is null and does not escape", async () => {
  const { getUpstoxHistoricalCandles } = await loadClient();
  const original = globalThis.fetch;

  globalThis.fetch = (async () => {
    throw new Error("socket hang up");
  }) as typeof fetch;

  try {
    assert.equal(
      await getUpstoxHistoricalCandles(TCS_KEY, "2026-09-01", "2026-09-25"),
      null
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("a request that cannot be built correctly is refused without any fetch", async () => {
  const { getUpstoxHistoricalCandles } = await loadClient();

  const bad: [string, string, string][] = [
    ["", "2026-09-01", "2026-09-25"],
    ["   ", "2026-09-01", "2026-09-25"],
    [TCS_KEY, "", "2026-09-25"],
    [TCS_KEY, "2026-09-01", ""],
    // Not YYYY-MM-DD: would otherwise be placed straight into the path.
    [TCS_KEY, "01-09-2026", "2026-09-25"],
    [TCS_KEY, "2026/09/01", "2026-09-25"],
    [TCS_KEY, "20260901", "2026-09-25"],
    // Reversed window.
    [TCS_KEY, "2026-09-25", "2026-09-01"],
  ];

  for (const [key, fromDate, toDate] of bad) {
    await withFetch(
      () => successEnvelope([]),
      async (calls) => {
        assert.equal(
          await getUpstoxHistoricalCandles(key, fromDate, toDate),
          null,
          `expected null for ${JSON.stringify([key, fromDate, toDate])}`
        );
        // Nothing was asked of Upstox, so no answer can be misattributed.
        assert.equal(calls.length, 0);
      }
    );
  }
});
