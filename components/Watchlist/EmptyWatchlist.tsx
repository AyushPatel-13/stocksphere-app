export default function EmptyWatchlist() {
  return (
    <div
      style={{
        background: "#111",
        borderRadius: "15px",
        padding: "60px",
        textAlign: "center",
      }}
    >
      <h2>No Watchlist Yet ⭐</h2>

      <p
        style={{
          color: "#888",
          marginTop: "10px",
        }}
      >
        Search for stocks and add them to your watchlist.
      </p>
    </div>
  );
}