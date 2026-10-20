/**
 * A simple, transparent backtester for one instrument on closing prices.
 *
 * Strategies:
 *   buy_hold     buy on the first bar, hold to the end
 *   sma_cross    hold while the fast SMA is above the slow SMA
 *   above_sma    hold while the close is above an SMA
 *
 * Rules, stated so results can be reproduced:
 *   - signals use bar i's close and are acted on at bar i+1's close
 *     (no look-ahead); a position still open at the end is valued at the
 *     last close
 *   - long only, fully invested or fully in cash, no leverage
 *   - a cost (default 0.1%) is charged on every buy and every sell
 *   - no dividends, taxes or slippage beyond that cost
 *
 * Past results don't predict future ones; the page says so.
 */

export type Strategy = { kind: "buy_hold" } | { kind: "sma_cross"; fast: number; slow: number } | { kind: "above_sma"; period: number };

export type Bar = { t: number; c: number };

export type BacktestTrade = { entryT: number; entryPrice: number; exitT: number; exitPrice: number; returnPct: number; open: boolean };

export type BacktestResult = {
  strategy: Strategy;
  bars: number;
  startT: number;
  endT: number;
  totalReturnPct: number;
  cagrPct: number | null;
  maxDrawdownPct: number;
  trades: BacktestTrade[];
  winRatePct: number | null;
  exposurePct: number;
  buyHoldReturnPct: number;
  equity: { t: number; value: number }[];
};

export type BacktestError = { error: string };

export const MAX_SMA = 200;

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function validate(strategy: Strategy): string | null {
  if (strategy.kind === "sma_cross") {
    const { fast, slow } = strategy;
    if (!Number.isInteger(fast) || !Number.isInteger(slow) || fast < 2 || slow > MAX_SMA || fast >= slow) {
      return `Use whole numbers with 2 ≤ fast < slow ≤ ${MAX_SMA}.`;
    }
  }
  if (strategy.kind === "above_sma") {
    if (!Number.isInteger(strategy.period) || strategy.period < 2 || strategy.period > MAX_SMA) return `Use a period from 2 to ${MAX_SMA}.`;
  }
  return null;
}

/** Desired position (in or out) after each bar's close. */
function signals(closes: number[], strategy: Strategy): boolean[] {
  if (strategy.kind === "buy_hold") return closes.map(() => true);
  if (strategy.kind === "above_sma") {
    const avg = sma(closes, strategy.period);
    return closes.map((c, i) => avg[i] !== null && c > (avg[i] as number));
  }
  const fast = sma(closes, strategy.fast);
  const slow = sma(closes, strategy.slow);
  return closes.map((_, i) => fast[i] !== null && slow[i] !== null && (fast[i] as number) > (slow[i] as number));
}

export function runBacktest(input: Bar[], strategy: Strategy, costPct = 0.1): BacktestResult | BacktestError {
  const problem = validate(strategy);
  if (problem) return { error: problem };
  if (!(costPct >= 0 && costPct <= 5)) return { error: "Cost must be between 0% and 5%." };

  const bars = input.filter((b) => Number.isFinite(b.c) && b.c > 0).sort((a, b) => a.t - b.t);
  const needed = strategy.kind === "sma_cross" ? strategy.slow + 2 : strategy.kind === "above_sma" ? strategy.period + 2 : 2;
  if (bars.length < needed) return { error: `Not enough history: ${bars.length} bars, this strategy needs at least ${needed}.` };

  const closes = bars.map((b) => b.c);
  const want = signals(closes, strategy);
  const cost = costPct / 100;

  let cash = 1;
  let units = 0;
  let inBars = 0;
  let peak = 1;
  let maxDrawdown = 0;
  const trades: BacktestTrade[] = [];
  const equity: { t: number; value: number }[] = [];
  let open: { t: number; price: number; equity: number } | null = null;

  for (let i = 0; i < bars.length; i++) {
    const price = closes[i];

    // Act at this close on the previous bar's signal (buy-and-hold enters on bar 0).
    const target = strategy.kind === "buy_hold" ? true : i > 0 ? want[i - 1] : false;

    if (target && units === 0) {
      units = (cash * (1 - cost)) / price;
      open = { t: bars[i].t, price, equity: cash };
      cash = 0;
    } else if (!target && units > 0 && open) {
      cash = units * price * (1 - cost);
      units = 0;
      trades.push({ entryT: open.t, entryPrice: open.price, exitT: bars[i].t, exitPrice: price, returnPct: (cash / open.equity - 1) * 100, open: false });
      open = null;
    }

    if (units > 0) inBars++;
    const value = cash + units * price;
    equity.push({ t: bars[i].t, value });
    peak = Math.max(peak, value);
    maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak);
  }

  const last = bars[bars.length - 1];
  const finalValue = equity[equity.length - 1].value;
  if (open) {
    trades.push({ entryT: open.t, entryPrice: open.price, exitT: last.t, exitPrice: last.c, returnPct: (finalValue / open.equity - 1) * 100, open: true });
  }

  const years = (last.t - bars[0].t) / (365.25 * 86_400_000);
  const closed = trades.filter((t) => !t.open);
  const round = (v: number) => Math.round(v * 100) / 100;

  return {
    strategy,
    bars: bars.length,
    startT: bars[0].t,
    endT: last.t,
    totalReturnPct: round((finalValue - 1) * 100),
    // A year of daily bars spans ~364 days; annualise from 0.95 years up.
    cagrPct: years >= 0.95 ? round((Math.pow(finalValue, 1 / years) - 1) * 100) : null,
    maxDrawdownPct: round(maxDrawdown * 100),
    trades: trades.map((t) => ({ ...t, returnPct: round(t.returnPct) })),
    winRatePct: closed.length > 0 ? round((closed.filter((t) => t.returnPct > 0).length / closed.length) * 100) : null,
    exposurePct: round((inBars / bars.length) * 100),
    buyHoldReturnPct: round((closes[closes.length - 1] / closes[0] - 1) * 100),
    equity: equity.map((e) => ({ t: e.t, value: round(e.value * 100) / 100 })),
  };
}
