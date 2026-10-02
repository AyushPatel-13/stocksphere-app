import { test } from "node:test";
import assert from "node:assert/strict";
import { mapFinancialMetrics } from "../financialsTool";
import {
  findUpstoxRatioValue,
  normalizeUpstoxFinancials,
  parseUpstoxRatioValue,
} from "@/lib/adapters/financials";
import {
  fetchFinancials,
  fetchGlobalFinancials,
  fetchIndianFinancials,
  type GlobalMetricsLookup,
  type GlobalMetricsPayload,
  type IndianInstrumentLookup,
  type IndianKeyRatiosLookup,
} from "@/lib/providers/financials";

test("mapFinancialMetrics maps present numeric fields through", () => {
  const result = mapFinancialMetrics({ pe: 24.5, marketCap: 1_000_000 });

  assert.equal(result.pe, 24.5);
  assert.equal(result.marketCap, 1_000_000);
});

test("mapFinancialMetrics converts undefined/missing fields to null, never 0", () => {
  const result = mapFinancialMetrics({ pe: 24.5 });

  assert.equal(result.eps, null);
  assert.equal(result.dividendYield, null);
  assert.equal(result.week52High, null);
  assert.equal(result.week52Low, null);
  assert.equal(result.roe, null);
  assert.notEqual(result.eps, 0);
});

test("mapFinancialMetrics converts non-numeric/NaN values to null", () => {
  const result = mapFinancialMetrics({ pe: "not a number" as unknown, eps: NaN });

  assert.equal(result.pe, null);
  assert.equal(result.eps, null);
});

// --- Upstox key-ratio normalisation -----------------------------------------

// The live response for TCS (ISIN INE467B01029). Values are strings, some with
// a unit suffix, and the list carries a peer benchmark alongside each figure.
const tcsKeyRatios = [
  { name: "P/E", company_value: "15.06", sector_value: "66.52" },
  { name: "P/B", company_value: "7.03", sector_value: "7.1" },
  { name: "ROA", company_value: "27.45%", sector_value: "-2.24%" },
  { name: "ROE", company_value: "45.89%", sector_value: "8.65%" },
  { name: "ROCE", company_value: "55.21%", sector_value: "71.53%" },
  { name: "Quick Ratio", company_value: "2.23", sector_value: "12.67" },
  { name: "EV/EBITDA", company_value: "10.27", sector_value: "66.63" },
];

const FINANCIAL_METRIC_KEYS = [
  "dividendYield",
  "eps",
  "evToEbitda",
  "marketCap",
  "pb",
  "pe",
  "roa",
  "roce",
  "roe",
  "week52High",
  "week52Low",
];

test("normalizeUpstoxFinancials maps the P/E row onto pe", () => {
  const result = normalizeUpstoxFinancials(tcsKeyRatios);

  assert.equal(result.pe, 15.06);
});

test("P/E is matched by exact name, never by array position", () => {
  // Same rows, reversed: position-based parsing would pick up EV/EBITDA.
  const reversed = [...tcsKeyRatios].reverse();

  assert.equal(normalizeUpstoxFinancials(reversed).pe, 15.06);
  assert.equal(findUpstoxRatioValue(tcsKeyRatios, "P/E"), 15.06);

  // A longer name merely containing "P/E" is not the P/E row.
  assert.equal(
    findUpstoxRatioValue([{ name: "P/E Ratio", company_value: "99" }], "P/E"),
    null
  );
});

test("parseUpstoxRatioValue handles numeric strings, percent suffixes and numbers", () => {
  assert.equal(parseUpstoxRatioValue("15.06"), 15.06);
  assert.equal(parseUpstoxRatioValue("  15.06  "), 15.06);
  assert.equal(parseUpstoxRatioValue("45.89%"), 45.89);
  assert.equal(parseUpstoxRatioValue(10.27), 10.27);
  assert.equal(parseUpstoxRatioValue("-2.24%"), -2.24);
});

test("parseUpstoxRatioValue returns null for missing, blank or non-numeric values", () => {
  assert.equal(parseUpstoxRatioValue(undefined), null);
  assert.equal(parseUpstoxRatioValue(null), null);
  assert.equal(parseUpstoxRatioValue(""), null);
  assert.equal(parseUpstoxRatioValue("   "), null);
  assert.equal(parseUpstoxRatioValue("N/A"), null);
  assert.equal(parseUpstoxRatioValue("-"), null);
  assert.equal(parseUpstoxRatioValue(NaN), null);
  assert.equal(parseUpstoxRatioValue(Infinity), null);
  assert.equal(parseUpstoxRatioValue({}), null);
});

