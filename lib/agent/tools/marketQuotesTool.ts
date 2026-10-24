import { z } from "zod";

import { getLiveIndices, type IndicesSnapshot } from "@/lib/services/indices";
import { getAssetBoard, type AssetBoard, type HubType } from "@/lib/services/assetBoard";
import { ToolDefinition, failResult, okResult } from "../types";

/**
 * Live quotes for what isn't a single stock: market indices (Indian sector
 * indices included), crypto, ETFs and bonds — the same data the Indices,
 * Crypto, ETFs and Bonds pages show. Only the catalog those pages track is
 * covered; anything else comes back in `notCovered` so the answer can say so.
 */

const KINDS = ["indices", "crypto", "etf", "bond"] as const;
type Kind = (typeof KINDS)[number];

const SOURCES: Record<Kind, string> = {
  indices: "Upstox (Indian indices) + Yahoo Finance (global indices)",
  crypto: "Yahoo Finance (crypto)",
  etf: "Yahoo Finance (ETFs)",
  bond: "Yahoo Finance (Treasury yields, bond ETFs)",
};

const argsSchema = z.object({
  kind: z.enum(KINDS),
  symbols: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
  currency: z.enum(["INR", "USD"]).optional(),
});

export type MarketQuotesArgs = z.infer<typeof argsSchema>;

export type MarketQuoteRow = {
  symbol: string;
  name: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  /** "percent" means price is a yield in %, not a currency amount. */
  unit: string;
  currency: string | null;
  asOf: string | null;
};

export type MarketQuotesResult = {
  kind: Kind;
  quotes: MarketQuoteRow[];
  notCovered: string[];
  covered: string;
  fetchedAt: string;
};

export interface MarketQuotesDeps {
  indices: () => Promise<IndicesSnapshot>;
  board: (type: HubType, vs: "INR" | "USD") => Promise<AssetBoard>;
}

const DEFAULT_DEPS: MarketQuotesDeps = { indices: getLiveIndices, board: getAssetBoard };

// Common ways people name the tracked indices.
const INDEX_ALIASES: Record<string, string> = {
  "NIFTY 50": "NIFTY", NIFTY50: "NIFTY", "BANK NIFTY": "BANKNIFTY", "NIFTY BANK": "BANKNIFTY",
  "NIFTY IT": "NIFTYIT", "NIFTY PHARMA": "NIFTYPHARMA", "NIFTY METAL": "NIFTYMETAL", "NIFTY FMCG": "NIFTYFMCG",
  "NIFTY NEXT 50": "NIFTYNEXT50", BSE: "SENSEX", "S&P 500": "SPX", "S&P": "SPX", SP500: "SPX", "S&P500": "SPX",
  "DOW JONES": "DOW", DJIA: "DOW", NASDAQ: "NASDAQ100", "NASDAQ 100": "NASDAQ100", NDX: "NASDAQ100",
  "NIKKEI 225": "NIKKEI", "HANG SENG": "HANGSENG", "FTSE 100": "FTSE", "CAC 40": "CAC40", CAC: "CAC40",
  BITCOIN: "BTC", ETHEREUM: "ETH", SOLANA: "SOL", DOGECOIN: "DOGE", CARDANO: "ADA", RIPPLE: "XRP",
  "10Y": "US10Y", "10-YEAR": "US10Y", "US 10 YEAR": "US10Y", "30Y": "US30Y", "5Y": "US5Y", "3M": "US3M",
};

function key(value: string): string {
  return value.toUpperCase().replace(/\.NS$/, "").replace(/^\^/, "").trim();
}

function matches(row: MarketQuoteRow, wanted: string): boolean {
  const k = key(wanted);
  const target = INDEX_ALIASES[k] ?? k;
  const compact = (s: string) => s.toUpperCase().replace(/[^A-Z0-9&]/g, "");
  return key(row.symbol) === target || compact(row.name) === compact(wanted) || compact(row.symbol) === compact(target);
}

export async function runMarketQuotes(args: MarketQuotesArgs, deps: MarketQuotesDeps = DEFAULT_DEPS): Promise<MarketQuotesResult | null> {
  let rows: MarketQuoteRow[];
  let fetchedAt: string;

  if (args.kind === "indices") {
    const snapshot = await deps.indices();
    fetchedAt = snapshot.fetchedAt;
    rows = snapshot.indices.map((i) => ({
      symbol: i.symbol,
      name: i.name,
      price: i.price,
      change: i.change,
      changePercent: i.changePercent,
      unit: "points",
      currency: null,
      asOf: i.lastUpdated,
    }));
  } else {
    const board = await deps.board(args.kind, args.currency ?? (args.kind === "crypto" ? "USD" : "INR"));
    fetchedAt = board.fetchedAt;
    rows = board.items.map((i) => ({
      symbol: i.symbol,
      name: i.name,
      price: i.price,
      change: i.change,
      changePercent: i.changePercent,
      unit: i.unit,
      currency: i.unit === "percent" ? null : i.currency,
      asOf: i.marketTime,
    }));
  }

  if (rows.every((r) => r.price === null)) return null;

  const wanted = args.symbols ?? [];
  const picked = wanted.length > 0 ? rows.filter((r) => wanted.some((w) => matches(r, w))) : rows;
  const round = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

  return {
    kind: args.kind,
    quotes: picked.map((r) => ({ ...r, price: round(r.price), change: round(r.change), changePercent: round(r.changePercent) })),
    notCovered: wanted.filter((w) => !rows.some((r) => matches(r, w))),
    covered: rows.map((r) => r.symbol).join(", "),
    fetchedAt,
  };
}

export const marketQuotesTool: ToolDefinition<MarketQuotesArgs, MarketQuotesResult> = {
  name: "get_market_quotes",
  description:
    "Live quotes beyond single stocks. indices: NIFTY, SENSEX, BANKNIFTY, NIFTYIT, NIFTYPHARMA, NIFTYMETAL, NIFTYFMCG, NIFTYNEXT50, DOW, SPX, NASDAQ100, NIKKEI, HANGSENG, DAX, FTSE, CAC40. crypto: BTC, ETH, SOL, XRP, DOGE and other majors. etf: NIFTYBEES, BANKBEES, GOLDBEES, SPY, VOO, QQQ and others. bond: US3M/US5Y/US10Y/US30Y yields (price is a yield in %) and Indian gilt ETFs. Untracked names come back in notCovered.",
  parameters: {
    type: "object",
    properties: {
      kind: { type: "string", enum: [...KINDS], description: "Which market." },
      symbols: { type: "array", items: { type: "string" }, description: "Symbols or names, e.g. ['NIFTY','SENSEX'], ['BTC'], ['US10Y']. Omit for all." },
      currency: { type: "string", enum: ["INR", "USD"], description: "Crypto only: quote currency (default USD)." },
    },
    required: ["kind"],
  },
  argsSchema,
  async execute(args) {
    const source = SOURCES[args.kind];
    try {
      const result = await runMarketQuotes(args);
      return result ? okResult(result, source) : failResult(source);
    } catch {
      return failResult(source);
    }
  },
};
