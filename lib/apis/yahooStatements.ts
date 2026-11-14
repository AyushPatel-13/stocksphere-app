import { fetchYahooJson } from "./yahooFundamentals";

/**
 * A company's income statement, balance sheet and cash flow, as reported:
 * the last four fiscal years and the last five quarters, from Yahoo
 * Finance's fundamentals-timeseries endpoint (the one the key stats already
 * use; it covers NSE and US listings and needs no cookie or crumb).
 *
 * Every figure is the reported one, in the currency the company reports in.
 * A line the source doesn't carry for a period is null, and a statement with
 * no figures at all is left out: nothing is estimated or carried forward.
 * Unofficial endpoint with no SLA, cached for 6 hours (it changes quarterly).
 */

export type StatementId = "income" | "balance" | "cashflow";

export type StatementLine = {
  id: string;
  label: string;
  statement: StatementId;
  /** Yahoo's field name, without the annual/quarterly prefix. */
  field: string;
  /** "money" is in the reporting currency; "perShare" is too, but is never abbreviated. */
  unit: "money" | "perShare";
};

export const STATEMENT_LINES: readonly StatementLine[] = [
  { id: "revenue", label: "Revenue", statement: "income", field: "TotalRevenue", unit: "money" },
  { id: "grossProfit", label: "Gross profit", statement: "income", field: "GrossProfit", unit: "money" },
  { id: "operatingIncome", label: "Operating income", statement: "income", field: "OperatingIncome", unit: "money" },
  { id: "netIncome", label: "Net income", statement: "income", field: "NetIncome", unit: "money" },
  { id: "eps", label: "Diluted EPS", statement: "income", field: "DilutedEPS", unit: "perShare" },
  { id: "totalAssets", label: "Total assets", statement: "balance", field: "TotalAssets", unit: "money" },
  { id: "totalLiabilities", label: "Total liabilities", statement: "balance", field: "TotalLiabilitiesNetMinorityInterest", unit: "money" },
  { id: "equity", label: "Shareholders' equity", statement: "balance", field: "StockholdersEquity", unit: "money" },
  { id: "totalDebt", label: "Total debt", statement: "balance", field: "TotalDebt", unit: "money" },
  { id: "cash", label: "Cash and equivalents", statement: "balance", field: "CashAndCashEquivalents", unit: "money" },
  { id: "operatingCashFlow", label: "Cash from operations", statement: "cashflow", field: "OperatingCashFlow", unit: "money" },
  { id: "capex", label: "Capital expenditure", statement: "cashflow", field: "CapitalExpenditure", unit: "money" },
  { id: "freeCashFlow", label: "Free cash flow", statement: "cashflow", field: "FreeCashFlow", unit: "money" },
];

export type StatementPeriod = {
  /** The period's end date, YYYY-MM-DD. */
  asOf: string;
  /** Line id → reported value; null when the source has no figure for this period. */
  values: Record<string, number | null>;
};

export type Statements = {
  /** The reporting currency (ISO code), when the source states one consistently. */
  currency: string | null;
  /** Oldest first. */
  annual: StatementPeriod[];
  quarterly: StatementPeriod[];
};

const MAX_ANNUAL = 4;
const MAX_QUARTERLY = 5;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

type Point = { asOfDate?: unknown; currencyCode?: unknown; reportedValue?: { raw?: unknown } } | null;

/** Turn a fundamentals-timeseries response into statements, or null when it carries no figures. */
export function parseStatements(body: unknown): Statements | null {
  const results = (body as { timeseries?: { result?: unknown[] } })?.timeseries?.result;
  if (!Array.isArray(results)) return null;

  const currencies = new Set<string>();
  const collect = (prefix: "annual" | "quarterly", keep: number): StatementPeriod[] => {
    const byDate = new Map<string, Record<string, number | null>>();
    for (const line of STATEMENT_LINES) {
      const series = results.find((row) => row && typeof row === "object" && Array.isArray((row as Record<string, unknown>)[`${prefix}${line.field}`])) as
        | Record<string, Point[]>
        | undefined;
      for (const point of series?.[`${prefix}${line.field}`] ?? []) {
        const asOf = point?.asOfDate;
        const raw = point?.reportedValue?.raw;
        if (typeof asOf !== "string" || !ISO_DAY.test(asOf) || typeof raw !== "number" || !Number.isFinite(raw)) continue;
        if (typeof point?.currencyCode === "string" && point.currencyCode) currencies.add(point.currencyCode);
        const values = byDate.get(asOf) ?? {};
        values[line.id] = raw;
        byDate.set(asOf, values);
      }
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-keep)
      .map(([asOf, values]) => ({
        asOf,
        values: Object.fromEntries(STATEMENT_LINES.map((line) => [line.id, values[line.id] ?? null])),
      }));
  };

  const annual = collect("annual", MAX_ANNUAL);
  const quarterly = collect("quarterly", MAX_QUARTERLY);
  if (annual.length === 0 && quarterly.length === 0) return null;
  // Two currencies in one answer would make the table's unit a lie: say none rather than pick.
  return { currency: currencies.size === 1 ? [...currencies][0] : null, annual, quarterly };
}

