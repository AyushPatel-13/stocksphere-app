export default function TrendingStocks() {
  const stocks = [
    "RELIANCE",
    "TCS",
    "INFY",
    "BEL",
    "HAL",
  ];

  return (
    <div style={{ marginTop: "40px" }}>
      <h2>🔥 Trending Stocks</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: "15px",
          marginTop: "20px",
        }}
      >
        {stocks.map((stock) => (
          <div
            key={stock}
            onClick={() =>
              (window.location.href = `/stock/${stock}`)
            }
            style={{
              background: "#111",
              padding: "15px",
              borderRadius: "8px",
              cursor: "pointer",
              textAlign: "center",
            }}
          >
            {stock}
          </div>
        ))}
      </div>
    </div>
  );
}