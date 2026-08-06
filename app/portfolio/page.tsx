"use client";

import { useState, useEffect } from "react";
import AuthGuard from "@/components/AuthGuard";
import {
  addHolding,
  getPortfolio,
  removeHolding,
} from "@/lib/portfolio";

export default function PortfolioPage() {
  const [showForm, setShowForm] = useState(false);
  const [symbol, setSymbol] = useState("");
const [quantity, setQuantity] = useState("");
const [buyPrice, setBuyPrice] = useState("");
const [holdings, setHoldings] = useState<any[]>([]);
const stockPrices: any = {
  RELIANCE: 2850,
  TCS: 4150,
  INFY: 1620,
  BEL: 385,
  HAL: 5420,
  TRENT: 6120,
};
const totalValue = holdings.reduce(
  (total, holding) =>
    total +
    Number(holding.quantity) *
      Number(holding.buy_price),
  0
);
const currentPortfolioValue = holdings.reduce(
  (total, holding) =>
    total +
    (stockPrices[
      holding.symbol.toUpperCase()
    ] || 0) *
      Number(holding.quantity),
  0
);

const totalPnL =
  currentPortfolioValue - totalValue;
const saveHolding = async () => {
  await addHolding(
    symbol.toUpperCase(),
    Number(quantity),
    Number(buyPrice)
  );

  const updated = await getPortfolio();

  setHoldings(updated);

  alert("Holding Added");

  setSymbol("");
  setQuantity("");
  setBuyPrice("");

  setShowForm(false);
};
useEffect(() => {
  const fetchPortfolio = async () => {
    const data = await getPortfolio();
    setHoldings(data);
  };

  fetchPortfolio();
}, []);

  return (
    <AuthGuard>
    <div
      style={{
        background: "#000",
        color: "white",
        minHeight: "100vh",
        padding: "40px",
      }}
    >
      <h1>💼 My Portfolio</h1>
      <div
  style={{
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "20px",
    marginTop: "20px",
    marginBottom: "30px",
  }}
>
  <div
    style={{
      background: "#111",
      padding: "20px",
      borderRadius: "10px",
    }}
  >
    <h3>Portfolio Value</h3>
    <h2>
      ₹{currentPortfolioValue.toLocaleString()}
    </h2>
  </div>

  <div
    style={{
      background: "#111",
      padding: "20px",
      borderRadius: "10px",
    }}
  >
    <h3>Total P/L</h3>
    <h2
      style={{
        color:
          totalPnL >= 0
            ? "lime"
            : "red",
      }}
    >
      ₹{totalPnL.toLocaleString()}
    </h2>
  </div>

  <div
    style={{
      background: "#111",
      padding: "20px",
      borderRadius: "10px",
    }}
  >
    <h3>Holdings</h3>
    <h2>{holdings.length}</h2>
  </div>
</div>

      <button
        onClick={() => setShowForm(!showForm)}
        style={{
          background: "#22c55e",
          color: "white",
          border: "none",
          padding: "10px 20px",
          borderRadius: "8px",
          cursor: "pointer",
          marginTop: "20px",
        }}
      >
        ➕ Add Holding
      </button>

      {showForm && (
        <div
          style={{
            marginTop: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            maxWidth: "300px",
          }}
        >
          <input
  placeholder="Stock Symbol"
  value={symbol}
  onChange={(e) => setSymbol(e.target.value)}
  style={{ padding: "10px" }}
/>

          <input
  placeholder="Quantity"
  value={quantity}
  onChange={(e) => setQuantity(e.target.value)}
  style={{ padding: "10px" }}
/>

    <input
  placeholder="Buy Price"
  value={buyPrice}
  onChange={(e) => setBuyPrice(e.target.value)}
  style={{ padding: "10px" }}
/>

          <button
  onClick={saveHolding}
  style={{
              background: "#22c55e",
              color: "white",
              border: "none",
              padding: "10px",
              borderRadius: "8px",
            }}
          >
            Save Holding
          </button>
        </div>
      )}

      <div style={{ marginTop: "20px" }}>
  {holdings.map((holding) => (
  <div
    key={holding.id}
  style={{
    background: "#111",
    padding: "15px",
    marginTop: "10px",
    borderRadius: "8px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  }}
>
      <div>
  <h3>{holding.symbol}</h3>

  <p>Quantity: {holding.quantity}</p>

  <p>Buy Price: ₹{holding.buy_price}</p>

  <p>
    Investment Value: ₹
    {Number(holding.quantity) *
      Number(holding.buy_price)}
  </p>
  <p>
  Current Price: ₹
  {stockPrices[
    holding.symbol.toUpperCase()
  ] || 0}
</p>

<p>
  Current Value: ₹
  {(stockPrices[
    holding.symbol.toUpperCase()
  ] || 0) *
    Number(holding.quantity)}
</p>

<p
  style={{
    color:
      ((stockPrices[
        holding.symbol.toUpperCase()
      ] || 0) -
        Number(holding.buy_price)) >= 0
        ? "lime"
        : "red",
  }}
>
  Profit/Loss: ₹
  {(
    ((stockPrices[
      holding.symbol.toUpperCase()
    ] || 0) -
      Number(holding.buy_price)) *
    Number(holding.quantity)
  ).toFixed(2)}
</p>
</div>
<button
  onClick={async () => {
  await removeHolding(holding.id);

  const updated = await getPortfolio();

  setHoldings(updated);
}}
  style={{
    background: "red",
    color: "white",
    border: "none",
    padding: "8px 12px",
    borderRadius: "6px",
    cursor: "pointer",
  }}
>
  ❌
</button>
    </div>
  ))}
</div>
    </div>
    </AuthGuard>
  );
}