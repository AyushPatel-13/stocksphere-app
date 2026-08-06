type WelcomeCardProps = {
  username: string;
  portfolioValue: number;
  watchlistCount: number;
  holdingsCount: number;
};

export default function WelcomeCard({
  username,
  portfolioValue,
  watchlistCount,
  holdingsCount,
}: WelcomeCardProps) {
  return (
    <div
      style={{
        background:
          "linear-gradient(135deg, #1f2937, #111827)",
        padding: "30px",
        borderRadius: "16px",
        marginTop: "20px",
        boxShadow: "0 0 20px rgba(0,0,0,0.4)",
      }}
    >
      <h1>Welcome Back {username} 👋</h1>

      <h2
        style={{
          color: "#22c55e",
          marginTop: "10px",
        }}
      >
        ₹{portfolioValue.toLocaleString()}
      </h2>

      <p>Total Portfolio Value</p>

      <div
        style={{
          display: "flex",
          gap: "40px",
          marginTop: "20px",
        }}
      >
        <div>
          <h3>{watchlistCount}</h3>
          <p>Watchlist Stocks</p>
        </div>

        <div>
          <h3>{holdingsCount}</h3>
          <p>Holdings</p>
        </div>
      </div>
    </div>
  );
}