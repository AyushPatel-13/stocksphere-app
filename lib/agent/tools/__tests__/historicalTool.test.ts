import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_POINTS,
  SOURCE,
  classifyHistorical,
  historicalTool,
  sliceByRange,
  type HistoricalOutcome,
} from "../historicalTool";
import {
  normalizeUpstoxCandles,
  parseUpstoxCandleDate,
  type UpstoxCandleRow,
} from "@/lib/adapters/historical";
import {
  fetchHistorical,
  fetchIndianHistorical,
  fetchGlobalHistorical,
  type IndianCandleLookup,
  type IndianInstrumentLookup,
} from "@/lib/providers/historical";
import { HISTORICAL_RANGES } from "@/lib/types/historical";
import type { HistoricalPayload, HistoricalValueRow } from "@/lib/types/historical";
import type { NormalizedHistoricalPoint } from "../../types";

// --- Fixtures ---------------------------------------------------------------
// Real rows, captured live from Upstox v3 for each symbol on 2026-09-25 and the
// two sessions before it. Row order is exactly as Upstox returned it:
// newest-first. The seventh slot is Upstox's open interest, always 0 for an
// equity, present here so the tests can prove it never reaches the payload.

const tcsCandles: UpstoxCandleRow[] = [
  ["2026-09-25T00:00:00+05:30", 2054, 2090.2, 2038.1, 2082, 3342195, 0],
  ["2026-09-24T00:00:00+05:30", 2076, 2096.9, 2067.1, 2087, 1760662, 0],
  ["2026-09-23T00:00:00+05:30", 2099, 2104.2, 2077.6, 2089.6, 2228402, 0],
];

const infyCandles: UpstoxCandleRow[] = [
  ["2026-09-25T00:00:00+05:30", 999.5, 1004.2, 991.6, 1000.2, 10240700, 0],
  ["2026-09-24T00:00:00+05:30", 1015, 1022.8, 1005.2, 1014.5, 6891893, 0],
  ["2026-09-23T00:00:00+05:30", 1021.8, 1029.4, 1015.1, 1020.5, 5108734, 0],
];

const relianceCandles: UpstoxCandleRow[] = [
  ["2026-09-25T00:00:00+05:30", 1210.5, 1227.4, 1210.5, 1226, 13138735, 0],
  ["2026-09-24T00:00:00+05:30", 1236.6, 1241.6, 1219.2, 1219.2, 13923795, 0],
  ["2026-09-23T00:00:00+05:30", 1242, 1252.8, 1238.9, 1248, 8352048, 0],
];

const hdfcbankCandles: UpstoxCandleRow[] = [
  ["2026-09-25T00:00:00+05:30", 723, 739.65, 723, 735.6, 19853034, 0],
  ["2026-09-24T00:00:00+05:30", 725, 734.85, 722.7, 728.9, 29575194, 0],
  ["2026-09-23T00:00:00+05:30", 735.65, 742.8, 734, 737.25, 23197231, 0],
];

/** instrument_key for each symbol, as searchUpstoxEquity() resolves it live. */
const INDIAN_SYMBOLS = [
  { symbol: "TCS.NS", key: "NSE_EQ|INE467B01029", candles: tcsCandles },
  { symbol: "INFY.NS", key: "NSE_EQ|INE009A01021", candles: infyCandles },
  { symbol: "RELIANCE.NS", key: "NSE_EQ|INE002A01018", candles: relianceCandles },
  { symbol: "HDFCBANK.NS", key: "NSE_EQ|INE040A01034", candles: hdfcbankCandles },
] as const;

const PAYLOAD_ROW_KEYS = ["close", "datetime", "high", "low", "open", "volume"];

/** A TwelveData-shaped payload, as an already-newest-first {values:[...]} blob. */
function globalPayload(days: number): HistoricalPayload {
  const values: HistoricalValueRow[] = [];

  for (let i = 0; i < days; i++) {
    const date = new Date(Date.UTC(2026, 8, 25) - i * 86400000)
      .toISOString()
      .slice(0, 10);

    values.push({
      datetime: date,
      open: "100.00000",
      high: "101.00000",
      low: "99.00000",
      close: String(100 + i),
      volume: "1000",
    });
  }

  return { values };
}

// --- Spies ------------------------------------------------------------------

/** Records every symbol it is asked about. */
function spyInstrument(row: { instrument_key?: string } | null) {
  const calls: string[] = [];
  const lookup: IndianInstrumentLookup = async (symbol) => {
    calls.push(symbol);
    return row;
  };
  return { lookup, calls };
}

/** Records every (key, fromDate, toDate) triple it is asked for. */
function spyCandles(rows: UpstoxCandleRow[] | null) {
  const calls: { instrumentKey: string; fromDate: string; toDate: string }[] = [];
  const lookup: IndianCandleLookup = async (instrumentKey, fromDate, toDate) => {
    calls.push({ instrumentKey, fromDate, toDate });
    return rows;
  };
  return { lookup, calls };
}

/** Records every symbol it is asked about, and stands in for TwelveData. */
function spyGlobal(payload: HistoricalPayload | null) {
  const calls: string[] = [];
  const lookup = async (symbol: string) => {
    calls.push(symbol);
    return payload;
  };
  return { lookup, calls };
}

function outcomePoints(outcome: HistoricalOutcome): NormalizedHistoricalPoint[] {
  assert.equal(outcome.status, "ok");
  return outcome.status === "ok" ? outcome.points : [];
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round(
    (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) /
      86400000
  );
}

