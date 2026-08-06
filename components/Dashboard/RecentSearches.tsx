type RecentSearchesProps = {
  recentSearches: string[];
};

export default function RecentSearches({
  recentSearches,
}: RecentSearchesProps) {
  return (
    <div style={{ marginTop: "40px" }}>
      <h2>🕒 Recent Searches</h2>

      <div
        style={{
          display: "flex",
          gap: "15px",
          marginTop: "20px",
          flexWrap: "wrap",
        }}
      >
        {recentSearches.map((stock) => (
          <div
            key={stock}
            onClick={() =>
              (window.location.href = `/stock/${stock}`)
            }
            style={{
              background: "#111",
              padding: "12px 18px",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            {stock}
          </div>
        ))}
      </div>
    </div>
  );
}