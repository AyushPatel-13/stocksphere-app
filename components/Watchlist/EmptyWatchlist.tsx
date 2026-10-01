/**
 * The genuinely-empty watchlist — the request succeeded and there are no rows.
 *
 * Both strings are unchanged. The panel picks up the app's card treatment (a 1px
 * #222 border on the #111 surface, the 16px radius the other cards use) and the
 * heading drops from the browser's default h2 to the 18px the app's own section
 * headings use. Padding is 48px on a phone instead of a flat 60px, which at
 * 390px left very little room for the sentence inside it.
 *
 * The class names are defined in the watchlist page's WL_STYLES.
 */
export default function EmptyWatchlist() {
  return (
    <div className="wl-empty">
      <h2 className="wl-empty-title">No Watchlist Yet ⭐</h2>

      <p className="wl-empty-text">
        Search for stocks and add them to your watchlist.
      </p>
    </div>
  );
}
