/**
 * Market Heatmap.
 *
 * The three tiles below are hardcoded placeholder content that predates this
 * change — they are the page's entire content and are reproduced verbatim.
 * This change is presentation only: the shell, heading, tiles, the responsive
 * grid, and the gain/loss colour treatment.
 *
 * What the original did express, and what is preserved exactly, is the mapping
 * of each tile to a direction: AAPL +1.2% and NVDA +2.4% were green, TSLA -0.8%
 * was red. The direction is still read off the sign that is already in the
 * string, so the mapping is identical — it is not recomputed from anything.
 * The colour itself moves from the raw CSS keywords green/red onto the app's
 * own gain/loss pair (#4ade80 / #f87171), which is the palette used by the
 * portfolio, stock and Home pages.
 *
 * There is no data source on this page to preserve. It fetches nothing. The
 * repo does have a real market-wide endpoint — /api/market/movers, backed by
 * getNifty50Quotes() — but it is consumed by the Home page, not here, and
 * pointing this page at it would be changing the data source and adding
 * functionality this page does not have. So there is no loading, empty or
 * unavailable state to style and no timeframe control to restyle: none of that
 * exists yet, and none of it is invented here.
 *
 * The navbar lives in the root layout and renders 65px (64px h-16 plus its own
 * 1px border), so the shell subtracts 65, not 64.
 */
const HEATMAP_STYLES = `
.hm-root {
  background: #000;
  color: #fff;
  min-height: calc(100vh - 65px);
}
/* Same centred 1080px column as Home, Portfolio and News. */
.hm-shell {
  max-width: 1080px;
  margin: 0 auto;
  padding: 40px 16px 96px;
}
.hm-title {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.hm-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  margin-top: 32px;
}
.hm-tile {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 8px;
  min-height: 132px;
  padding: 24px;
  border: 1px solid #222;
  border-radius: 16px;
  background: #111;
  transition: border-color 150ms ease, transform 150ms ease;
}
.hm-tile:hover {
  transform: translateY(-2px);
}
.hm-symbol {
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}
.hm-change {
  font-size: 15px;
  font-weight: 600;
}
.hm-tile--up {
  background: rgba(74, 222, 128, 0.1);
  border-color: rgba(74, 222, 128, 0.35);
}
.hm-tile--up:hover {
  border-color: rgba(74, 222, 128, 0.6);
}
.hm-tile--up .hm-change {
  color: #4ade80;
}
.hm-tile--down {
  background: rgba(248, 113, 113, 0.1);
  border-color: rgba(248, 113, 113, 0.35);
}
.hm-tile--down:hover {
  border-color: rgba(248, 113, 113, 0.6);
}
.hm-tile--down .hm-change {
  color: #f87171;
}
@media (min-width: 640px) {
  .hm-shell { padding-left: 24px; padding-right: 24px; }
  .hm-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
}
@media (min-width: 1024px) {
  .hm-shell { padding-left: 32px; padding-right: 32px; }
  .hm-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .hm-tile { transition: none; }
  .hm-tile:hover { transform: none; }
}
`;

export default function HeatmapPage() {
  const tiles = ["AAPL +1.2%", "NVDA +2.4%", "TSLA -0.8%"];

  return (
    <div className="hm-root">
      <style>{HEATMAP_STYLES}</style>

      <div className="hm-shell">
        <header>
          <h1 className="hm-title">🗺️ Market Heatmap</h1>
        </header>

        <div className="hm-grid">
          {tiles.map((tile) => {
            // Presentation split of the existing string: the same characters,
            // laid out as two lines so the symbol and the move can be weighted
            // differently. The sign is read, not recalculated.
            const cut = tile.lastIndexOf(" ");
            const symbol = tile.slice(0, cut);
            const change = tile.slice(cut + 1);
            const up = !change.startsWith("-");

            return (
              <article
                key={tile}
                className={`hm-tile ${up ? "hm-tile--up" : "hm-tile--down"}`}
              >
                <span className="hm-symbol">{symbol}</span>
                <span className="hm-change">{change}</span>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
