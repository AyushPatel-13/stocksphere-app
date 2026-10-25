import assert from "node:assert/strict";
import test from "node:test";

import { GET } from "@/app/api/fo-ban/route";

test("GET /api/fo-ban returns NSE's list with its trade date, and 503 (never an empty list) when NSE is down", async () => {
  const ok = await GET(undefined, undefined, async () => ({ tradeDate: "2026-10-26", securities: ["SAIL"], sourceUrl: "https://nsearchives.nseindia.com/content/fo/fo_secban.csv" }));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), {
    success: true,
    tradeDate: "2026-10-26",
    securities: ["SAIL"],
    source: "NSE fo_secban.csv",
    sourceUrl: "https://nsearchives.nseindia.com/content/fo/fo_secban.csv",
  });
  const down = await GET(undefined, undefined, async () => null);
  assert.equal(down.status, 503);
  assert.equal((await down.json()).success, false);
});
