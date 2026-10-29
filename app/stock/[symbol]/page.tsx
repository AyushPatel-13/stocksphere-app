import Link from "next/link";
import type { ReactNode } from "react";

import WatchlistButton from "../../WatchlistButton";
import RecentSearchTracker from "@/app/RecentSearchTracker";
import StockBoard from "@/components/Community/StockBoard";
import StockEvents from "@/app/StockEvents";
import StockHeader from "@/components/Stock/StockHeader";
import PriceChart from "@/components/Charts/PriceChart";
import TradePanel from "@/components/Stock/TradePanel";
import { exchangeLabel } from "@/lib/paper/ticket";
import CompanyOverview from "@/components/Stock/CompanyOverview";
import AgentAssistant from "@/components/Agent/AgentAssistant";
import { StockAvatar } from "@/components/Markets/StockBits";
import { getPrice } from "@/lib/services/price";
import { indianStockHref } from "@/lib/search/canonical";
import { retiredListing } from "@/lib/search/renames";
import { getCompany } from "@/lib/services/company";
import { getNews } from "@/lib/services/news";
import type { NewsArticle } from "@/lib/types/news";
import { getFinancials } from "@/lib/services/financials";
import { fiftyTwoWeekRange, getHistory, resolveAsset } from "@/lib/services/history";
import { getYahooDividends, getYahooFundamentals } from "@/lib/apis/yahooFundamentals";
import { getCompanySummary } from "@/lib/apis/wikipedia";
import { buildKeyStats, formatMarketCap } from "@/lib/services/keyStats";
import {
  formatCurrency,
  formatPercent,
  formatVolume,
} from "@/lib/utils/format";

/**
 * One key statistic: a small uppercase label over its value.
 *
 * Presentational only. Each value is the same expression the grid used to
 * render inline, including its own "N/A" fallback — nothing here decides what
 * a statistic is, only how the pair is laid out.
 */
/** "RELIANCE INDUSTRIES LTD" → "Reliance Industries Ltd" (provider names arrive in capitals). */
function titleCase(name: string): string {
  return name.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="sp-stat">
      <dt className="sp-stat-label">{label}</dt>
      <dd className="sp-stat-value">{value}</dd>
    </div>
  );
}

/**
 * Stock page styling.
 *
 * These are the states inline styles cannot express — hover, focus-visible, the
 * loading shimmer and the breakpoints — so they live in one scoped block, keyed
 * to sp- classes. The tokens are the ones the rest of the app uses: #111
 * surfaces on #222 borders, #888 muted text, #22c55e for a gain. The card
 * geometry (radius 16, 20px padding) is deliberately the same as the portfolio
 * page's, so the two read as one product.
 */
