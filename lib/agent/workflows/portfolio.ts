/**
 * Portfolio figures for the AI's portfolio review, computed here rather than
 * by the model: per-currency value and P/L, each holding's weight, and two
 * concentration measures. The model only interprets these numbers.
 *
 * Rupee and dollar holdings are never added together, and a holding that
 * couldn't be priced is listed as unpriced instead of being valued at zero.
 */

export type HoldingInput = { symbol: string; quantity: number; buyPrice: number };
export type PriceInput = { price: number; currency: string; changePercent: number | null; asOf: string | null };

export type HoldingFigures = {
  symbol: string;
  quantity: number;
  avgCost: number;
  price: number;
  value: number;
  invested: number;
  pnl: number;
  pnlPct: number | null;
  weightPct: number;
  dayChangePct: number | null;
  priceAsOf: string | null;
};

export type CurrencyFigures = {
  currency: string;
  holdings: HoldingFigures[];
  totalValue: number;
  totalInvested: number;
  totalPnl: number;
  totalPnlPct: number | null;
  largestHolding: { symbol: string; weightPct: number } | null;
  top3WeightPct: number;
  /** 1 / Σ(weight²): how many equal-sized holdings this spread is equivalent to. */
  effectiveHoldings: number;
};

export type PortfolioFigures = {
  byCurrency: CurrencyFigures[];
  unpriced: string[];
  holdingCount: number;
};

const round = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

export function analysePortfolio(holdings: HoldingInput[], prices: Record<string, PriceInput | null>): PortfolioFigures {
  const groups = new Map<string, Omit<HoldingFigures, "weightPct">[]>();
  const unpriced: string[] = [];

  for (const h of holdings) {
    const quote = prices[h.symbol];
    if (!quote || !(quote.price > 0) || !(h.quantity > 0)) {
      unpriced.push(h.symbol);
      continue;
    }
    const value = quote.price * h.quantity;
    const invested = h.buyPrice * h.quantity;
    const list = groups.get(quote.currency) ?? [];
    list.push({
      symbol: h.symbol,
      quantity: h.quantity,
      avgCost: h.buyPrice,
      price: quote.price,
      value,
      invested,
      pnl: value - invested,
      pnlPct: invested > 0 ? ((value - invested) / invested) * 100 : null,
      dayChangePct: quote.changePercent,
      priceAsOf: quote.asOf,
    });
    groups.set(quote.currency, list);
  }

  const byCurrency = Array.from(groups.entries()).map(([currency, list]) => {
    const totalValue = list.reduce((s, h) => s + h.value, 0);
    const totalInvested = list.reduce((s, h) => s + h.invested, 0);
    const withWeights = list
      .map((h) => ({ ...h, weightPct: totalValue > 0 ? (h.value / totalValue) * 100 : 0 }))
      .sort((a, b) => b.weightPct - a.weightPct);
    const hhi = withWeights.reduce((s, h) => s + (h.weightPct / 100) ** 2, 0);
    return {
      currency,
      holdings: withWeights.map((h) => ({
        ...h,
        value: round(h.value),
        invested: round(h.invested),
        pnl: round(h.pnl),
        pnlPct: h.pnlPct === null ? null : round(h.pnlPct),
        weightPct: round(h.weightPct),
        dayChangePct: h.dayChangePct === null ? null : round(h.dayChangePct),
      })),
      totalValue: round(totalValue),
      totalInvested: round(totalInvested),
      totalPnl: round(totalValue - totalInvested),
      totalPnlPct: totalInvested > 0 ? round(((totalValue - totalInvested) / totalInvested) * 100) : null,
      largestHolding: withWeights[0] ? { symbol: withWeights[0].symbol, weightPct: round(withWeights[0].weightPct) } : null,
      top3WeightPct: round(withWeights.slice(0, 3).reduce((s, h) => s + h.weightPct, 0)),
      effectiveHoldings: hhi > 0 ? round(1 / hhi, 1) : 0,
    };
  });

  return { byCurrency, unpriced, holdingCount: holdings.length };
}
