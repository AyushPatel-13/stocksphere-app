/**
 * The dashboard's daily briefing: a few plain sentences built only from data
 * the page already loaded. No AI and no estimates — a line whose data is
 * missing is left out rather than guessed.
 */

export type Breadth = {
  universe: string;
  advancing: number;
  declining: number;
  unchanged: number;
};

export type SymbolMove = { symbol: string; changePercent: number | null };

export type CurrencyPnl = {
  currency: string;
  dayChange: number | null;
  dayChangePercent: number | null;
};

export type BriefingInput = {
  breadth: Breadth | null;
  topGainer: SymbolMove | null;
  topLoser: SymbolMove | null;
  watchlist: SymbolMove[];
  portfolio: CurrencyPnl[];
  /** Holdings that could not be priced; their totals are then partial. */
  unpricedHoldings: number;
  openIpos: number;
  earningsThisWeek: string[];
};

const pct = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`;

export function buildBriefing(input: BriefingInput, formatMoney: (amount: number, currency: string) => string): string[] {
  const lines: string[] = [];

  const { breadth } = input;
  if (breadth && breadth.advancing + breadth.declining + breadth.unchanged > 0) {
    const mood =
      breadth.advancing > breadth.declining * 1.5
        ? "broadly up"
        : breadth.declining > breadth.advancing * 1.5
          ? "broadly down"
          : "mixed";
    lines.push(
      `${breadth.universe} was ${mood} in the latest session: ${breadth.advancing} advancing, ${breadth.declining} declining.`
    );
  }

  const movers: string[] = [];
  if (input.topGainer?.changePercent != null) movers.push(`${input.topGainer.symbol} led (${pct(input.topGainer.changePercent)})`);
  if (input.topLoser?.changePercent != null) movers.push(`${input.topLoser.symbol} lagged (${pct(input.topLoser.changePercent)})`);
  if (movers.length) lines.push(`${movers.join(" and ")}.`);

  const priced = input.watchlist.filter((s): s is { symbol: string; changePercent: number } => s.changePercent !== null);
  if (priced.length) {
    const up = priced.filter((s) => s.changePercent > 0).length;
    const down = priced.filter((s) => s.changePercent < 0).length;
    const best = priced.reduce((a, b) => (b.changePercent > a.changePercent ? b : a));
    const worst = priced.reduce((a, b) => (b.changePercent < a.changePercent ? b : a));
    let line = `Your watchlist: ${up} up, ${down} down.`;
    if (priced.length > 1) line += ` Best ${best.symbol} (${pct(best.changePercent)}), weakest ${worst.symbol} (${pct(worst.changePercent)}).`;
    lines.push(line);
  }

  if (input.unpricedHoldings === 0) {
    for (const total of input.portfolio) {
      if (total.dayChange === null) continue;
      const pctPart = total.dayChangePercent !== null ? ` (${pct(total.dayChangePercent)})` : "";
      const sign = total.dayChange >= 0 ? "+" : "−";
      lines.push(`Your ${total.currency} holdings moved ${sign}${formatMoney(Math.abs(total.dayChange), total.currency)}${pctPart} on the day.`);
    }
  }

  if (input.earningsThisWeek.length) {
    lines.push(`Earnings coming up for ${input.earningsThisWeek.slice(0, 4).join(", ")}${input.earningsThisWeek.length > 4 ? " and more" : ""}.`);
  }

  if (input.openIpos > 0) {
    lines.push(`${input.openIpos} IPO${input.openIpos === 1 ? " is" : "s are"} open for subscription.`);
  }

  return lines;
}