// --- Timestamp conversion ---------------------------------------------------

test("parseUpstoxCandleDate converts the live IST timestamp to YYYY-MM-DD", () => {
  // The exact string format Upstox v3 returned for all four symbols. Only the
  // date part may survive: StockChart prints this value directly as the chart's
  // x-axis label and NormalizedHistoricalPoint.date is documented as YYYY-MM-DD.
  assert.equal(
    parseUpstoxCandleDate("2026-09-25T00:00:00+05:30"),
    "2026-09-25"
  );
  assert.equal(
    parseUpstoxCandleDate("2026-09-23T00:00:00+05:30"),
    "2026-09-23"
  );
  // A bare date is tolerated.
  assert.equal(parseUpstoxCandleDate("2026-09-25"), "2026-09-25");
  // Surrounding whitespace is not part of the date.
  assert.equal(
    parseUpstoxCandleDate("  2026-09-25T00:00:00+05:30  "),
    "2026-09-25"
  );
});

test("parseUpstoxCandleDate rejects anything that is not a real calendar date", () => {
  assert.equal(parseUpstoxCandleDate(undefined), null);
  assert.equal(parseUpstoxCandleDate(null), null);
  assert.equal(parseUpstoxCandleDate(""), null);
  assert.equal(parseUpstoxCandleDate("   "), null);
  assert.equal(parseUpstoxCandleDate("not a date"), null);
  // Right shape, impossible date. The day is checked against the month rather
  // than trusted to Date.parse, which silently rolls 2026-02-30 forward to
  // 2026-03-02 for a date-time string.
  assert.equal(parseUpstoxCandleDate("2026-13-45T00:00:00+05:30"), null);
  assert.equal(parseUpstoxCandleDate("2026-02-30T00:00:00+05:30"), null);
  assert.equal(parseUpstoxCandleDate("2026-02-31T00:00:00+05:30"), null);
  assert.equal(parseUpstoxCandleDate("2026-04-31T00:00:00+05:30"), null);
  // A real leap day is still a real date.
  assert.equal(parseUpstoxCandleDate("2028-02-29T00:00:00+05:30"), "2028-02-29");
  // ...and a non-leap 29 February is not.
  assert.equal(parseUpstoxCandleDate("2027-02-29T00:00:00+05:30"), null);
  // Other formats are not silently reinterpreted.
  assert.equal(parseUpstoxCandleDate("25-09-2026"), null);
  assert.equal(parseUpstoxCandleDate("2026/09/25"), null);
  // A number or an object is not a date.
  assert.equal(parseUpstoxCandleDate(20260925), null);
  assert.equal(parseUpstoxCandleDate({}), null);
});

test("a live TCS candle maps onto the {values:[...]} contract", () => {
  const payload = normalizeUpstoxCandles([tcsCandles[0]]);

  assert.equal(payload.values.length, 1);

  const [row] = payload.values;

  assert.equal(row.datetime, "2026-09-25");
  assert.equal(row.open, 2054);
  assert.equal(row.high, 2090.2);
  assert.equal(row.low, 2038.1);
  assert.equal(row.close, 2082);
  assert.equal(row.volume, 3342195);
});

test("every Indian symbol survives normalisation and keeps its numbers", () => {
  // A regression guard on the slot order: open/high/low/close/volume are read
  // positionally, so a mis-mapped index would show up as a wrong number here.
  const expected = [
    { row: tcsCandles[0], close: 2082, high: 2090.2, low: 2038.1, open: 2054 },
    { row: infyCandles[0], close: 1000.2, high: 1004.2, low: 991.6, open: 999.5 },
    { row: relianceCandles[0], close: 1226, high: 1227.4, low: 1210.5, open: 1210.5 },
    { row: hdfcbankCandles[0], close: 735.6, high: 739.65, low: 723, open: 723 },
  ];

  for (const { row, close, high, low, open } of expected) {
    const [point] = normalizeUpstoxCandles([row]).values;

    assert.equal(point.close, close);
    assert.equal(point.high, high);
    assert.equal(point.low, low);
    assert.equal(point.open, open);
  }
});

// --- Ordering ---------------------------------------------------------------

test("newest-first ordering is preserved, because StockChart inverts it", () => {
  // components/Stock/StockChart.tsx does slice(0, days).reverse(): it takes the
  // leading rows as the most recent. Ascending output would silently render
  // every chart backwards.
  const payload = normalizeUpstoxCandles(tcsCandles);

  assert.deepEqual(
    payload.values.map((row) => row.datetime),
    ["2026-09-25", "2026-09-24", "2026-09-23"]
  );
});

test("newest-first ordering is enforced even if upstream ever reverses", () => {
  // Upstox answers newest-first today (verified live for all four symbols), but
  // the guarantee is produced here rather than trusted from upstream, so a
  // provider-side change surfaces as nothing at all instead of as an inverted
  // chart on every stock page.
  const oldestFirst = [...tcsCandles].reverse();

  const payload = normalizeUpstoxCandles(oldestFirst);

  assert.deepEqual(
    payload.values.map((row) => row.datetime),
    ["2026-09-25", "2026-09-24", "2026-09-23"]
  );
});

