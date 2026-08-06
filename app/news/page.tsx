export default function NewsPage() {
  const news = [
    "Apple launches new AI feature",
    "Tesla beats delivery expectations",
    "NVIDIA expands AI chip production",
    "Reliance announces new energy project",
    "HDFC Bank reports strong growth",
  ];

  return (
    <div
      style={{
        background: "#000",
        color: "white",
        minHeight: "100vh",
        padding: "40px",
      }}
    >
      <h1>📰 Market News</h1>

      {news.map((item, index) => (
        <div
          key={index}
          style={{
            background: "#111",
            padding: "20px",
            marginTop: "15px",
            borderRadius: "10px",
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
}