const SP_STYLES = `
.sp-root {
  background: #000;
  color: #fff;
  /* The navbar is in the root layout and renders 65px: 64px from the h-16 class
     plus its own 1px bottom border. Subtracting 64 leaves 1px over. */
  min-height: calc(100vh - 65px);
  padding: 24px 16px 72px;
}
.sp-shell {
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
}
/* The stock view is a terminal layout: chart left, trade panel right. */
.sp-shell.sp-wide { max-width: 1320px; }

/* ---------- section links ---------- */
.sp-tabs {
  display: flex;
  gap: 4px;
  margin-top: 30px;
  overflow-x: auto;
  border-bottom: 1px solid #222;
  scrollbar-width: none;
}
.sp-tabs a {
  flex-shrink: 0;
  margin-bottom: -1px;
  padding: 10px 12px;
  border-bottom: 2px solid transparent;
  color: #888;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
}
.sp-tabs a:hover { color: #fff; border-bottom-color: #22c55e; }
.sp-tabs a:focus-visible { outline: 2px solid #22c55e; outline-offset: -2px; border-radius: 6px; }
.sp-anchor { scroll-margin-top: 80px; }

/* ---------- header ---------- */
.sp-hero {
  display: flex;
  flex-direction: column;
  gap: 18px;
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
  padding: 20px;
}
.sp-symbol {
  margin: 0;
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  overflow-wrap: anywhere;
}
.sp-company {
  margin: 6px 0 0;
  color: #888;
  font-size: 15px;
}
.sp-quote {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.sp-price {
  margin: 0;
  font-size: 40px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.sp-price-missing {
  display: inline-block;
  margin: 0;
  padding: 6px 14px;
  background: #171717;
  border: 1px solid #262626;
  border-radius: 999px;
  color: #8a8a8a;
  font-size: 15px;
  font-weight: 500;
}
.sp-change {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 12px 0 0;
  padding: 4px 12px;
  border: 1px solid transparent;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.sp-change-pct { font-weight: 500; opacity: 0.85; }
.sp-up { color: #4ade80; }
.sp-down { color: #f87171; }
.sp-change.sp-up {
  background: rgba(34, 197, 94, 0.1);
  border-color: rgba(34, 197, 94, 0.3);
}
.sp-change.sp-down {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
}

.sp-actions { margin-top: 16px; display: flex; flex-wrap: wrap; align-items: flex-start; gap: 10px; }
.sp-alert-link {
  margin-top: 10px; display: inline-flex; align-items: center; gap: 6px;
  padding: 10px 18px; border-radius: 10px; border: 1px solid #2a2a2a;
  background: #151515; color: #e5e5e5; font-size: 14px; font-weight: 600; text-decoration: none;
  transition: background 150ms ease, border-color 150ms ease;
}
.sp-alert-link:hover { background: #1c1c1c; border-color: #3a3a3a; }
.sp-alert-link:focus-visible { outline: 2px solid #22c55e; outline-offset: 2px; }

/* ---------- sections ---------- */
.sp-section { margin-top: 30px; }
.sp-section-title {
  margin: 40px 0 18px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.sp-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 30px 0 0;
}
.sp-stat {
  min-width: 0;
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
  padding: 14px 16px;
  transition: border-color 150ms ease;
}
.sp-stat:hover { border-color: #2e2e2e; }
.sp-stat-label {
  margin-bottom: 6px;
  color: #777;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.sp-stat-value {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}

.sp-news {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
.sp-news-card {
  display: flex;
  flex-direction: column;
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
  overflow: hidden;
  transition: border-color 150ms ease, transform 150ms ease;
}
.sp-news-card:hover {
  border-color: #2e2e2e;
  transform: translateY(-2px);
}
.sp-news-image {
  display: block;
  width: 100%;
  height: 180px;
  object-fit: cover;
  background: #1a1a1a;
}
.sp-news-body { padding: 16px 18px; }
.sp-news-headline {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.sp-news-source {
  margin: 8px 0 0;
  color: #888;
  font-size: 13px;
}

.sp-empty {
  margin: 0;
  padding: 18px 20px;
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
  color: #888;
  font-size: 14px;
}

@media (min-width: 700px) {
  .sp-root { padding: 40px 32px 96px; }
  .sp-hero {
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
    gap: 28px;
    padding: 26px 28px;
  }
  .sp-quote { align-items: flex-end; }
  .sp-symbol { font-size: 34px; }
  .sp-price { font-size: 46px; }
  .sp-section-title { font-size: 26px; }
  .sp-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
}

@media (min-width: 1000px) {
  .sp-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
`;