test("a shuffled payload still comes out strictly newest-first", () => {
  const shuffled = [tcsCandles[1], tcsCandles[2], tcsCandles[0]];

  const dates = normalizeUpstoxCandles(shuffled).values.map((row) => row.datetime);

  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.deepEqual(dates, ["2026-09-25", "2026-09-24", "2026-09-23"]);
});

// --- Contract shape ---------------------------------------------------------

test("open interest and any other extra slot never reach the payload", () => {
  // The seventh slot of every live row is Upstox's open interest (0 for an
  // equity). The {values:[...]} contract has no field for it, so it must not
  // appear — the payload is exactly six keys wide.
  const [row] = normalizeUpstoxCandles([tcsCandles[0]]).values;

  assert.deepEqual(Object.keys(row).sort(), PAYLOAD_ROW_KEYS);
  assert.equal("oi" in row, false);
  assert.equal(
    Object.values(row).some((value) => value === 0 && value !== row.volume),
    false
  );
});

test("an extra future slot on an upstream row is ignored too", () => {
  // Slot 7 is unknown today. A row one slot longer must still yield exactly the
  // six contract fields.
  const rowWithExtra: UpstoxCandleRow = [
    "2026-09-25T00:00:00+05:30",
    2054,
    2090.2,
    2038.1,
    2082,
    3342195,
    0,
    "something-new",
  ];

  const [row] = normalizeUpstoxCandles([rowWithExtra]).values;

  assert.deepEqual(Object.keys(row).sort(), PAYLOAD_ROW_KEYS);
  assert.equal(JSON.stringify(row).includes("something-new"), false);
});

test("the payload is {values:[...]} of objects, never the raw arrays", () => {
  // The two consumers read row.datetime and row.close, so a row that was still
  // an array would render nothing at all.
  const payload = normalizeUpstoxCandles(tcsCandles);

  assert.deepEqual(Object.keys(payload), ["values"]);
  assert.equal(Array.isArray(payload.values), true);

  for (const row of payload.values) {
    assert.equal(Array.isArray(row), false);
    assert.equal(typeof row.datetime, "string");
  }
});

// --- Malformed rows ---------------------------------------------------------

test("malformed Upstox rows are dropped, never zero-filled", () => {
  const rows: UpstoxCandleRow[] = [
    [],
    ["2026-09-25T00:00:00+05:30"],
    ["2026-09-25T00:00:00+05:30", 2054, 2090.2, 2038.1, 2082], // 5 slots: no volume
    [null, 2054, 2090.2, 2038.1, 2082, 3342195],
    ["not a date", 2054, 2090.2, 2038.1, 2082, 3342195],
    ["2026-02-30T00:00:00+05:30", 2054, 2090.2, 2038.1, 2082, 3342195],
    ["2026-09-25T00:00:00+05:30", "n/a", 2090.2, 2038.1, 2082, 3342195],
    ["2026-09-25T00:00:00+05:30", 2054, null, 2038.1, 2082, 3342195],
    ["2026-09-25T00:00:00+05:30", 2054, 2090.2, undefined, 2082, 3342195],
    ["2026-09-25T00:00:00+05:30", 2054, 2090.2, 2038.1, NaN, 3342195],
  ];

  const payload = normalizeUpstoxCandles(rows);

  // Only the six-slot row with a date but no volume is usable, and it is kept
  // with volume: null rather than dropped — volume is not part of the OHLC
  // validity test.
  assert.equal(payload.values.length, 1);
  assert.equal(payload.values[0].datetime, "2026-09-25");
  assert.equal(payload.values[0].volume, null);
});

test("a row that is not an array at all is dropped", () => {
  const rows = [
    "2026-09-25T00:00:00+05:30",
    null,
    undefined,
    { datetime: "2026-09-25" },
    42,
    tcsCandles[0],
  ] as UpstoxCandleRow[];

  const payload = normalizeUpstoxCandles(rows);

  assert.equal(payload.values.length, 1);
  assert.equal(payload.values[0].close, 2082);
});

test("an incomplete candle is never filled with 0", () => {
  // A zero close would draw a spike to the bottom of the chart and read as a
  // real price.
  const payload = normalizeUpstoxCandles([
    ["2026-09-25T00:00:00+05:30", null, null, null, null, 3342195, 0],
  ]);

  assert.deepEqual(payload.values, []);
});

test("a genuine zero volume is kept as 0, not turned into null", () => {
  // 0 is a real value (no shares traded in the session), and the payload's
  // number | null volume must not confuse it with "not reported".
  const payload = normalizeUpstoxCandles([
    ["2026-09-25T00:00:00+05:30", 2054, 2090.2, 2038.1, 2082, 0, 0],
  ]);

  assert.equal(payload.values[0].volume, 0);
  assert.notEqual(payload.values[0].volume, null);
});

test("a missing volume becomes null, not 0", () => {
  const payload = normalizeUpstoxCandles([
    ["2026-09-25T00:00:00+05:30", 2054, 2090.2, 2038.1, 2082, "", 0],
  ]);

  assert.equal(payload.values[0].volume, null);
});

test("duplicate dates collapse to one candle", () => {
  const payload = normalizeUpstoxCandles([tcsCandles[0], tcsCandles[0]]);

  assert.equal(payload.values.length, 1);
});

test("a discarded row does not shadow a later valid row on the same date", () => {
  const broken = ["2026-09-25T00:00:00+05:30", null, null, null, null, 0, 0];
  const good = tcsCandles[0];

  const payload = normalizeUpstoxCandles([broken, good]);

  assert.equal(payload.values.length, 1);
  assert.equal(payload.values[0].close, 2082);
});

