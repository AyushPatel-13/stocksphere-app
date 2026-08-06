export default function QuickActions() {
  return (
    <div
      style={{
        display: "flex",
        gap: "20px",
        marginTop: "30px",
      }}
    >
      <button
        onClick={() => (window.location.href = "/watchlist")}
        style={{
          background: "#111",
          color: "white",
          border: "none",
          padding: "15px 25px",
          borderRadius: "10px",
          cursor: "pointer",
        }}
      >
        ⭐ Watchlist
      </button>

      <button
        onClick={() => (window.location.href = "/portfolio")}
        style={{
          background: "#111",
          color: "white",
          border: "none",
          padding: "15px 25px",
          borderRadius: "10px",
          cursor: "pointer",
        }}
      >
        💼 Portfolio
      </button>

      <button
        onClick={() => (window.location.href = "/")}
        style={{
          background: "#111",
          color: "white",
          border: "none",
          padding: "15px 25px",
          borderRadius: "10px",
          cursor: "pointer",
        }}
      >
        🔍 Search Stocks
      </button>
    </div>
  );
}