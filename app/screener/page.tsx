export default function ScreenerPage() {
  const stocks = [
    ["AAPL", "Apple", "298", "+1.2%"],
    ["TSLA", "Tesla", "301", "-0.5%"],
    ["NVDA", "NVIDIA", "170", "+2.4%"],
    ["MSFT", "Microsoft", "372", "+0.8%"],
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
      <h1>📊 Stock Screener</h1>

      <table style={{ width: "100%", marginTop: "20px" }}>
        <tbody>
          {stocks.map((stock, index) => (
            <tr key={index}>
              <td>{stock[0]}</td>
              <td>{stock[1]}</td>
              <td>{stock[2]}</td>
              <td>{stock[3]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}