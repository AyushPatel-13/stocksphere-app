export default function HeatmapPage() {
  return (
    <div
      style={{
        background: "#000",
        color: "white",
        minHeight: "100vh",
        padding: "40px",
      }}
    >
      <h1>🗺️ Market Heatmap</h1>

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
            background: "green",
            padding: "50px",
          }}
        >
          AAPL +1.2%
        </div>

        <div
          style={{
            background: "green",
            padding: "70px",
          }}
        >
          NVDA +2.4%
        </div>

        <div
          style={{
            background: "red",
            padding: "40px",
          }}
        >
          TSLA -0.8%
        </div>
      </div>
    </div>
  );
}