test("normalizeUpstoxCandles returns an empty payload for a non-array input", () => {
  assert.deepEqual(normalizeUpstoxCandles(null), { values: [] });
  assert.deepEqual(normalizeUpstoxCandles(undefined), { values: [] });
  assert.deepEqual(normalizeUpstoxCandles([]), { values: [] });
  // @ts-expect-error deliberately passing the wrong shape
  assert.deepEqual(normalizeUpstoxCandles("not an array"), { values: [] });
});

// --- Provider routing -------------------------------------------------------

for (const { symbol, key, candles } of INDIAN_SYMBOLS) {
  test(`${symbol} resolves its instrument key and is served by Upstox alone`, async () => {
    const instrument = spyInstrument({ instrument_key: key });
    const indianCandles = spyCandles(candles);
    const global = spyGlobal(globalPayload(30));

    const result = await fetchHistorical(
      symbol,
      "1y",
      instrument.lookup,
      indianCandles.lookup,
      global.lookup
    );

    // ".NS" is dropped for the Upstox instrument search and nothing else.
    assert.deepEqual(instrument.calls, [symbol.replace(".NS", "")]);
    // The candle request is keyed by instrument_key, never by the symbol.
    assert.equal(indianCandles.calls.length, 1);
    assert.equal(indianCandles.calls[0].instrumentKey, key);
    assert.equal(result?.provider, "Upstox");
    // TwelveData is never consulted for an Indian symbol.
    assert.equal(global.calls.length, 0);
  });
}

test("all four Indian symbols produce a newest-first payload of real candles", async () => {
  for (const { symbol, key, candles } of INDIAN_SYMBOLS) {
    const result = await fetchIndianHistorical(
      symbol,
      "1m",
      spyInstrument({ instrument_key: key }).lookup,
      spyCandles(candles).lookup
    );

    assert.equal(result?.provider, "Upstox");
    assert.deepEqual(
      result?.data.values.map((row) => row.datetime),
      ["2026-09-25", "2026-09-24", "2026-09-23"]
    );
  }
});

test("'.BSE' is stripped for the Upstox lookup, and still routes to Upstox", async () => {
  const instrument = spyInstrument({ instrument_key: "NSE_EQ|INE002A01018" });
  const indianCandles = spyCandles(relianceCandles);
  const global = spyGlobal(globalPayload(30));

  const result = await fetchHistorical(
    "RELIANCE.BSE",
    "1m",
    instrument.lookup,
    indianCandles.lookup,
    global.lookup
  );

  assert.deepEqual(instrument.calls, ["RELIANCE"]);
  assert.equal(result?.provider, "Upstox");
  assert.equal(global.calls.length, 0);
});

test("a non-Indian symbol goes to TwelveData and never touches Upstox", async () => {
  const instrument = spyInstrument({ instrument_key: "NSE_EQ|INE467B01029" });
  const indianCandles = spyCandles(tcsCandles);
  const global = spyGlobal(globalPayload(30));

  const result = await fetchHistorical(
    "AAPL",
    undefined,
    instrument.lookup,
    indianCandles.lookup,
    global.lookup
  );

  assert.equal(result?.provider, "TwelveData");
  assert.deepEqual(global.calls, ["AAPL"]);
  assert.equal(instrument.calls.length, 0);
  assert.equal(indianCandles.calls.length, 0);
});

test("an Indian symbol is never sent to a global provider, suffixed or bare", async () => {
  // The rule this guards: a bare NSE ticker is not a global symbol. Live,
  // TwelveData answers "INFY" with the NYSE ADR in USD at 10.53 and Yahoo
  // agrees — a different security from Infosys Ltd on NSE at ~1,000. So the
  // global path must not be reached at all, with either spelling.
  for (const symbol of ["TCS.NS", "INFY.NS", "RELIANCE.NS", "HDFCBANK.NS", "TCS.BSE", "INFY.BSE"]) {
    const instrument = spyInstrument({ instrument_key: "NSE_EQ|INE009A01021" });
    const indianCandles = spyCandles(infyCandles);
    const global = spyGlobal(globalPayload(30));

    await fetchHistorical(symbol, "1y", instrument.lookup, indianCandles.lookup, global.lookup);

    assert.equal(global.calls.length, 0, `${symbol} reached the global provider`);
    // The suffix never reaches Upstox either; it is stripped for that lookup only.
    assert.equal(instrument.calls[0].endsWith(".NS"), false);
    assert.equal(instrument.calls[0].endsWith(".BSE"), false);
    assert.equal(instrument.calls[0].endsWith("."), false);
  }
});

test("each path makes exactly one call per provider, with no duplicate fetch", async () => {
  const indian = {
    instrument: spyInstrument({ instrument_key: "NSE_EQ|INE467B01029" }),
    candles: spyCandles(tcsCandles),
    global: spyGlobal(globalPayload(30)),
  };

  await fetchHistorical(
    "TCS.NS",
    "1y",
    indian.instrument.lookup,
    indian.candles.lookup,
    indian.global.lookup
  );

  assert.equal(indian.instrument.calls.length, 1);
  assert.equal(indian.candles.calls.length, 1);
  assert.equal(indian.global.calls.length, 0);

  const global = {
    instrument: spyInstrument({ instrument_key: "NSE_EQ|INE467B01029" }),
    candles: spyCandles(tcsCandles),
    global: spyGlobal(globalPayload(30)),
  };

  await fetchHistorical(
    "AAPL",
    "1y",
    global.instrument.lookup,
    global.candles.lookup,
    global.global.lookup
  );

  assert.equal(global.global.calls.length, 1);
  assert.equal(global.instrument.calls.length, 0);
  assert.equal(global.candles.calls.length, 0);
});

