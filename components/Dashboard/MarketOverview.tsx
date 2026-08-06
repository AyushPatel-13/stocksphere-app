export default function MarketOverview() {
  const markets = [
    { name: "NIFTY 50", change: "+0.82%", color: "lime" },
    { name: "SENSEX", change: "+0.74%", color: "lime" },
    { name: "NASDAQ", change: "+1.12%", color: "lime" },
    { name: "GOLD", change: "-0.15%", color: "red" },
    { name: "BTC", change: "+2.34%", color: "lime" },
  ];

  return (
    <div style={{ marginTop: "40px" }}>
      <h2>📈 Market Overview</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: "15px",
          marginTop: "20px",
        }}
      >
        {markets.map((market) => (
          <div
            key={market.name}
            style={{
              background: "#111",
              padding: "15px",
              borderRadius: "8px",
            }}
          >
            <h3>{market.name}</h3>

            <p style={{ color: market.color }}>
              {market.change}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}