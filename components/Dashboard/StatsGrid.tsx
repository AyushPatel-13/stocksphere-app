type StatsGridProps = {
  watchlistCount: number;
  holdingsCount: number;
  portfolioValue: number;
};

export default function StatsGrid({
  watchlistCount,
  holdingsCount,
  portfolioValue,
}: StatsGridProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3,1fr)",
        gap: "20px",
        marginTop: "30px",
      }}
    >
      <div
        style={{
          background: "#111",
          padding: "20px",
          borderRadius: "10px",
        }}
      >
        ⭐ Watchlist

        <h2>{watchlistCount}</h2>
      </div>

      <div
        style={{
          background: "#111",
          padding: "20px",
          borderRadius: "10px",
        }}
      >
        💼 Holdings

        <h2>{holdingsCount}</h2>
      </div>

      <div
        style={{
          background: "#111",
          padding: "20px",
          borderRadius: "10px",
        }}
      >
        💰 Portfolio

        <h2>₹{portfolioValue.toLocaleString()}</h2>
      </div>
    </div>
  );
}