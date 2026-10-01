/**
 * Market News.
 *
 * The five headlines that used to be the page's entire content were hardcoded
 * placeholder copy naming Apple, Tesla, NVIDIA, Reliance and HDFC Bank
 * announcements. They were laid out as articles and read as live news, which
 * they were not, so they are gone rather than restyled — nothing here is
 * invented to take their place.
 *
 * There is no market-wide news feed in StockSphere: the only news path is
 * per-symbol — lib/providers/news.ts fetchNews() routes Indian tickers to
 * Upstox and global ones to Finnhub — and it is used by the stock detail page
 * for one ticker at a time. There is no /api/news route either. A market feed
 * would have to be built, so the page states that it is not available instead
 * of dressing placeholders up as it.
 *
 * The page shell, heading and spacing are unchanged; the note uses the same
 * treatment as Home's "Latest News" section, which is in the same position, so
 * the two read as the same component. The navbar lives in the root layout and
 * renders 65px (64px h-16 plus its own 1px border), so the shell subtracts 65,
 * not 64.
 */
export default function NewsPage() {
  return (
    <div className="min-h-[calc(100vh_-_65px)] bg-black text-white">
      {/* One centred shell, the same 1080px column the Home and Portfolio
          pages use, so the heading lines up with every other page. */}
      <div className="mx-auto w-full max-w-[1080px] px-4 pt-10 pb-24 sm:px-6 lg:px-8">
        <header className="mb-8">
          {/* Same page-title treatment as the sibling list page: the portfolio
              page's .pf-title is 26px / 700 / -0.02em, and Tailwind's
              tracking-tight is -0.025em. No invented size step. */}
          <h1 className="text-[26px] font-bold tracking-tight">
            📰 Market News
          </h1>
        </header>

        {/* Home's UnavailableNote, matched by hand: the two surfaces show the
            same state and must not drift. */}
        <p className="rounded-xl border border-[#2a2a2a] bg-[#151515] p-4 text-sm text-[#8a8a8a]">
          No market-wide news feed is available yet.
        </p>
      </div>
    </div>
  );
}
