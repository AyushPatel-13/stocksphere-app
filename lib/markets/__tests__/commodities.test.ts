import { test } from "node:test";
import assert from "node:assert/strict";

import { COMMODITIES, COMMODITY_CATEGORIES, findCommodity, isCommodityCategory } from "../../data/commodities";
import {
  contractMonth,
  filterByCategory,
  formatExpiry,
  formatLots,
  formatTradeTime,
  freshnessLabel,
  lotLabel,
  quoteUnitLabel,
} from "../commodities";

test("the filter categories are exactly the ones on the page, in order", () => {
  assert.deepEqual(COMMODITY_CATEGORIES, [
    "Crude Oil",
    "Natural Gas",
    "Gold",
    "Silver",
    "Copper",
    "Aluminium",
    "Zinc",
    "Electricity",
    "Nickel",
  ]);
});

test("every category has at least one verified MCX product, and symbols are unique", () => {
  for (const category of COMMODITY_CATEGORIES) {
    assert.ok(COMMODITIES.some((c) => c.category === category), category);
  }
  assert.equal(new Set(COMMODITIES.map((c) => c.symbol)).size, COMMODITIES.length);
  assert.ok(COMMODITIES.every((c) => c.exchange === "MCX"));
});

test("filterByCategory: All keeps everything, a category keeps only its rows", () => {
  assert.equal(filterByCategory(COMMODITIES, "All").length, COMMODITIES.length);
  assert.deepEqual(
    filterByCategory(COMMODITIES, "Gold").map((c) => c.symbol),
    ["GOLD", "GOLDM", "GOLDTEN", "GOLDGUINEA", "GOLDPETAL"]
  );
  assert.deepEqual(filterByCategory([], "Nickel"), []);
});

test("findCommodity is case-insensitive and rejects unknown symbols", () => {
  assert.equal(findCommodity("crudeoil")?.name, "Crude Oil");
  assert.equal(findCommodity("LEAD"), null);
  assert.ok(isCommodityCategory("Zinc"));
  assert.ok(!isCommodityCategory("Lead"));
});

test("quotation units", () => {
  assert.equal(quoteUnitLabel(findCommodity("CRUDEOIL")!.quoteUnit), "per bbl");
  assert.equal(quoteUnitLabel(findCommodity("GOLD")!.quoteUnit), "per 10 g");
  assert.equal(quoteUnitLabel(findCommodity("GOLDGUINEA")!.quoteUnit), "per 8 g");
  assert.equal(quoteUnitLabel(findCommodity("ELECDMBL")!.quoteUnit), "per MWh");
});

test("lot sizes come from Upstox's qty_multiplier × the quotation unit", () => {
  // Multipliers as Upstox returned them on 2026-10-24.
  assert.equal(lotLabel(findCommodity("CRUDEOIL")!.quoteUnit, 100), "100 bbl");
  assert.equal(lotLabel(findCommodity("GOLD")!.quoteUnit, 100), "1 kg");
  assert.equal(lotLabel(findCommodity("GOLDM")!.quoteUnit, 10), "100 g");
  assert.equal(lotLabel(findCommodity("SILVER100")!.quoteUnit, 10), "100 g");
  assert.equal(lotLabel(findCommodity("ALUMINIUM")!.quoteUnit, 5000), "5 tonne");
  assert.equal(lotLabel(findCommodity("NATURALGAS")!.quoteUnit, 1250), "1,250 mmBtu");
  assert.equal(lotLabel(findCommodity("CRUDEOIL")!.quoteUnit, null), null);
});

test("expiry and contract month labels", () => {
  assert.equal(formatExpiry("2026-11-19"), "19 Nov 2026");
  assert.equal(contractMonth("2026-11-19"), "Nov 26");
  assert.equal(formatExpiry("not a date"), "not a date");
});

test("volume in lots, and missing values stay missing", () => {
  assert.equal(formatLots(117371), "1,17,371 lots");
  assert.equal(formatLots(1), "1 lot");
  assert.equal(formatLots(null), "—");
});

test("trade times are shown in IST", () => {
  assert.equal(formatTradeTime("2026-10-23T17:59:58.000Z"), "23 Oct, 23:29 IST");
  assert.equal(formatTradeTime(null), null);
});

test("freshness labels distinguish live, last trade and unavailable", () => {
  assert.deepEqual(freshnessLabel({ status: "live", lastTradeTime: "2026-10-23T17:59:58.000Z" }), { label: "Live", tone: "live" });
  assert.deepEqual(freshnessLabel({ status: "last_trade", lastTradeTime: "2026-10-23T17:59:58.000Z" }), {
    label: "Last trade 23 Oct, 23:29 IST",
    tone: "stale",
  });
  assert.deepEqual(freshnessLabel({ status: "no_trades", lastTradeTime: null }), { label: "No trades yet", tone: "none" });
  assert.deepEqual(freshnessLabel(null), { label: "Quote unavailable", tone: "none" });
});
