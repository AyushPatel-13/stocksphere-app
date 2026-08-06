type Props = {
  companyName: string;
  symbol: string;
  price: number | null;
  change: number;
};

export default function StockHeader({
  companyName,
  symbol,
  price,
  change,
}: Props) {
  const positive = change >= 0;

  return (
    <div
      style={{
        background: "#111",
        borderRadius: "20px",
        padding: "30px",
        border: "1px solid #222",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: "30px",
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontSize: "34px",
          }}
        >
          {companyName}
        </h1>

        <p
          style={{
            color: "#888",
            fontSize: "18px",
            marginTop: "6px",
          }}
        >
          {symbol}
        </p>

        <h2
          style={{
            marginTop: "20px",
            color: "#22c55e",
            fontSize: "42px",
          }}
        >
          {price !== null
            ? `$${price.toFixed(2)}`
            : "Loading..."}
        </h2>

        <p
          style={{
            color: positive ? "#22c55e" : "#ef4444",
            fontWeight: "bold",
            fontSize: "18px",
          }}
        >
          {positive ? "+" : ""}
          {change.toFixed(2)}%
        </p>
      </div>

      <div
        style={{
          display: "flex",
          gap: "15px",
        }}
      >
        <button
          style={{
            background: "#2563eb",
            color: "white",
            border: "none",
            padding: "14px 28px",
            borderRadius: "10px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          ⭐ Watchlist
        </button>

        <button
          style={{
            background: "#16a34a",
            color: "white",
            border: "none",
            padding: "14px 28px",
            borderRadius: "10px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          Buy
        </button>
      </div>
    </div>
  );
}