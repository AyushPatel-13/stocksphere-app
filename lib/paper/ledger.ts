/**
 * Paper trading arithmetic. Pure: positions and P&L are always derived from
 * the immutable trade ledger, never stored, so they can be re-checked.
 *
 * Cost basis is the average-cost method: a sell realises
 * (sell price − average cost) × quantity and leaves the average unchanged.
 */

export type PaperSide = "buy" | "sell";
export type PaperAssetType = "stock" | "etf" | "crypto";
export type PaperCurrency = "INR" | "USD";

export const STARTING_CASH: Record<PaperCurrency, number> = { INR: 1_000_000, USD: 10_000 };
export const MAX_ORDER_VALUE: Record<PaperCurrency, number> = { INR: 1_000_000, USD: 10_000 };

export type PaperTrade = {
  id: string;
  assetType: PaperAssetType;
  symbol: string;
  side: PaperSide;
  quantity: number;
  price: number;
  currency: PaperCurrency;
  executedAt: string;
};

export type PaperPosition = {
  assetType: PaperAssetType;
  symbol: string;
  currency: PaperCurrency;
  quantity: number;
  averageCost: number;
  invested: number;
  realizedPnl: number;
};

const EPSILON = 1e-9;
const round = (value: number, decimals = 4) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/** Positions from trades in execution order. Closed positions are kept for their realised P&L. */
export function computePositions(trades: PaperTrade[]): PaperPosition[] {
  const ordered = [...trades].sort((a, b) => Date.parse(a.executedAt) - Date.parse(b.executedAt));
  const book = new Map<string, PaperPosition>();

  for (const trade of ordered) {
    const key = `${trade.assetType}|${trade.symbol}`;
    const position =
      book.get(key) ??
      { assetType: trade.assetType, symbol: trade.symbol, currency: trade.currency, quantity: 0, averageCost: 0, invested: 0, realizedPnl: 0 };

    if (trade.side === "buy") {
      const cost = position.averageCost * position.quantity + trade.price * trade.quantity;
      position.quantity += trade.quantity;
      position.averageCost = position.quantity > EPSILON ? cost / position.quantity : 0;
    } else {
      const sold = Math.min(trade.quantity, position.quantity);
      position.realizedPnl += (trade.price - position.averageCost) * sold;
      position.quantity -= sold;
      if (position.quantity <= EPSILON) {
        position.quantity = 0;
        position.averageCost = 0;
      }
    }

    position.invested = position.averageCost * position.quantity;
    book.set(key, position);
  }

  return Array.from(book.values()).map((p) => ({
    ...p,
    quantity: round(p.quantity, 8),
    averageCost: round(p.averageCost),
    invested: round(p.invested, 2),
    realizedPnl: round(p.realizedPnl, 2),
  }));
}

export type Valuation = {
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPct: number | null;
};

/** A position at a live price; null values when the price is unknown. */
export function valuePosition(position: PaperPosition, price: number | null): Valuation {
  if (price === null || !(price > 0) || position.quantity <= 0) {
    return { marketValue: position.quantity <= 0 ? 0 : null, unrealizedPnl: position.quantity <= 0 ? 0 : null, unrealizedPct: null };
  }
  const marketValue = price * position.quantity;
  const unrealizedPnl = marketValue - position.invested;
  return {
    marketValue: round(marketValue, 2),
    unrealizedPnl: round(unrealizedPnl, 2),
    unrealizedPct: position.invested > 0 ? round((unrealizedPnl / position.invested) * 100, 2) : null,
  };
}

export type OrderCheck =
  | { ok: true; value: { requestId: string; assetType: PaperAssetType; symbol: string; side: PaperSide; quantity: number } }
  | { ok: false; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SYMBOL = /^[A-Z0-9][A-Z0-9.&-]{0,19}$/;

export function checkOrder(raw: { requestId?: unknown; assetType?: unknown; symbol?: unknown; side?: unknown; quantity?: unknown }): OrderCheck {
  if (typeof raw.requestId !== "string" || !UUID.test(raw.requestId)) return { ok: false, reason: "Missing or invalid request id." };
  const assetType = (raw.assetType ?? "stock") as PaperAssetType;
  if (!["stock", "etf", "crypto"].includes(assetType)) return { ok: false, reason: "Paper trading covers stocks, ETFs and crypto." };
  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim().toUpperCase() : "";
  if (!SYMBOL.test(symbol)) return { ok: false, reason: "Pick something to trade." };
  if (raw.side !== "buy" && raw.side !== "sell") return { ok: false, reason: "Choose buy or sell." };

  const quantity = Number(raw.quantity);
  const problem = quantityProblem(assetType, quantity);
  if (problem) return { ok: false, reason: problem };

  return { ok: true, value: { requestId: raw.requestId.toLowerCase(), assetType, symbol, side: raw.side, quantity } };
}

/** Why a quantity can't be ordered, or null. Shared by the server check and the order ticket. */
export function quantityProblem(assetType: PaperAssetType, quantity: number): string | null {
  if (!Number.isFinite(quantity) || quantity <= 0) return "Enter a quantity above zero.";
  // Shares trade in whole units; crypto may be fractional (up to 8 decimals).
  if (assetType !== "crypto" && !Number.isInteger(quantity)) return "Shares trade in whole numbers.";
  if (assetType === "crypto" && Math.round(quantity * 1e8) / 1e8 !== quantity) return "Use at most 8 decimal places.";
  return null;
}
