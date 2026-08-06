"use client";

import { useState, useEffect } from "react";

import Link from "next/link";

const getRank = (votes: number) => {
  if (votes >= 100)
    return "👑 Market Legend";

  if (votes >= 50)
    return "🏆 Market Analyst";

  if (votes >= 25)
    return "💼 Active Investor";

  if (votes >= 10)
    return "📈 Rookie Investor";

  return "🌱 Newcomer";
};

export default function PredictionsPage() {
  const [predictions, setPredictions] = useState<any[]>([]);

  const [symbol, setSymbol] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [date, setDate] = useState("");

  const [direction, setDirection] =
  useState("Bullish");

  const username =
    typeof window !== "undefined"
      ? localStorage.getItem("username") ||
        "Anonymous"
      : "Anonymous";

  useEffect(() => {
    const savedPredictions = JSON.parse(
      localStorage.getItem("predictions") || "[]"
    );

    setPredictions(savedPredictions);
  }, []);

 const savePrediction = () => {
  const newPrediction = {
    username,
    symbol: symbol.toUpperCase(),
    targetPrice,
    date,
    direction,
    agrees: 0,
    disagrees: 0,

    status: "Pending",
  };

    const updatedPredictions = [
      newPrediction,
      ...predictions,
    ];

    setPredictions(updatedPredictions);

    localStorage.setItem(
      "predictions",
      JSON.stringify(updatedPredictions)
    );

    setSymbol("");
    setTargetPrice("");
    setDate("");

    alert("Prediction Saved");
  };

  const pendingPredictions =
  predictions.filter(
    (prediction) =>
      prediction.status ===
      "Pending"
  );

const completedPredictions =
  predictions.filter(
    (prediction) =>
      prediction.status !==
      "Pending"
  );

return (
  <div
      style={{
        background: "#000",
        color: "white",
        minHeight: "100vh",
        padding: "40px",
      }}
    >
      <h1>🎯 Stock Predictions</h1>

      <div
        style={{
          background: "#111",
          padding: "20px",
          borderRadius: "10px",
          marginTop: "20px",
          maxWidth: "400px",
        }}
      >
        <input
          placeholder="Stock Symbol"
          value={symbol}
          onChange={(e) =>
            setSymbol(e.target.value)
          }
          style={{
            width: "100%",
            padding: "10px",
            marginBottom: "10px",
          }}
        />

        <input
          placeholder="Target Price"
          value={targetPrice}
          onChange={(e) =>
            setTargetPrice(e.target.value)
          }
          style={{
            width: "100%",
            padding: "10px",
            marginBottom: "10px",
          }}
        />

        <input
  type="date"
  value={date}
  onChange={(e) =>
    setDate(e.target.value)
  }
  style={{
    width: "100%",
    padding: "10px",
    marginBottom: "10px",
  }}
/>

<select
  value={direction}
  onChange={(e) =>
    setDirection(e.target.value)
  }
  style={{
    width: "100%",
    padding: "10px",
    marginBottom: "10px",
  }}
>
  <option value="Bullish">
    📈 Bullish
  </option>

  <option value="Bearish">
    📉 Bearish
  </option>
</select>

<button
  onClick={savePrediction}
          style={{
            background: "#22c55e",
            color: "white",
            border: "none",
            padding: "10px 20px",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          Save Prediction
        </button>
      </div>

      <div style={{ marginTop: "40px" }}>
        <h2>⏳ Pending Predictions</h2>

        {pendingPredictions.map(
          (prediction, index) => (
            <div
              key={index}
              style={{
                background: "#111",
                padding: "20px",
                borderRadius: "10px",
                marginTop: "15px",
              }}
            >
              <h3>
                {prediction.symbol}
              </h3>

              <div
  style={{
    marginBottom: "10px",
  }}
>
  <Link
  href={`/profile/${prediction.username}`}
  style={{
    color: "#22c55e",
    textDecoration: "none",
    fontWeight: "bold",
  }}
>
  👤 {prediction.username}
</Link>

  <p
    style={{
      color: "#22c55e",
      fontWeight: "bold",
    }}
  >
    {getRank(
      (prediction.agrees || 0) +
      (prediction.disagrees || 0)
    )}
  </p>
</div>

            <p>
  🎯 Target Price:
  ₹{prediction.targetPrice}
</p>

<p>
  📅 Target Date:
  {prediction.date}
</p>

              <p
  style={{
    color:
      prediction.direction ===
      "Bullish"
        ? "lime"
        : "red",
  }}
>
  {prediction.direction ===
  "Bullish"
    ? "📈 Bullish"
    : "📉 Bearish"}
</p>
<p
  style={{
    color:
      prediction.status === "Correct"
        ? "lime"
        : prediction.status === "Wrong"
        ? "red"
        : "orange",
  }}
>
  📌 Status: {prediction.status}
</p>
<div
  style={{
    display: "flex",
    gap: "10px",
    marginTop: "10px",
  }}
>
  <button
    onClick={() => {
      const updated = [...predictions];

      updated[index].agrees += 1;

      setPredictions(updated);

      localStorage.setItem(
        "predictions",
        JSON.stringify(updated)
      );
    }}
    style={{
      background: "#22c55e",
      color: "white",
      border: "none",
      padding: "8px 12px",
      borderRadius: "6px",
      cursor: "pointer",
    }}
  >
    👍 {prediction.agrees}
  </button>

  <button
    onClick={() => {
      const updated = [...predictions];

      updated[index].disagrees += 1;

      setPredictions(updated);

      localStorage.setItem(
        "predictions",
        JSON.stringify(updated)
      );
    }}
    style={{
      background: "#ef4444",
      color: "white",
      border: "none",
      padding: "8px 12px",
      borderRadius: "6px",
      cursor: "pointer",
    }}
  >
    👎 {prediction.disagrees}
  </button>
  <button
  onClick={() => {
    const updated = [...predictions];

    updated[index].status =
      "Correct";

    setPredictions(updated);

    localStorage.setItem(
      "predictions",
      JSON.stringify(updated)
    );
  }}
  style={{
    background: "#22c55e",
    color: "white",
    border: "none",
    padding: "8px 12px",
    borderRadius: "6px",
    cursor: "pointer",
  }}
>
  ✅ Correct
</button>

<button
  onClick={() => {
    const updated = [...predictions];

    updated[index].status =
      "Wrong";

    setPredictions(updated);

    localStorage.setItem(
      "predictions",
      JSON.stringify(updated)
    );
  }}
  style={{
    background: "#ef4444",
    color: "white",
    border: "none",
    padding: "8px 12px",
    borderRadius: "6px",
    cursor: "pointer",
  }}
>
  ❌ Wrong
</button>
</div>
<div style={{ marginTop: "15px" }}>
  <input
    placeholder="Add a comment..."
    onKeyDown={(e) => {
      if (e.key === "Enter") {
        const updated = [...predictions];

        if (
          !updated[index].comments
        ) {
          updated[index].comments = [];
        }

        updated[index].comments.push({
  username,
  text: e.currentTarget.value,
  time: new Date().toLocaleString(),
});

        setPredictions(updated);

        localStorage.setItem(
          "predictions",
          JSON.stringify(updated)
        );

        e.currentTarget.value = "";
      }
    }}
    style={{
      padding: "10px",
      width: "100%",
      background: "#222",
      color: "white",
      border: "1px solid #444",
      borderRadius: "8px",
    }}
  />

  <div style={{ marginTop: "10px" }}>
  {prediction.comments?.map(
    (
      comment: any,
      i: number
    ) => (
      <div
        key={i}
        style={{
          background: "#1a1a1a",
          padding: "10px",
          borderRadius: "8px",
          marginBottom: "8px",
        }}
      >
        <p
          style={{
            color: "#22c55e",
            fontWeight: "bold",
          }}
        >
          👤 {comment.username}
        </p>

        <p
          style={{
            color: "#888",
            fontSize: "12px",
          }}
        >
          🕒 {comment.time}
        </p>

        <p>
          💬 {comment.text}
        </p>
      </div>
    )
  )}
</div>
</div>
            </div>
          )
        )}
        <div style={{ marginTop: "50px" }}>
  <h2>
    ✅ Completed Predictions
  </h2>

  {completedPredictions.map(
    (
      prediction,
      index
    ) => (
      <div
        key={index}
        style={{
          background: "#111",
          padding: "20px",
          borderRadius: "10px",
          marginTop: "15px",
        }}
      >
        <h3>
          {prediction.symbol}
        </h3>

        <Link
  href={`/profile/${prediction.username}`}
  style={{
    color: "#22c55e",
    textDecoration: "none",
    fontWeight: "bold",
  }}
>
  👤 {prediction.username}
</Link>

        <p>
          🎯 ₹
          {prediction.targetPrice}
        </p>

        <p>
          📅 {prediction.date}
        </p>

        <p
          style={{
            color:
              prediction.status ===
              "Correct"
                ? "lime"
                : "red",
          }}
        >
          {prediction.status ===
          "Correct"
            ? "✅ Correct"
            : "❌ Wrong"}
        </p>
      </div>
    )
  )}
</div>
      </div>
    </div>
  );
}