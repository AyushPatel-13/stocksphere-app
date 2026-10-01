/**
 * The stock page's loading state.
 *
 * The page is a server component that awaits five provider calls before it can
 * render a single element, and there was no loading boundary anywhere in the
 * app, so a navigation to it showed the previous screen until every call had
 * returned. This is the fallback for that gap: the same shell, hero, chart,
 * statistic and news shapes the page settles into, drawn as shimmering
 * placeholders so the layout does not jump when the real values arrive.
 *
 * It renders no data at all — a skeleton is a shape, not a stand-in price, and
 * nothing here can be mistaken for a quote.
 */
const LOADING_STYLES = `
.sp-root {
  background: #000;
  color: #fff;
  /* Same shell rule as the page it stands in for: the navbar renders 65px, so
     the skeleton must not reserve the full viewport height and scroll by 65. */
  min-height: calc(100vh - 65px);
  padding: 24px 16px 72px;
}
.sp-shell {
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
}
.sp-card {
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
  padding: 20px;
}
.sp-hero {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.sp-skel {
  display: block;
  border-radius: 8px;
  background: linear-gradient(90deg, #1b1b1b 25%, #2a2a2a 37%, #1b1b1b 63%);
  background-size: 400% 100%;
  animation: sp-shimmer 1.4s ease infinite;
}
@keyframes sp-shimmer {
  from { background-position: 100% 0; }
  to { background-position: 0 0; }
}
.sp-gap-sm { margin-top: 12px; }
.sp-gap-md { margin-top: 30px; }
.sp-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 30px;
}
.sp-stat {
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
  padding: 14px 16px;
}
.sp-chart {
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
  padding: 24px;
  margin-top: 30px;
}
.sp-news {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin-top: 30px;
}
.sp-news-card {
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
  padding: 16px 18px;
}
@media (prefers-reduced-motion: reduce) {
  .sp-skel { animation: none; background: #202020; }
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
  .sp-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
}
@media (min-width: 1000px) {
  .sp-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
`;

function Bar({
  height,
  width,
}: {
  height: number;
  width: string;
}) {
  return <span className="sp-skel" style={{ height, width }} />;
}

export default function StockLoading() {
  return (
    <div className="sp-root">
      <style>{LOADING_STYLES}</style>

      <div className="sp-shell" role="status" aria-label="Loading stock data">
        <div className="sp-card sp-hero">
          <div>
            <Bar height={34} width="180px" />

            <div className="sp-gap-sm">
              <Bar height={16} width="120px" />
            </div>
          </div>

          <div>
            <Bar height={44} width="220px" />

            <div className="sp-gap-sm">
              <Bar height={20} width="130px" />
            </div>
          </div>
        </div>

        <div className="sp-chart">
          <Bar height={24} width="160px" />

          <div className="sp-gap-md">
            <Bar height={320} width="100%" />
          </div>
        </div>

        <div className="sp-stats">
          {Array.from({ length: 8 }, (_, index) => (
            <div className="sp-stat" key={index}>
              <Bar height={12} width="60%" />

              <div className="sp-gap-sm">
                <Bar height={18} width="45%" />
              </div>
            </div>
          ))}
        </div>

        <div className="sp-news">
          {Array.from({ length: 3 }, (_, index) => (
            <div className="sp-news-card" key={index}>
              <Bar height={180} width="100%" />

              <div className="sp-gap-sm">
                <Bar height={16} width="90%" />
              </div>

              <div className="sp-gap-sm">
                <Bar height={12} width="40%" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