test("missing or unusable P/E becomes null rather than 0 or NaN", () => {
  const withoutPe = tcsKeyRatios.filter((row) => row.name !== "P/E");

  assert.equal(normalizeUpstoxFinancials(withoutPe).pe, null);
  assert.equal(
    normalizeUpstoxFinancials([{ name: "P/E", company_value: "N/A" }]).pe,
    null
  );
  assert.equal(
    normalizeUpstoxFinancials([{ name: "P/E", company_value: null }]).pe,
    null
  );
  assert.equal(normalizeUpstoxFinancials([]).pe, null);
  assert.equal(normalizeUpstoxFinancials(null).pe, null);
  assert.equal(normalizeUpstoxFinancials(undefined).pe, null);
});

test("normalizeUpstoxFinancials leaves the metrics Upstox cannot supply as null", () => {
  const result = normalizeUpstoxFinancials(tcsKeyRatios);

  // Upstox reports market cap in crore INR (profile.sector_market_cap_inr)
  // while Finnhub reports millions of the local currency, and the contract
  // carries no unit or currency metadata — so it must not be populated.
  assert.equal(result.marketCap, null);
  assert.equal(result.eps, null);
  assert.equal(result.dividendYield, null);
  assert.equal(result.week52High, null);
  assert.equal(result.week52Low, null);
  // "ROE" is present in the response but is not enabled in this step.
  assert.equal(result.roe, 45.89);
});

test("normalizeUpstoxFinancials returns exactly the contract shape, leaking no Upstox metadata", () => {
  // Rows carrying Upstox-only fields, plus a stray metadata row, must not
  // widen the result: FinancialMetrics has seven numeric fields and nothing else.
  const rowsWithMetadata = [
    ...tcsKeyRatios,
    { name: "ISIN", company_value: "INE467B01029", instrument_key: "NSE_EQ|INE467B01029" },
    { name: "instrument_key", company_value: "NSE_EQ|INE467B01029" },
  ];

  const result = normalizeUpstoxFinancials(rowsWithMetadata);

  assert.deepEqual(Object.keys(result).sort(), FINANCIAL_METRIC_KEYS);

  const values = Object.values(result).map((value) => String(value));
  assert.equal(values.some((value) => value.includes("INE")), false);
  assert.equal(values.some((value) => value.includes("NSE_EQ")), false);
});

// --- Provider routing --------------------------------------------------------

/** Records every symbol it is asked about. */
function spyInstrument(row: { isin?: string } | null) {
  const calls: string[] = [];
  const lookup: IndianInstrumentLookup = async (symbol) => {
    calls.push(symbol);
    return row;
  };
  return { lookup, calls };
}

function spyKeyRatios(rows: { name?: unknown; company_value?: unknown }[] | null) {
  const calls: string[] = [];
  const lookup: IndianKeyRatiosLookup = async (isin) => {
    calls.push(isin);
    return rows;
  };
  return { lookup, calls };
}

function spyGlobalMetrics(payload: GlobalMetricsPayload | null | undefined) {
  const calls: string[] = [];
  const lookup: GlobalMetricsLookup = async (symbol) => {
    calls.push(symbol);
    return payload;
  };
  return { lookup, calls };
}

test("an Indian symbol is looked up by its bare NSE ticker, and its ISIN keys the fundamentals call", async () => {
  const instrument = spyInstrument({ isin: "INE467B01029" });
  const ratios = spyKeyRatios(tcsKeyRatios);

  const result = await fetchIndianFinancials("TCS.NS", instrument.lookup, ratios.lookup);

  // ".NS" is dropped for the Upstox instrument search and nothing else.
  assert.deepEqual(instrument.calls, ["TCS"]);
  assert.deepEqual(ratios.calls, ["INE467B01029"]);
  assert.equal(result?.provider, "Upstox");
  assert.equal(result?.data.pe, 15.06);
});

test("the bare ticker never becomes the financial result's identity", async () => {
  const instrument = spyInstrument({ isin: "INE467B01029" });
  const ratios = spyKeyRatios(tcsKeyRatios);

  const result = await fetchIndianFinancials("TCS.NS", instrument.lookup, ratios.lookup);

  // FinancialMetrics has no symbol field at all, so the stripped ticker cannot
  // surface as the company's identity anywhere downstream.
  assert.deepEqual(Object.keys(result!.data).sort(), FINANCIAL_METRIC_KEYS);
  assert.equal("symbol" in result!.data, false);
});

test("'BSE' suffixes are stripped for the Upstox lookup too", async () => {
  const instrument = spyInstrument({ isin: "INE002A01018" });
  const ratios = spyKeyRatios(tcsKeyRatios);

  await fetchIndianFinancials("RELIANCE.BSE", instrument.lookup, ratios.lookup);

  assert.deepEqual(instrument.calls, ["RELIANCE"]);
});

