/**
 * Portfolio analytics from priced holdings. Pure, per currency (rupees and
 * dollars are never mixed, and no exchange rate is invented). Only holdings
 * with a current value are included; the caller says how many were left out.
 */

export type AnalyticsHolding = {
  symbol: string;
  currency: string;
  current: number;
  invested: number;
};

export type Allocation = { symbol: string; current: number; weightPct: number; pnl: number; pnlPct: number | null };

export type CurrencyAnalytics = {
  currency: string;
  total: number;
  holdings: number;
  allocations: Allocation[];
  /** Largest single holding, % of this currency's value. */
  topWeightPct: number;
  /** 1 ÷ Σ(weight²): how many equal-sized holdings this spread is worth. */
  effectiveHoldings: number;
  winners: number;
  losers: number;
  best: Allocation | null;
  worst: Allocation | null;
  /** Concentration note shown to the user; null when the spread is broad. */
  concentration: "single" | "high" | "moderate" | null;
};

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

export function analysePortfolio(holdings: AnalyticsHolding[]): CurrencyAnalytics[] {
  const byCurrency = new Map<string, AnalyticsHolding[]>();
  for (const h of holdings) {
    if (!(h.current >= 0) || !Number.isFinite(h.current)) continue;
    byCurrency.set(h.currency, [...(byCurrency.get(h.currency) ?? []), h]);
  }

  return Array.from(byCurrency.entries()).map(([currency, list]) => {
    const total = list.reduce((sum, h) => sum + h.current, 0);
    const allocations: Allocation[] = list
      .map((h) => {
        const pnl = h.current - h.invested;
        return {
          symbol: h.symbol,
          current: round(h.current),
          weightPct: total > 0 ? round((h.current / total) * 100) : 0,
          pnl: round(pnl),
          pnlPct: h.invested > 0 ? round((pnl / h.invested) * 100) : null,
        };
      })
      .sort((a, b) => b.current - a.current);

    const weights = allocations.map((a) => a.weightPct / 100);
    const hhi = weights.reduce((sum, w) => sum + w * w, 0);
    const topWeightPct = allocations[0]?.weightPct ?? 0;
    const withPct = allocations.filter((a) => a.pnlPct !== null);
    const byReturn = [...withPct].sort((a, b) => (b.pnlPct as number) - (a.pnlPct as number));

    return {
      currency,
      total: round(total),
      holdings: allocations.length,
      allocations,
      topWeightPct,
      effectiveHoldings: hhi > 0 ? round(1 / hhi, 1) : 0,
      winners: allocations.filter((a) => a.pnl > 0).length,
      losers: allocations.filter((a) => a.pnl < 0).length,
      best: byReturn[0] ?? null,
      worst: byReturn.length > 1 ? byReturn[byReturn.length - 1] : null,
      concentration: allocations.length === 1 ? "single" : topWeightPct >= 40 ? "high" : topWeightPct >= 25 ? "moderate" : null,
    };
  });
}