test("the provider hands out normalised rows, not raw Upstox candles", async () => {
  // Downstream code reads row.datetime/row.close, so the conversion must be
  // finished before the payload leaves this layer.
  const result = await fetchIndianHistorical(
    "TCS.NS",
    "1m",
    spyInstrument({ instrument_key: "NSE_EQ|INE467B01029" }).lookup,
    spyCandles(tcsCandles).lookup
  );

  assert.deepEqual(Object.keys(result!.data.values[0]).sort(), PAYLOAD_ROW_KEYS);
  assert.equal(result!.data.values[0].datetime.includes("T"), false);
});

// --- Provider failure vs legitimate empty ----------------------------------

test("Indian provider failures resolve to null instead of throwing", async () => {
  const okInstrument = spyInstrument({ instrument_key: "NSE_EQ|INE467B01029" }).lookup;
  const okCandles = spyCandles(tcsCandles).lookup;
  const missingToken: IndianInstrumentLookup = async () => {
    throw new Error("UPSTOX_ACCESS_TOKEN is missing from environment variables");
  };
  const throwingCandles: IndianCandleLookup = async () => {
    throw new Error("UPSTOX_ACCESS_TOKEN is missing from environment variables");
  };

  // Unresolved instrument -> no instrument_key -> nothing to ask about.
  assert.equal(await fetchIndianHistorical("TCS.NS", "1m", spyInstrument(null).lookup, okCandles), null);
  assert.equal(await fetchIndianHistorical("TCS.NS", "1m", spyInstrument({}).lookup, okCandles), null);
  // Missing token on either call.
  assert.equal(await fetchIndianHistorical("TCS.NS", "1m", missingToken, okCandles), null);
  assert.equal(await fetchIndianHistorical("TCS.NS", "1m", okInstrument, throwingCandles), null);
  // The request was refused or was unreadable.
  assert.equal(await fetchIndianHistorical("TCS.NS", "1m", okInstrument, spyCandles(null).lookup), null);
});

test("an empty candle window is data: {values:[]}, not a failure", async () => {
  const result = await fetchIndianHistorical(
    "TCS.NS",
    "1m",
    spyInstrument({ instrument_key: "NSE_EQ|INE467B01029" }).lookup,
    spyCandles([]).lookup
  );

  // Upstox answered, so this is "no candles in that window" — a real answer.
  assert.notEqual(result, null);
  assert.equal(result?.provider, "Upstox");
  assert.deepEqual(result?.data, { values: [] });
});

test("a global provider failure is null, and an empty response is not", async () => {
  assert.equal(await fetchGlobalHistorical("AAPL", async () => null), null);
  assert.equal(
    await fetchGlobalHistorical("AAPL", async () => {
      throw new Error("network down");
    }),
    null
  );
  // TwelveData reports an unusable symbol as a JSON error body with no `values`.
  assert.equal(
    await fetchGlobalHistorical("AAPL", async () => ({}) as { values: never[] }),
    null
  );

  const empty = await fetchGlobalHistorical("AAPL", spyGlobal({ values: [] }).lookup);

  assert.equal(empty?.provider, "TwelveData");
  assert.deepEqual(empty?.data, { values: [] });
});

// --- Range contract ---------------------------------------------------------

test("every supported range is accepted, and only those", () => {
  assert.deepEqual([...HISTORICAL_RANGES], ["1m", "3m", "6m", "1y", "max"]);

  for (const range of HISTORICAL_RANGES) {
    const parsed = historicalTool.argsSchema.safeParse({ symbol: "TCS.NS", range });

    assert.equal(parsed.success, true, `range ${range} was rejected`);
  }

  for (const range of ["5y", "1d", "1w", "2y", "", "MAX", "all"]) {
    assert.equal(
      historicalTool.argsSchema.safeParse({ symbol: "TCS.NS", range }).success,
      false,
      `range ${range} was accepted`
    );
  }
});

test("the JSON schema enum and the validator agree on the ranges", () => {
  // The LLM sees the JSON Schema; the tool enforces the zod enum. If they drift,
  // the model is invited to ask for a range that is then rejected.
  const rangeProperty = historicalTool.parameters.properties.range as {
    enum: string[];
    description: string;
  };

  assert.deepEqual(rangeProperty.enum, [...HISTORICAL_RANGES]);
});

test("'max' is described as capped by the tool, not as every candle held", () => {
  // The model reads this string and decides what it can promise the user, so it
  // has to describe the response it will actually get: the most recent history,
  // bounded by what the tool sends in one response.
  const rangeProperty = historicalTool.parameters.properties.range as {
    description: string;
  };

  assert.match(rangeProperty.description, /up to the maximum/i);
  // ...and it must not claim the full provider history.
  assert.match(rangeProperty.description, /not every candle/i);
  assert.equal(/unlimited/i.test(rangeProperty.description), false);
  assert.equal(/every available/i.test(rangeProperty.description), false);
  // The ranges that are exact must still be described as exact.
  assert.match(rangeProperty.description, /trading sessions/i);
});

