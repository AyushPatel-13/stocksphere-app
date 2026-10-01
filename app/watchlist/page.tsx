"use client";

import { useEffect, useState, type ReactNode } from "react";
import AuthGuard from "@/components/AuthGuard";
import { getWatchlist, removeFromWatchlist } from "@/lib/watchlist";
import WatchlistHeader from "@/components/Watchlist/WatchlistHeader";
import EmptyWatchlist from "@/components/Watchlist/EmptyWatchlist";
import WatchlistGrid from "@/components/Watchlist/WatchlistGrid";
import WatchlistCard from "@/components/Watchlist/WatchlistCard";

/**
 * Everything the watchlist needs that inline styles cannot express: hover,
 * focus-visible, the shimmer keyframes, the reduced-motion opt-out and the
 * breakpoint. Same palette and scale as the portfolio page's PF_STYLES — #111
 * surfaces on #222 borders, #2e2e2e on hover, #888 muted text, #22c55e for the
 * primary action, #4ade80 / #f87171 for gain and loss.
 *
 * The watchlist's four child components are only ever rendered inside this page
 * (nothing else imports them), so their class names live here with the shell
 * rather than in four more style blocks.
 */
const WL_STYLES = `
.wl-root {
  background: #000;
  color: #fff;
  /* The navbar is in the root layout and renders 65px: 64px from the h-16 class
     plus its own 1px bottom border. Subtracting 64 leaves 1px over. */
  min-height: calc(100vh - 65px);
  padding: 24px 16px 72px;
}
.wl-shell {
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
}

.wl-header {
  margin-bottom: 30px;
}
.wl-title {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.wl-subtitle {
  margin: 8px 0 0;
  color: #888;
  font-size: 15px;
}

.wl-grid {
  display: grid;
  /* min(100%, 340px) keeps the 340px cards on a wide screen, but lets the track
     collapse to one full-width column once the viewport is narrower than a card.
     The bare 340px floor could not shrink, so on a 390px screen the grid was
     40px of page padding plus 340px of card plus 40px of padding — wider than
     the viewport, which scrolled the whole page sideways. */
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
  gap: 20px;
}

.wl-card {
  display: flex;
  flex-direction: column;
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
  padding: 20px;
  transition: border-color 150ms ease, transform 150ms ease;
}
.wl-card:hover {
  border-color: #2e2e2e;
  transform: translateY(-2px);
}

.wl-monogram {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  margin-bottom: 16px;
  background: #1a1a1a;
  border: 1px solid #262626;
  border-radius: 50%;
  color: #fff;
  font-size: 20px;
  font-weight: 700;
}
.wl-name {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}
.wl-meta {
  margin: 5px 0 0;
  color: #888;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.wl-price {
  margin: 20px 0 0;
  font-size: 24px;
  font-weight: 700;
  line-height: 1.3;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.wl-price-missing {
  color: #8a8a8a;
  font-size: 15px;
  font-weight: 500;
}
.wl-change {
  margin: 4px 0 0;
  font-size: 14px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.wl-up { color: #4ade80; }
.wl-down { color: #f87171; }
.wl-flat { color: #888; }
.wl-sector {
  margin: 16px 0 0;
  color: #888;
  font-size: 13px;
}

/* The buttons sit at the bottom of the card, so a row of cards of different
   content heights still lines its actions up. */
.wl-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: auto;
  padding-top: 24px;
}
.wl-btn {
  width: 100%;
  padding: 12px;
  border: 1px solid transparent;
  border-radius: 10px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;
}
.wl-btn:active { transform: translateY(1px); }
/* Black on green-500, the same primary idiom as the navbar's Login button:
   around 13:1 against the green, where white would be under 2:1. */
.wl-btn-primary {
  background: #22c55e;
  color: #000;
}
.wl-btn-primary:hover { background: #1ea34d; }
.wl-btn-primary:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 2px;
}
.wl-btn-remove {
  background: #1a1a1a;
  border-color: #2a2a2a;
  color: #f87171;
}
.wl-btn-remove:hover {
  background: #2a1414;
  border-color: #4a2020;
}
.wl-btn-remove:focus-visible {
  outline: 2px solid #f87171;
  outline-offset: 2px;
}

.wl-empty {
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
  padding: 48px 24px;
  text-align: center;
}
.wl-empty-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.wl-empty-text {
  margin: 10px 0 0;
  color: #888;
  font-size: 14px;
}

/* Same surface as the portfolio's unavailable pill: this is a failed request,
   which is not the empty state and must not be dressed up as one. */
.wl-note {
  margin: 0;
  padding: 24px;
  background: #171717;
  border: 1px solid #262626;
  border-radius: 16px;
  color: #8a8a8a;
  font-size: 15px;
}

.wl-skeleton {
  display: block;
  border-radius: 8px;
  background: linear-gradient(90deg, #1b1b1b 25%, #2a2a2a 37%, #1b1b1b 63%);
  background-size: 400% 100%;
  animation: wl-shimmer 1.4s ease infinite;
}
@keyframes wl-shimmer {
  from { background-position: 100% 0; }
  to { background-position: 0 0; }
}
/* The loading placeholders wear the card's shape, but they are not cards and
   must not lift or light up when the pointer crosses them. */
.wl-card-loading { gap: 12px; }
.wl-card-loading:hover {
  border-color: #222;
  transform: none;
}
.wl-skeleton-circle {
  width: 52px;
  height: 52px;
  border-radius: 50%;
}
.wl-skeleton-line { width: 70%; height: 14px; }
.wl-skeleton-line-short { width: 45%; height: 12px; }
.wl-skeleton-price { width: 55%; height: 26px; margin-top: 8px; }

@media (min-width: 700px) {
  .wl-root { padding: 40px 32px 96px; }
  .wl-title { font-size: 32px; }
  .wl-card { padding: 22px; }
  .wl-empty { padding: 56px 40px; }
}

@media (prefers-reduced-motion: reduce) {
  .wl-skeleton {
    animation: none;
    background: #202020;
  }
  .wl-card, .wl-btn { transition: none; }
  .wl-card:hover { transform: none; }
}
`;

