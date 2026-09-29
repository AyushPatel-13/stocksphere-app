import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidCompany } from "../companyTool";
import { normalizeUpstoxCompany } from "@/lib/adapters/company";
import {
  fetchCompany,
  type IndianEquitySearch,
} from "@/lib/providers/company";

const fullProfile = {
  symbol: "AAPL",
  name: "Apple Inc.",
  exchange: "NASDAQ",
  country: "US",
  currency: "USD",
  sector: "Technology",
  industry: "Consumer Electronics",
  marketCap: 1,
  logo: "",
  website: "",
  description: "",
};

test("isValidCompany accepts a profile with a non-empty name", () => {
  assert.equal(isValidCompany(fullProfile), true);
});

test("isValidCompany rejects null/undefined", () => {
  assert.equal(isValidCompany(null), false);
  assert.equal(isValidCompany(undefined), false);
});

test("isValidCompany rejects a blank name", () => {
  assert.equal(isValidCompany({ ...fullProfile, name: "" }), false);
  assert.equal(isValidCompany({ ...fullProfile, name: "   " }), false);
});

// --- Upstox company path (Indian symbols) -----------------------------------

// The verified Upstox instrument-search row for TCS. Upstox is an instrument
// master, so besides the name and exchange the row carries only trading
// metadata — no sector, industry, marketCap, website, logo or description.
const upstoxTcsRow = {
  name: "TATA CONSULTANCY SERV LT",
  segment: "NSE_EQ",
  exchange: "NSE",
  isin: "INE467B01029",
  instrument_key: "NSE_EQ|INE467B01029",
  exchange_token: "22",
  trading_symbol: "TCS",
  short_name: "TCS",
  tick_size: 5,
  lot_size: 1,
  instrument_type: "EQ",
  freeze_quantity: 0,
  qty_multiplier: 1,
  security_type: "NORMAL",
  cas_eligible: true,
};

test("normalizeUpstoxCompany maps the Upstox row onto every CompanyProfile field", () => {
  const result = normalizeUpstoxCompany(upstoxTcsRow, "TCS.NS");

  assert.equal(result.symbol, "TCS.NS");
  assert.equal(result.name, "TATA CONSULTANCY SERV LT");
  assert.equal(result.exchange, "NSE");
  assert.equal(result.currency, "INR");
  assert.equal(result.country, "India");
  assert.ok(Number.isNaN(result.marketCap));
  assert.equal(result.description, "");
  assert.equal(result.sector, "");
  assert.equal(result.industry, "");
  assert.equal(result.logo, "");
  assert.equal(result.website, "");
});

test("normalizeUpstoxCompany never exposes Upstox trading metadata", () => {
  const result = normalizeUpstoxCompany(upstoxTcsRow, "TCS.NS");

  // The profile has exactly the CompanyProfile contract's keys — the raw row
  // is never spread, so instrument_key, isin, exchange_token, tick_size,
  // lot_size and the rest cannot ride along.
  assert.deepEqual(Object.keys(result).sort(), [
    "country",
    "currency",
    "description",
    "exchange",
    "industry",
    "logo",
    "marketCap",
    "name",
    "sector",
    "symbol",
    "website",
  ]);

  // Belt and braces: no field may carry an instrument-key or ISIN *value*.
  const values = Object.values(result).map((value) => String(value));
  assert.equal(values.some((value) => value.includes("NSE_EQ")), false);
  assert.equal(values.some((value) => value.includes("INE467B01029")), false);
});

test("normalizeUpstoxCompany's NaN marketCap serializes to null for the agent", () => {
  // orchestrator.ts JSON.stringify()es the ToolResult and JSON has no NaN, so
  // the agent sees "not reported" rather than a bogus number.
  const result = normalizeUpstoxCompany(upstoxTcsRow, "TCS.NS");

  assert.equal(
    JSON.stringify({ marketCap: result.marketCap }),
    '{"marketCap":null}'
  );
});

/** Fake Indian equity search; records the queries it received. */
function fakeIndianSearch(
  row: { name?: string; exchange?: string } | null
) {
  const queries: string[] = [];
  const search: IndianEquitySearch = async (symbol) => {
    queries.push(symbol);
    return row;
  };
  return { search, queries };
}

test("fetchCompany sends an Indian symbol to Upstox under its bare NSE symbol", async () => {
  const { search, queries } = fakeIndianSearch({
    name: "TATA CONSULTANCY SERV LT",
    exchange: "NSE",
  });

  const result = await fetchCompany("TCS.NS", search);

  assert.equal(result?.provider, "Upstox");
  assert.equal(result?.data.symbol, "TCS.NS");
  assert.equal(result?.data.name, "TATA CONSULTANCY SERV LT");
  assert.equal(result?.data.exchange, "NSE");
  assert.equal(result?.data.currency, "INR");
  // The suffix is dropped for the Upstox lookup itself and never travels
  // further: Upstox matches on the NSE trading symbol exactly.
  assert.deepEqual(queries, ["TCS"]);
});

test("fetchCompany does not let a missing UPSTOX_ACCESS_TOKEN escape", async () => {
  // searchUpstoxEquity() throws when the token is absent. Upstox is a tier
  // rather than a terminal branch, so after the throw is swallowed the call
  // falls through to the same providers it always consulted — which is what
  // makes this assertable without a token, online or off.
  const throwing: IndianEquitySearch = async () => {
    throw new Error(
      "UPSTOX_ACCESS_TOKEN is missing from environment variables"
    );
  };

  await assert.doesNotReject(() => fetchCompany("TCS.NS", throwing));
});