test("a non-Indian symbol goes to Finnhub and never touches Upstox", async () => {
  const instrument = spyInstrument({ isin: "SHOULD_NOT_BE_USED" });
  const ratios = spyKeyRatios(tcsKeyRatios);
  const global = spyGlobalMetrics({
    metric: {
      marketCapitalization: 4977637,
      peTTM: 38.6073,
      epsTTM: 8.7233,
      dividendYieldIndicatedAnnual: 0.50534,
      "52WeekHigh": 345.34,
      "52WeekLow": 243.42,
      roeTTM: 137.18,
    },
  });

  const result = await fetchFinancials(
    "AAPL",
    instrument.lookup,
    ratios.lookup,
    global.lookup
  );

  assert.equal(result?.provider, "Finnhub");
  assert.deepEqual(global.calls, ["AAPL"]);
  assert.equal(instrument.calls.length, 0);
  assert.equal(ratios.calls.length, 0);
});

test("an Indian symbol is never sent to Finnhub, suffixed or bare", async () => {
  const instrument = spyInstrument({ isin: "INE467B01029" });
  const ratios = spyKeyRatios(tcsKeyRatios);
  const global = spyGlobalMetrics({ metric: { peTTM: 999 } });

  const result = await fetchFinancials(
    "TCS.NS",
    instrument.lookup,
    ratios.lookup,
    global.lookup
  );

  assert.equal(result?.provider, "Upstox");
  assert.equal(global.calls.length, 0);
  assert.deepEqual(instrument.calls, ["TCS"]);
});

test("fetchGlobalFinancials preserves the Finnhub field projection", async () => {
  const global = spyGlobalMetrics({
    metric: {
      marketCapitalization: 4977637,
      peTTM: 38.6073,
      epsTTM: 8.7233,
      dividendYieldIndicatedAnnual: 0.50534,
      "52WeekHigh": 345.34,
      "52WeekLow": 243.42,
      roeTTM: 137.18,
    },
  });

  const result = await fetchGlobalFinancials("AAPL", global.lookup);

  assert.equal(result?.provider, "Finnhub");
  assert.deepEqual(result?.data, {
    marketCap: 4977637,
    pe: 38.6073,
    eps: 8.7233,
    dividendYield: 0.50534,
    week52High: 345.34,
    week52Low: 243.42,
    roe: 137.18,
  });
});

test("provider failures resolve to null instead of throwing", async () => {
  const okInstrument = spyInstrument({ isin: "INE467B01029" }).lookup;
  const okRatios = spyKeyRatios(tcsKeyRatios).lookup;
  const missingToken: IndianInstrumentLookup = async () => {
    throw new Error("UPSTOX_ACCESS_TOKEN is missing from environment variables");
  };
  const throwingRatios: IndianKeyRatiosLookup = async () => {
    throw new Error("UPSTOX_ACCESS_TOKEN is missing from environment variables");
  };
  const throwingGlobal: GlobalMetricsLookup = async () => {
    throw new Error("network down");
  };

  // Unresolved instrument -> no ISIN -> nothing to look up.
  assert.equal(await fetchIndianFinancials("TCS.NS", spyInstrument(null).lookup, okRatios), null);
  // Missing token on the instrument search.
  assert.equal(await fetchIndianFinancials("TCS.NS", missingToken, okRatios), null);
  // Missing token on the fundamentals call.
  assert.equal(await fetchIndianFinancials("TCS.NS", okInstrument, throwingRatios), null);
  // Fundamentals reported unavailable.
  assert.equal(await fetchIndianFinancials("TCS.NS", okInstrument, spyKeyRatios(null).lookup), null);
  // Finnhub threw, and separately returned an error body with no `metric`.
  assert.equal(await fetchGlobalFinancials("AAPL", throwingGlobal), null);
  assert.equal(await fetchGlobalFinancials("AAPL", spyGlobalMetrics({ error: "Invalid API key" }).lookup), null);
});

test("an Indian key-ratios payload with no usable metric yields an all-null result, not an error", async () => {
  const instrument = spyInstrument({ isin: "INE467B01029" });
  const ratios = spyKeyRatios([
  { name: "UNKNOWN", company_value: "45.89%" },
]);

  const result = await fetchIndianFinancials("TCS.NS", instrument.lookup, ratios.lookup);

  // The provider answered, so this is data with everything unavailable — the
  // tool's hasAnyMetric() gate is what turns it into a failure result.
  assert.equal(result?.provider, "Upstox");
  assert.deepEqual(result?.data, {
  marketCap: null,
  pe: null,
  pb: null,
  eps: null,
  dividendYield: null,
  week52High: null,
  week52Low: null,
  roe: null,
  roa: null,
  roce: null,
  evToEbitda: null,
  });
  assert.equal(mapFinancialMetrics(result!.data).pe, null);
});
