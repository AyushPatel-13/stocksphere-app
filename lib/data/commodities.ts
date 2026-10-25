/**
 * MCX commodity futures StockSphere lists, grouped by category.
 *
 * Every symbol is an Upstox `underlying_symbol` in the MCX_FO segment, checked
 * live against /v2/instruments/search and /v2/market-quote/quotes on
 * 2026-10-24. Contracts (expiries and instrument keys) are not listed here:
 * they roll every month and are looked up from Upstox at runtime.
 *
 * `quoteUnit` is what one quoted price buys. Upstox's `price_quote_unit` names the
 * unit but not the quantity (gold says "GRMS" whether it is quoted per gram or
 * per 10 grams), so the size comes from MCX's contract specifications and was
 * checked against live prices: GOLDPETAL ≈ ₹14,178 (per 1 g), GOLDGUINEA ≈
 * ₹1,13,298 (per 8 g, 8 × the petal price) and GOLD ≈ ₹1,42,150 (per 10 g).
 * Upstox's `qty_multiplier` is the number of these quote units in one lot, so
 * a lot's size is `qty_multiplier × quoteUnit.size` (GOLD: 100 × 10 g = 1 kg).
 */

export const COMMODITY_CATEGORIES = [
  "Crude Oil",
  "Natural Gas",
  "Gold",
  "Silver",
  "Copper",
  "Aluminium",
  "Zinc",
  "Electricity",
  "Nickel",
] as const;

export type CommodityCategory = (typeof COMMODITY_CATEGORIES)[number];

export type QuoteUnit = { size: number; unit: "bbl" | "mmBtu" | "g" | "kg" | "MWh" };

export type CommodityProduct = {
  /** Upstox underlying_symbol, also StockSphere's URL symbol. */
  symbol: string;
  name: string;
  category: CommodityCategory;
  exchange: "MCX";
  quoteUnit: QuoteUnit;
};

const product = (
  symbol: string,
  name: string,
  category: CommodityCategory,
  size: number,
  unit: QuoteUnit["unit"]
): CommodityProduct => ({ symbol, name, category, exchange: "MCX", quoteUnit: { size, unit } });

export const COMMODITIES: CommodityProduct[] = [
  product("CRUDEOIL", "Crude Oil", "Crude Oil", 1, "bbl"),
  product("CRUDEOILM", "Crude Oil Mini", "Crude Oil", 1, "bbl"),
  product("NATURALGAS", "Natural Gas", "Natural Gas", 1, "mmBtu"),
  product("NATGASMINI", "Natural Gas Mini", "Natural Gas", 1, "mmBtu"),
  product("GOLD", "Gold", "Gold", 10, "g"),
  product("GOLDM", "Gold Mini", "Gold", 10, "g"),
  product("GOLDTEN", "Gold Ten", "Gold", 10, "g"),
  product("GOLDGUINEA", "Gold Guinea", "Gold", 8, "g"),
  product("GOLDPETAL", "Gold Petal", "Gold", 1, "g"),
  product("SILVER", "Silver", "Silver", 1, "kg"),
  product("SILVERM", "Silver Mini", "Silver", 1, "kg"),
  product("SILVERMIC", "Silver Micro", "Silver", 1, "kg"),
  product("SILVER100", "Silver 100", "Silver", 10, "g"),
  product("COPPER", "Copper", "Copper", 1, "kg"),
  product("ALUMINIUM", "Aluminium", "Aluminium", 1, "kg"),
  product("ALUMINI", "Aluminium Mini", "Aluminium", 1, "kg"),
  product("ZINC", "Zinc", "Zinc", 1, "kg"),
  product("ZINCMINI", "Zinc Mini", "Zinc", 1, "kg"),
  product("ELECDMBL", "Electricity", "Electricity", 1, "MWh"),
  product("NICKEL", "Nickel", "Nickel", 1, "kg"),
];

export function findCommodity(symbol: string): CommodityProduct | null {
  const key = symbol.trim().toUpperCase();
  return COMMODITIES.find((entry) => entry.symbol === key) ?? null;
}

export function isCommodityCategory(value: string): value is CommodityCategory {
  return (COMMODITY_CATEGORIES as readonly string[]).includes(value);
}
