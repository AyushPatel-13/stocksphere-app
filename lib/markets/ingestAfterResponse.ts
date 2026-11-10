import { after } from "next/server";

import { ingestIfDue, type MarketEventStore } from "./eventIngest";

/**
 * Refresh NSE's events without making the reader wait for NSE.
 *
 * Pages used to wait up to four seconds for the ingest before rendering, so
 * the first visit after ten quiet minutes took 4–5 s (and longer when NSE
 * was slow). The stored events are at most a day old (the daily job) and
 * usually minutes old, so the page is rendered from them straight away and
 * the refresh runs once the response has gone; the next reader sees it.
 * Resolves immediately and never throws.
 */
export function ingestAfterResponse(store: MarketEventStore): Promise<void> {
  try {
    after(() => ingestIfDue(store));
  } catch {
    // Outside a request (a script, a test): start it without waiting.
    void ingestIfDue(store, Date.now(), 0);
  }
  return Promise.resolve();
}