export default async function StockPage({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  // Independent lookups, fetched together rather than one after another.
  // The year of daily bars is only for the 52-week range when the
  // fundamentals provider doesn't report one (it's cached by the history
  // service and shared with the chart's 1Y view).
  const asset = resolveAsset("stock", symbol);
  const [quote, company, news, financials, yearHistory] = await Promise.all([
    getPrice(symbol),
    getCompany(symbol),
    getNews(symbol),
    getFinancials(symbol),
    asset ? getHistory(asset, "1y").catch(() => null) : Promise.resolve(null),
  ]);
  const range52w = fiftyTwoWeekRange(yearHistory);

  // A listing that was renamed or demerged (an old link, a saved holding):
  // point to what trades now instead of a page no provider can price.
  const retired = quote ? null : retiredListing(decodeURIComponent(symbol));
  if (retired) {
    return (
      <div className="sp-root">
        <style>{SP_STYLES}</style>
        <div className="sp-shell">
          <div className="sp-hero" style={{ flexDirection: "column", alignItems: "flex-start", gap: "10px" }}>
            <h1 className="sp-symbol">{retired.symbol}</h1>
            <p style={{ color: "#aaa", margin: 0 }}>{retired.note}</p>
            <ul style={{ margin: 0, paddingLeft: "18px", display: "grid", gap: "6px" }}>
              {retired.successors.map((successor) => (
                <li key={successor.symbol}>
                  <Link href={indianStockHref(successor.symbol)} style={{ color: "#4ade80", fontSize: "14px" }}>
                    {successor.name} ({successor.symbol}) →
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // No provider knows this symbol at all: say so, instead of an empty page
  // full of "N/A" that reads like a broken stock.
  if (!quote && !company && !yearHistory) {
    return (
      <div className="sp-root">
        <style>{SP_STYLES}</style>
        <div className="sp-shell">
          <div className="sp-hero" style={{ flexDirection: "column", alignItems: "flex-start", gap: "10px" }}>
            <h1 className="sp-symbol">{decodeURIComponent(symbol).toUpperCase()}</h1>
            <p style={{ color: "#aaa", margin: 0 }}>
              We couldn&apos;t find this stock in any of our data sources. Check the ticker, or search by company name.
            </p>
            <p style={{ color: "#777", margin: 0, fontSize: "13px" }}>
              If it&apos;s a real listing, our providers may be temporarily unavailable — try again in a minute.
            </p>
            <Link href="/" style={{ color: "#4ade80", fontSize: "14px" }}>
              ← Back to search
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Figures the main providers don't carry (Upstox has no market cap, EPS,
  // dividends or descriptions): Yahoo fundamentals and dividends, and a
  // Wikipedia summary for the overview. Each is labelled with its source.
  const companyName = yearHistory?.name ?? (company?.name ? titleCase(company.name) : null);
  const [yahooFundamentals, dividends, wiki] = await Promise.all([
    asset ? getYahooFundamentals(asset.yahoo).catch(() => null) : Promise.resolve(null),
    asset ? getYahooDividends(asset.yahoo).catch(() => null) : Promise.resolve(null),
    !company?.description && companyName ? getCompanySummary(companyName).catch(() => null) : Promise.resolve(null),
  ]);
  const keyStats = buildKeyStats({
    price: typeof quote?.price === "number" ? quote.price : null,
    provider: financials,
    providerName: quote?.currency === "INR" ? "Upstox" : "Finnhub",
    yahoo: yahooFundamentals,
    dividends,
  });
  const statsCurrency = quote?.currency ?? asset?.currency ?? null;
  const overview = company
    ? { ...company, description: company.description || wiki?.text || "" }
    : wiki
      ? { symbol, name: companyName ?? symbol, exchange: "", country: "", currency: statsCurrency ?? "", sector: "", industry: "", marketCap: 0, logo: "", website: "", description: wiki.text }
      : null;
  // This page used to carry a hardcoded stockData table (ten entries: name,
  // price, change, and a description for four of them) plus a `stock` fallback
  // that read it. Both are gone. Prices and changes have come from the live
  // quote for a while, and CompanyOverview now takes the live company profile,
  // so the table's last property — a description for the four US symbols — was
  // the only thing it still supplied, and the live profile is the honest
  // source for that even when it comes back empty.
  const livePrice =
    quote?.price;

  const liveChange =
    quote?.change;

  const liveChangePercent =
    quote?.changePercent;

  const open = quote?.open;
  const high = quote?.high;
  const low = quote?.low;
  const volume = quote?.volume;
  const previousClose = quote?.previousClose;

  const currencySymbol =
    quote?.currency === "USD"
      ? "$"
      : "₹";

  // The change is rendered only when it is a real number. It used to be printed
  // unconditionally, so a quote that arrived without one rendered a bare "()"
  // in red underneath the price. The condition is on what can be displayed, not
  // on what was fetched: no quote value is altered or invented here.
  const changeValue = Number(liveChange);
  const changePercentValue = Number(liveChangePercent);

  const hasChange = Number.isFinite(changeValue);
  const changeIsUp = hasChange && changeValue >= 0;

  return (
    <div className="sp-root">
      <style>{SP_STYLES}</style>

      <RecentSearchTracker symbol={symbol} name={company?.name} />

      <div className="sp-shell sp-wide">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
        <header className="sp-hero">
          <div className="flex items-center gap-3">
            <StockAvatar symbol={decodeURIComponent(symbol)} size={48} />
            <div>
              <h1 className="sp-symbol">{symbol}</h1>

              <p className="sp-company">
                {company?.name ?? companyName}
                {(company?.name ?? companyName) ? " · " : ""}
                {exchangeLabel("stock", decodeURIComponent(symbol))}
              </p>
            </div>
          </div>

          <div className="sp-quote">
            {livePrice ? (
              <>
                <p className="sp-price">
                  {formatCurrency(
                    livePrice,
                    currencySymbol
                  )}
                </p>

                {hasChange ? (
                  <p
                    className={
                      "sp-change " +
                      (changeIsUp ? "sp-up" : "sp-down")
                    }
                  >
                    <span aria-hidden="true">
                      {changeIsUp ? "▲" : "▼"}
                    </span>
                    {`${changeIsUp ? "+" : ""}${changeValue.toFixed(2)}`}
                    {Number.isFinite(changePercentValue) ? (
                      <span className="sp-change-pct">
                        ({formatPercent(changePercentValue)})
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="sp-price-missing">
                Price unavailable
              </p>
            )}
          </div>
        </header>

        <div className="sp-actions">
          <WatchlistButton symbol={symbol} />
          <Link href={`/alerts?type=stock&symbol=${encodeURIComponent(symbol)}`} className="sp-alert-link">
            🔔 Set price alert
          </Link>
        </div>

        <div className="sp-section">
          <PriceChart type="stock" symbol={symbol} />
        </div>
          </div>

          {/* Paper trading and the user's recorded holdings; beside the chart
              on desktop, straight after it on a phone. */}
          <aside aria-label="Trade" className="min-w-0 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <TradePanel symbol={decodeURIComponent(symbol)} name={companyName ?? decodeURIComponent(symbol).toUpperCase()} />
          </aside>

          <div className="min-w-0 lg:col-start-1 lg:row-start-2">
        <nav aria-label="Sections" className="sp-tabs">
          <a href="#overview">Overview</a>
          <a href="#news">News</a>
          <a href="#community">Community</a>
          <a href="#events">Events</a>
        </nav>

        <div id="overview" className="sp-anchor">
        <h2 className="sp-section-title">Key stats</h2>
        <dl className="sp-stats">
          <Stat label="Open" value={open || "N/A"} />

          <Stat label="High" value={high || "N/A"} />

          <Stat label="Low" value={low || "N/A"} />

          <Stat
            label="Previous Close"
            value={previousClose || "N/A"}
          />

          <Stat
            label="Volume"
            value={formatVolume(volume ?? null)}
          />

          <Stat
            label="Market Cap"
            value={<span title={keyStats.marketCap?.source}>{formatMarketCap(keyStats.marketCap?.value ?? null, statsCurrency)}</span>}
          />

          <Stat
            label="52W High"
            value={financials?.week52High ?? range52w?.high ?? "N/A"}
          />

          <Stat
            label="52W Low"
            value={financials?.week52Low ?? range52w?.low ?? "N/A"}
          />

          <Stat
            label="P/E Ratio"
            value={<span title={keyStats.pe?.source}>{keyStats.pe ? keyStats.pe.value.toFixed(2) : "N/A"}</span>}
          />

          <Stat
            label="EPS (TTM)"
            value={<span title={keyStats.eps?.source}>{keyStats.eps ? formatCurrency(keyStats.eps.value, currencySymbol) : "N/A"}</span>}
          />

          <Stat
            label="Dividend Yield"
            value={<span title={keyStats.dividendYield?.source}>{formatPercent(keyStats.dividendYield?.value ?? null)}</span>}
          />
        </dl>

        <ul className="mt-3 space-y-0.5 text-[11px] leading-relaxed text-[#666]">
          {(
            [
              ["Market cap", keyStats.marketCap],
              ["P/E", keyStats.pe],
              ["EPS", keyStats.eps],
              ["Dividend yield", keyStats.dividendYield],
            ] as const
          )
            .filter(([, stat]) => stat !== null)
            .map(([label, stat]) => (
              <li key={label}>
                {label}: {stat!.source}
              </li>
            ))}
        </ul>

        <CompanyOverview company={overview} source={!company?.description && wiki ? { label: "Wikipedia", url: wiki.url } : null} />
        </div>

        <AgentAssistant symbol={symbol} companyName={company?.name} />

        <h2 id="news" className="sp-section-title sp-anchor">Latest News</h2>

        <div className="sp-news">
          {(news as NewsArticle[]).slice(0, 10).map((item) => (
            <article className="sp-news-card" key={item.id}>
              <img
                className="sp-news-image"
                src={item.image}
                alt={item.headline}
              />

              <div className="sp-news-body">
                <h3 className="sp-news-headline">{item.headline}</h3>

                <p className="sp-news-source">{item.source}</p>
              </div>
            </article>
          ))}

          {news.length === 0 ? (
            <p className="sp-empty">
              No recent news available for this symbol.
            </p>
          ) : null}
        </div>

        {/* Community board: sentiment from real posts, then the stock's
            discussion. Replaces the per-device BullBearVote and
            StockDiscussion, which nobody else could see. */}
        <div id="community" className="sp-anchor">
          <StockBoard symbol={symbol} />
        </div>

        <div id="events" className="sp-anchor">
          <StockEvents symbol={symbol} />
        </div>
          </div>
        </div>
      </div>
    </div>
  );
}