const CACHE_MS = 6 * 60 * 60_000;
const MAX_CACHE = 400;
const cache = new Map<string, { at: number; value: Statements }>();

export async function getYahooStatements(yahooSymbol: string, fetcher: typeof fetch = fetch, now: number = Date.now()): Promise<Statements | null> {
  const hit = cache.get(yahooSymbol);
  if (hit && now - hit.at < CACHE_MS) return hit.value;

  const types = STATEMENT_LINES.flatMap((line) => [`annual${line.field}`, `quarterly${line.field}`]);
  const params = new URLSearchParams({
    type: types.join(","),
    period1: String(Math.floor(now / 1000) - 6 * 366 * 86_400),
    period2: String(Math.floor(now / 1000)),
  });
  const body = await fetchYahooJson(
    `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(yahooSymbol)}?${params.toString()}`,
    fetcher
  );
  const value = body ? parseStatements(body) : null;
  // Failures and empty answers aren't cached, so a provider hiccup is retried on the next view.
  if (value) {
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
    cache.set(yahooSymbol, { at: now, value });
  }
  return value;
}

/* ------------------------------------------------------------ presentation */

/**
 * A reported amount the way each market writes it: ₹ crore / lakh crore for
 * rupees, M / B / T otherwise. Negative amounts keep their sign (capital
 * expenditure, a loss); "—" for a figure the source doesn't have.
 */
export function formatStatementMoney(value: number | null, currency: string | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (currency === "INR") {
    const crore = abs / 1e7;
    if (crore >= 1e5) return `${sign}₹${(crore / 1e5).toFixed(2)} L Cr`;
    return `${sign}₹${crore.toLocaleString("en-IN", { maximumFractionDigits: crore >= 100 ? 0 : 2 })} Cr`;
  }
  const symbol = currency === "USD" ? "$" : "";
  const suffix = symbol || !currency ? "" : ` ${currency}`;
  if (abs >= 1e12) return `${sign}${symbol}${(abs / 1e12).toFixed(2)}T${suffix}`;
  if (abs >= 1e9) return `${sign}${symbol}${(abs / 1e9).toFixed(2)}B${suffix}`;
  return `${sign}${symbol}${(abs / 1e6).toFixed(2)}M${suffix}`;
}

export function formatPerShare(value: number | null, currency: string | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const symbol = currency === "INR" ? "₹" : currency === "USD" ? "$" : "";
  return `${value < 0 ? "−" : ""}${symbol}${Math.abs(value).toFixed(2)}`;
}

/** Net income ÷ revenue for a period, as a percentage; null unless both are reported and revenue is positive. */
export function netMargin(period: StatementPeriod): number | null {
  const { revenue, netIncome } = period.values;
  return typeof revenue === "number" && typeof netIncome === "number" && revenue > 0 ? (netIncome / revenue) * 100 : null;
}

/** Change from the previous period, as a percentage; null without two positive, reported figures. */
export function growth(current: number | null, previous: number | null): number | null {
  return typeof current === "number" && typeof previous === "number" && previous > 0 && current >= 0 ? ((current - previous) / previous) * 100 : null;
}

/** "FY Mar 2026" for a fiscal year end, "Sep 2026" for a quarter end. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function periodLabel(asOf: string, kind: "annual" | "quarterly"): string {
  // Spelled out here: Intl month abbreviations differ between runtimes ("Sep" / "Sept").
  const month = `${MONTHS[Number(asOf.slice(5, 7)) - 1] ?? ""} ${asOf.slice(0, 4)}`.trim();
  return kind === "annual" ? `FY ${month}` : month;
}
