/**
 * The page heading and its one line of context.
 *
 * The heading and the subtitle are the two strings this component already had,
 * unchanged. What changed is the type: 26px / 700 / -0.02em is the title
 * treatment the portfolio page uses, stepping to 32px at the same 700px
 * breakpoint. The old 34px was the browser's default h1 size, and it carried
 * the default h1 margins with it — which is why the header block sat lower
 * than its own margin-bottom implied.
 *
 * The class names are defined in the watchlist page's WL_STYLES.
 */
export default function WatchlistHeader() {
  return (
    <header className="wl-header">
      <h1 className="wl-title">⭐ My Watchlist</h1>

      <p className="wl-subtitle">
        Track your favourite companies in one place.
      </p>
    </header>
  );
}