test("the Upstox window per range is wider than the trading days it must cover", async () => {
  // get_historical trims to 22/66/132/252 trading sessions. A trading year does
  // NOT fit in 365 calendar days, so each window is deliberately an over-fetch;
  // otherwise the tool would be handed a short year and the range contract would
  // quietly under-deliver.
  const expectedDays: Record<string, number> = {
    "1m": 35,
    "3m": 102,
    "6m": 202,
    "1y": 384,
  };

  for (const [range, days] of Object.entries(expectedDays)) {
    const candles = spyCandles(tcsCandles);

    await fetchIndianHistorical(
      "TCS.NS",
      range as (typeof HISTORICAL_RANGES)[number],
      spyInstrument({ instrument_key: "NSE_EQ|INE467B01029" }).lookup,
      candles.lookup
    );

    assert.equal(candles.calls.length, 1);
    assert.equal(
      daysBetween(candles.calls[0].fromDate, candles.calls[0].toDate),
      days,
      `range ${range} asked for the wrong window`
    );
  }
});

test("'max' asks for the earliest history Upstox holds, not for everything", async () => {
  const candles = spyCandles(tcsCandles);

  await fetchIndianHistorical(
    "TCS.NS",
    "max",
    spyInstrument({ instrument_key: "NSE_EQ|INE467B01029" }).lookup,
    candles.lookup
  );

  const { fromDate, toDate } = candles.calls[0];
  const span = daysBetween(fromDate, toDate);

  // About nine years. Verified live: Upstox accepts a from_date ten years back
  // and refuses one older than that with HTTP 400 "Invalid date range", so this
  // stays a clear year inside that boundary instead of becoming a failing
  // request as the calendar advances.
  assert.ok(span >= 3280 && span <= 3295, `unexpected max window: ${span} days`);
});

test("the window is computed relative to today, so it cannot go stale", async () => {
  const candles = spyCandles(tcsCandles);

  await fetchIndianHistorical(
    "TCS.NS",
    "1m",
    spyInstrument({ instrument_key: "NSE_EQ|INE467B01029" }).lookup,
    candles.lookup
  );

  assert.equal(candles.calls[0].toDate, new Date().toISOString().split("T")[0]);
});

test("an omitted range uses the stock page's default window", async () => {
  // app/stock/[symbol]/page.tsx calls the service with a symbol only. Five years
  // is the widest span StockChart can ask for (its "5Y" button slices up to 1825
  // rows); it used to receive 365 bars, so that button could only draw a year.
  const candles = spyCandles(tcsCandles);

  await fetchIndianHistorical(
    "TCS.NS",
    undefined,
    spyInstrument({ instrument_key: "NSE_EQ|INE467B01029" }).lookup,
    candles.lookup
  );

  assert.equal(daysBetween(candles.calls[0].fromDate, candles.calls[0].toDate), 1825);
});

test("the global path is asked for no window at all, so TwelveData is unchanged", async () => {
  const global = spyGlobal(globalPayload(30));
  const instrument = spyInstrument(null);
  const candles = spyCandles(null);

  await fetchHistorical("AAPL", "1m", instrument.lookup, candles.lookup, global.lookup);

  assert.deepEqual(global.calls, ["AAPL"]);
  assert.equal(instrument.calls.length, 0);
  assert.equal(candles.calls.length, 0);
});

// --- Slicing ----------------------------------------------------------------

test("sliceByRange trims to the trading-day count for each range", () => {
  // Ascending, as normalizeHistorical produces. Slicing from the end keeps the
  // most recent sessions.
  const points: NormalizedHistoricalPoint[] = Array.from(
    { length: 300 },
    (_, index) => ({
      date: new Date(Date.UTC(2025, 0, 1) + index * 86400000)
        .toISOString()
        .slice(0, 10),
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: null,
    })
  );

  assert.equal(sliceByRange(points, "1m").length, 22);
  assert.equal(sliceByRange(points, "3m").length, 66);
  assert.equal(sliceByRange(points, "6m").length, 132);
  assert.equal(sliceByRange(points, "1y").length, 252);
  // "max" is bounded by MAX_POINTS. 300 points sits under that ceiling, so
  // nothing is trimmed here — the cap itself is covered below.
  assert.equal(sliceByRange(points, "max").length, 300);
  assert.equal(sliceByRange(points, undefined).length, 300);

  // The rows kept are the newest ones.
  assert.equal(sliceByRange(points, "1m")[21].date, points[299].date);
});

test("sliceByRange never invents points it was not given", () => {
  const points: NormalizedHistoricalPoint[] = [
    { date: "2026-09-25", open: 1, high: 1, low: 1, close: 1, volume: null },
  ];

  // Three sessions asked for, one available: one is the honest answer.
  assert.equal(sliceByRange(points, "1m").length, 1);
  assert.deepEqual(sliceByRange([], "1y"), []);
});

// --- The max cap ------------------------------------------------------------

/**
 * N ascending points ending 2026-09-29. `close` is the index, so a test can tell
 * exactly which points survived a slice.
 */
function ascendingPoints(n: number): NormalizedHistoricalPoint[] {
  return Array.from({ length: n }, (_, index) => ({
    date: new Date(Date.UTC(2026, 8, 29) - (n - 1 - index) * 86400000)
      .toISOString()
      .slice(0, 10),
    open: 1,
    high: 1,
    low: 1,
    close: index,
    volume: null,
  }));
}

