import type { ReactNode } from "react";

import WatchlistButton from "../../WatchlistButton";
import RecentSearchTracker from "@/app/RecentSearchTracker";
import StockDiscussion
  from "@/app/StockDiscussion";
import BullBearVote
  from "@/app/BullBearVote";
import StockEvents from "@/app/StockEvents";
import StockHeader from "@/components/Stock/StockHeader";
import StockChart from "@/components/Stock/StockChart";
import CompanyOverview from "@/components/Stock/CompanyOverview";
import AgentAssistant from "@/components/Agent/AgentAssistant";
import { getPrice } from "@/lib/services/price";
import { getCompany } from "@/lib/services/company";
import { getHistorical } from "@/lib/services/historical";
import { getNews } from "@/lib/services/news";
import { getFinancials } from "@/lib/services/financials";
import {
  formatCurrency,
  formatLargeNumber,
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

.sp-actions { margin-top: 16px; }

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
  const quote =
    await getPrice(symbol);

  const company =
    await getCompany(symbol);

  const historical =
    await getHistorical(symbol)

  console.log(company);

  const news =
    await getNews(symbol);

  const financials =
    await getFinancials(symbol);

  console.log(financials);

  console.log("QUOTE:", quote);

  console.log(quote);
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

      <RecentSearchTracker symbol={symbol} />

      <div className="sp-shell">
        <header className="sp-hero">
          <div>
            <h1 className="sp-symbol">{symbol}</h1>

            {company?.name ? (
              <p className="sp-company">{company.name}</p>
            ) : null}
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
        </div>

        <AgentAssistant symbol={symbol} companyName={company?.name} />

        <BullBearVote symbol={symbol} />

        <StockDiscussion symbol={symbol} />

        <CompanyOverview company={company} />

        <div className="sp-section">
          <StockChart
            historicalData={
              historical?.values || []
            }
          />
        </div>

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
            value={formatLargeNumber(
              financials?.marketCap ?? null
            )}
          />

          <Stat
            label="52W High"
            value={financials?.week52High ?? "N/A"}
          />

          <Stat
            label="52W Low"
            value={financials?.week52Low ?? "N/A"}
          />

          <Stat
            label="P/E Ratio"
            value={financials?.pe?.toFixed(2) ?? "N/A"}
          />

          <Stat
            label="EPS"
            value={financials?.eps?.toFixed(2) ?? "N/A"}
          />

          <Stat
            label="Dividend Yield"
            value={formatPercent(
              financials?.dividendYield ?? null
            )}
          />
        </dl>

        <h2 className="sp-section-title">Latest News</h2>

        <div className="sp-news">
          {news.slice(0, 10).map((item: any) => (
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

        <StockEvents symbol={symbol} />
      </div>
    </div>
  );
}