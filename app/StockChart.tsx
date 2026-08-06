"use client";

import { useState } from "react";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

const chartData = {
  "1H": [
    { time: "9AM", price: 2800 },
    { time: "10AM", price: 2600 },
    { time: "11AM", price: 3100 },
    { time: "12PM", price: 2400 },
    { time: "1PM", price: 3500 },
    { time: "2PM", price: 2850 },
  ],

  "1D": [
    { time: "Mon", price: 2700 },
    { time: "Tue", price: 2750 },
    { time: "Wed", price: 2800 },
    { time: "Thu", price: 2900 },
    { time: "Fri", price: 2850 },
  ],

  "1W": [
    { time: "W1", price: 2500 },
    { time: "W2", price: 2700 },
    { time: "W3", price: 2900 },
    { time: "W4", price: 2850 },
  ],

  "1M": [
    { time: "Jan", price: 2200 },
    { time: "Feb", price: 2400 },
    { time: "Mar", price: 2600 },
    { time: "Apr", price: 2500 },
    { time: "May", price: 2850 },
  ],

  "1Y": [
    { time: "2025", price: 1800 },
    { time: "2026", price: 2850 },
  ],

  "5Y": [
    { time: "2021", price: 1200 },
    { time: "2022", price: 1500 },
    { time: "2023", price: 1900 },
    { time: "2024", price: 2400 },
    { time: "2025", price: 2600 },
    { time: "2026", price: 2850 },
  ],
};

export default function StockChart({
  historicalData,
}: {
  historicalData: any[];
}) {
const [timeframe, setTimeframe] =
  useState<keyof typeof chartData>("1H");
  const liveChartData =
  historicalData
    ?.slice()
    .reverse()
    .map((item) => ({
      time: new Date(
        item.datetime
      ).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      price: Number(item.close),
    })) || [];

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: "10px",
          marginBottom: "20px",
        }}
      >
    {(["1H", "1D", "1W", "1M", "1Y", "5Y"] as const).map((item) => (
          <button
            key={item}
            onClick={() => setTimeframe(item)}
            style={{
              background:
                timeframe === item ? "#22c55e" : "#222",
              color: "white",
              border: "none",
              padding: "8px 16px",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            {item}
          </button>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <LineChart
  data={
    timeframe === "1M"
      ? liveChartData
      : chartData[timeframe]
  }
>
          <XAxis dataKey="time" />
          <YAxis
  domain={["dataMin - 5", "dataMax + 5"]}
/>
          <Line
            type="monotone"
            dataKey="price"
            stroke="#22c55e"
            strokeWidth={3}
          />
        </LineChart>
      </ResponsiveContainer>
    </>
  );
}