/** The live nine-year Upstox window, measured: 2,227 candles for a large cap. */
const MAX_WINDOW_POINTS = 2227;

test("the cap is a named constant in a sane band", () => {
  // Named rather than a magic number, and exported, so this assertion and the
  // tool cannot disagree about it.
  assert.equal(typeof MAX_POINTS, "number");
  assert.equal(Number.isInteger(MAX_POINTS), true);
  // Above what "1y" returns, so "max" still means "more history than any other
  // range" and stays worth asking for.
  assert.ok(MAX_POINTS > 252, `cap ${MAX_POINTS} is not above the 1y count`);
  // ...and well below the ~2,227 candles a nine-year window holds.
  assert.ok(MAX_POINTS < MAX_WINDOW_POINTS, `cap ${MAX_POINTS} caps nothing`);
});

test("'max' is capped, so a nine-year payload cannot flood the context", () => {
  // 2,227 points serialise to roughly 203 KB / 58k tokens uncapped.
  assert.equal(sliceByRange(ascendingPoints(MAX_WINDOW_POINTS), "max").length, MAX_POINTS);
});

test("an omitted range is capped exactly like 'max'", () => {
  // The tool passes "max" explicitly for an omitted range, but sliceByRange is
  // exported and must not treat the two differently.
  assert.equal(
    sliceByRange(ascendingPoints(MAX_WINDOW_POINTS), undefined).length,
    MAX_POINTS
  );
});

test("the cap keeps the NEWEST points and stays chronological", () => {
  const points = ascendingPoints(MAX_WINDOW_POINTS);

  const capped = sliceByRange(points, "max");

  // Chronological order survives the cap: oldest first, as the description
  // promises. slice(-N) on an ascending array is what guarantees this.
  assert.deepEqual(
    capped.map((point) => point.date),
    [...capped.map((point) => point.date)].sort()
  );
  // The most recent point is still the last one...
  assert.equal(capped[capped.length - 1].date, points[points.length - 1].date);
  assert.equal(capped[capped.length - 1].close, MAX_WINDOW_POINTS - 1);
  // ...and the window is exactly the newest MAX_POINTS, so nothing is invented
  // at either edge and the oldest points are the ones dropped.
  assert.equal(capped[0].close, MAX_WINDOW_POINTS - MAX_POINTS);
  assert.equal(capped[0].date, points[points.length - MAX_POINTS].date);
});

test("1m/3m/6m/1y are untouched by the cap", () => {
  // The cap must change only what "max" returns.
  const points = ascendingPoints(MAX_WINDOW_POINTS);

  assert.equal(sliceByRange(points, "1m").length, 22);
  assert.equal(sliceByRange(points, "3m").length, 66);
  assert.equal(sliceByRange(points, "6m").length, 132);
  assert.equal(sliceByRange(points, "1y").length, 252);
  // Each of those is still the newest N, not the oldest.
  assert.equal(sliceByRange(points, "1y")[251].close, MAX_WINDOW_POINTS - 1);
  assert.equal(sliceByRange(points, "1y")[0].close, MAX_WINDOW_POINTS - 252);
});

test("a payload smaller than the cap is returned whole", () => {
  // The cap is a ceiling, not a target: it must not pad or repeat points to
  // reach MAX_POINTS.
  assert.equal(sliceByRange(ascendingPoints(300), "max").length, 300);
  assert.equal(sliceByRange([], "max").length, 0);
});

test("the cap applies at the end of a real Indian lookup, newest point intact", async () => {
  // End to end through the provider and the adapter with a nine-year payload:
  // the tool's own path is classifyHistorical() then sliceByRange().
  const rows: UpstoxCandleRow[] = Array.from(
    { length: MAX_WINDOW_POINTS },
    (_, index) => {
      const date = new Date(Date.UTC(2017, 8, 28) + index * 86400000)
        .toISOString()
        .slice(0, 10);

      return [`${date}T00:00:00+05:30`, 100, 101, 99, 100 + index, 1000, 0];
    }
  );

  const result = await fetchIndianHistorical(
    "TCS.NS",
    "max",
    spyInstrument({ instrument_key: "NSE_EQ|INE467B01029" }).lookup,
    spyCandles(rows).lookup
  );

  // The provider still returns the FULL history and is left alone: the cap is
  // the tool's, not the provider's, which is what keeps the stock page and
  // StockChart unchanged.
  assert.equal(result?.provider, "Upstox");
  assert.equal(result?.data.values.length, MAX_WINDOW_POINTS);

  const points = outcomePoints(classifyHistorical(result?.data));

  assert.equal(points.length, MAX_WINDOW_POINTS);

  const capped = sliceByRange(points, "max");

  assert.equal(capped.length, MAX_POINTS);
  assert.equal(capped[capped.length - 1].date, points[points.length - 1].date);
  assert.deepEqual(
    capped.map((point) => point.date),
    [...capped.map((point) => point.date)].sort()
  );
});

// --- The failure / empty / ok decision -------------------------------------

test("no payload at all is a failure", () => {
  assert.deepEqual(classifyHistorical(null), { status: "failure" });
  assert.deepEqual(classifyHistorical(undefined), { status: "failure" });
  assert.deepEqual(classifyHistorical("nonsense"), { status: "failure" });
  assert.deepEqual(classifyHistorical(42), { status: "failure" });
});