/**
 * The list's placeholder shape while getWatchlist() is in flight.
 *
 * Without this the page rendered the empty state for the whole round trip —
 * "No Watchlist Yet" shown to someone who has a watchlist, for as long as the
 * database took to answer.
 */
function WatchlistLoading() {
  return (
    <div
      className="wl-grid"
      role="status"
      aria-live="polite"
      aria-label="Loading your watchlist"
    >
      {[0, 1, 2].map((index) => (
        <div key={index} className="wl-card wl-card-loading" aria-hidden="true">
          <span className="wl-skeleton wl-skeleton-circle" />
          <span className="wl-skeleton wl-skeleton-line" />
          <span className="wl-skeleton wl-skeleton-line-short" />
          <span className="wl-skeleton wl-skeleton-price" />
        </div>
      ))}
    </div>
  );
}

/**
 * The "we could not get this" line.
 *
 * Deliberately not EmptyWatchlist. That one means the request succeeded and the
 * watchlist was genuinely empty; a failed request is neither empty nor still
 * pending, and must not be dressed up as either.
 */
function WatchlistNote({ children }: { children: ReactNode }) {
  return (
    <p className="wl-note" role="status">
      {children}
    </p>
  );
}

export default function WatchlistPage() {
  const [stocks, setStocks] = useState<string[]>([]);

  /**
   * stocks starts empty, and stays empty when the request fails. On its own it
   * cannot tell "still loading" from "could not load" from "genuinely empty",
   * so these two flags are what separate the three. Only ready-and-empty is an
   * empty watchlist.
   */
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const fetchWatchlist = async () => {
      try {
        const saved = await getWatchlist();

        setStocks(saved.map((item: any) => item.symbol));
      } catch (error) {
        // getWatchlist() is called exactly as it was before; this only
        // classifies the outcome. A rejection means the request never answered
        // at all.
        console.error("Watchlist load error:", error);

        setUnavailable(true);
      } finally {
        setLoading(false);
      }
    };

    fetchWatchlist();
  }, []);

  return (
    <AuthGuard>
      <div className="wl-root">
        <style>{WL_STYLES}</style>

        <div className="wl-shell">
          <WatchlistHeader />

          {loading ? (
            <WatchlistLoading />
          ) : unavailable ? (
            <WatchlistNote>
              Your watchlist could not be loaded right now.
            </WatchlistNote>
          ) : stocks.length === 0 ? (
            <EmptyWatchlist />
          ) : (
            <WatchlistGrid>
              {stocks.map((stock) => (
                <WatchlistCard
                  key={stock}
                  symbol={stock}
                  onRemove={async () => {
                    await removeFromWatchlist(stock);

                    setStocks(
                      stocks.filter(
                        (item) => item !== stock
                      )
                    );
                  }}
                />
              ))}
            </WatchlistGrid>
          )}
        </div>
      </div>
    </AuthGuard>
  );
}