test("a payload with no values array is a failure", () => {
  // TwelveData reports an unusable symbol this way: HTTP 200 with an error body.
  assert.deepEqual(classifyHistorical({}), { status: "failure" });
  assert.deepEqual(classifyHistorical({ values: null }), { status: "failure" });
  assert.deepEqual(classifyHistorical({ values: "nope" }), { status: "failure" });
});

test("a genuinely empty values array is an answer, not a failure", () => {
  assert.deepEqual(classifyHistorical({ values: [] }), { status: "empty" });
});

test("rows that are all unusable are a failure, not an empty answer", () => {
  // This is the distinction that matters: reporting this as "no history" would
  // tell the model the stock simply has none.
  const unusable = {
    values: [{ datetime: "not a date", open: "x", high: "x", low: "x", close: "x" }],
  };

  assert.deepEqual(classifyHistorical(unusable), { status: "failure" });
});

test("a usable payload comes back ascending with YYYY-MM-DD dates", () => {
  const points = outcomePoints(
    classifyHistorical({
      values: [
        { datetime: "2026-09-25", open: "2", high: "2", low: "2", close: "2", volume: "1" },
        { datetime: "2026-09-23", open: "1", high: "1", low: "1", close: "1", volume: "1" },
      ],
    })
  );

  assert.deepEqual(
    points.map((point) => point.date),
    ["2026-09-23", "2026-09-25"]
  );
  assert.equal(points[0].close, 1);
  assert.equal(points[0].volume, 1);
});

// --- End to end through the real provider and adapter ----------------------

test("an Indian lookup yields agent-ready points, ascending, with no provider mixed in", async () => {
  const instrument = spyInstrument({ instrument_key: "NSE_EQ|INE467B01029" });
  const candles = spyCandles(tcsCandles);

  const result = await fetchIndianHistorical("TCS.NS", "1y", instrument.lookup, candles.lookup);
  const points = outcomePoints(classifyHistorical(result?.data));

  assert.deepEqual(
    points.map((point) => point.date),
    ["2026-09-23", "2026-09-24", "2026-09-25"]
  );

  const newest = points[2];

  assert.equal(newest.open, 2054);
  assert.equal(newest.high, 2090.2);
  assert.equal(newest.low, 2038.1);
  assert.equal(newest.close, 2082);
  assert.equal(newest.volume, 3342195);

  // The range trims the newest end, and nothing else.
  assert.equal(sliceByRange(points, "1m").length, 3);
});

test("the payload shape the stock page and StockChart consume is unchanged", async () => {
  // app/stock/[symbol]/page.tsx passes `historical?.values || []` straight to
  // StockChart, which reads item.datetime and Number(item.close). Neither file
  // is modified in this step, so this is the guarantee that they still work.
  const result = await fetchIndianHistorical(
    "INFY.NS",
    "1y",
    spyInstrument({ instrument_key: "NSE_EQ|INE009A01021" }).lookup,
    spyCandles(infyCandles).lookup
  );

  const values = result?.data.values || [];

  assert.equal(values.length, 3);

  for (const row of values) {
    assert.equal(typeof row.datetime, "string");
    assert.equal(Number.isNaN(Number(row.close)), false);
    assert.equal(Number.isNaN(Number(row.open)), false);
  }

  // StockChart slices from the front and reverses; the first row must be newest.
  assert.equal(values[0].datetime, "2026-09-25");
  assert.equal([...values].reverse()[0].datetime, "2026-09-23");
});

// --- Tool registration ------------------------------------------------------

test("the SOURCE label names no provider, because both are reachable", () => {
  // Half the symbols this tool handles come from Upstox and half from
  // TwelveData, so a label naming either one would be wrong most of the time.
  assert.equal(SOURCE, "StockSphere Historical Service");
  assert.equal(/twelve/i.test(SOURCE), false);
  assert.equal(/upstox/i.test(SOURCE), false);
});

test("the tool is registered under get_historical", async () => {
  const { getToolByName } = await import("../index");

  assert.equal(historicalTool.name, "get_historical");
  assert.equal(getToolByName("get_historical"), historicalTool);
  assert.equal(typeof historicalTool.execute, "function");
});

// --- The token, from the provider's side ------------------------------------

test(
  "a missing UPSTOX_ACCESS_TOKEN is thrown by the client and never escapes the provider",
  // The suite runs without .env.local, so the client captured no token and
  // throws before it can build a request. If a token is ever present in the
  // environment this case would make a real network call, so it stands down
  // rather than doing that.
  { skip: process.env.UPSTOX_ACCESS_TOKEN ? "UPSTOX_ACCESS_TOKEN is set" : false },
  async () => {
    const { getUpstoxHistoricalCandles } = await import("@/lib/apis/upstoxHistorical");

    // The client itself is loud about it, like the other Upstox clients.
    await assert.rejects(
      () => getUpstoxHistoricalCandles("NSE_EQ|INE467B01029", "2026-09-01", "2026-09-25"),
      /UPSTOX_ACCESS_TOKEN is missing/
    );

    // The provider turns it into an ordinary failure, so no tool ever sees it.
    assert.equal(
      await fetchIndianHistorical(
        "TCS.NS",
        "1m",
        spyInstrument({ instrument_key: "NSE_EQ|INE467B01029" }).lookup,
        getUpstoxHistoricalCandles
      ),
      null
    );
  }
);
