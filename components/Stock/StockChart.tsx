"use client";

import {
    ResponsiveContainer,
    AreaChart,
    Area,
    XAxis,
    Tooltip,
    CartesianGrid,
} from "recharts";

import { useState, useMemo } from "react";

type Props = {
    historicalData: any[];
};

/**
 * The six range buttons used to be white text on #1e293b, with #2563eb for the
 * current range — a slate/blue pair that appears nowhere else in the app, at an
 * 8px radius and with no hover or focus-visible treatment. They are now the
 * app's dark surface and border, with the current range on the primary green,
 * and the card matches the Company Overview card beside it.
 *
 * The range state, the six options and the series they select are untouched.
 */
const SC_STYLES = `
.sc-range {
  padding: 8px 16px;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  color: #c9c9c9;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
}
.sc-range:hover {
  background: #242424;
  border-color: #3a3a3a;
  color: #fff;
}
.sc-range:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 2px;
}
/* Black on green-500, the app's primary idiom, so which series the chart is
   drawn from is unambiguous at a glance. */
.sc-range-current,
.sc-range-current:hover {
  background: #22c55e;
  border-color: #22c55e;
  color: #000;
}
.sc-range-current:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .sc-range { transition: none; }
}
`;

export default function StockChart({
    historicalData,
}: Props) {

    const [range, setRange] = useState("1M");

    const data = useMemo(() => {
        let days = 30;

        switch (range) {
            case "1D":
                days = 1;
                break;
            case "1W":
                days = 7;
                break;
            case "1M":
                days = 30;
                break;
            case "3M":
                days = 90;
                break;
            case "1Y":
                days = 365;
                break;
            case "5Y":
                days = 1825;
                break;
        }

        return historicalData
            .slice(0, days)
            .reverse()
            .map((item: any) => ({
                time: item.datetime,
                price: Number(item.close),
            }));
    }, [historicalData, range]);

    console.log(data);

    return (
        <div
            style={{
                background: "#111",
                border: "1px solid #222",
                padding: "24px",
                borderRadius: "16px",
                width: "100%",
            }}
        >
            <style>{SC_STYLES}</style>

            <h2
                style={{
                    margin: 0,
                    fontSize: "22px",
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                }}
            >
                Price Chart
            </h2>

            <div
                style={{
                    display: "flex",
                    // The six range buttons are fixed-width (8px/16px padding
                    // plus two characters), so on a narrow viewport they used
                    // to paint past this row and past the card — 417px of
                    // document against a 390px viewport. Wrapping keeps every
                    // button visible and in reach; `gap` already supplies the
                    // 10px between rows as well as within one.
                    flexWrap: "wrap",
                    gap: "10px",
                    margin: "20px 0",
                }}
            >
                {["1D", "1W", "1M", "3M", "1Y", "5Y"].map((item) => (
                    <button
                        key={item}
                        onClick={() => setRange(item)}
                        className={
                            range === item
                                ? "sc-range sc-range-current"
                                : "sc-range"
                        }
                    >
                        {item}
                    </button>
                ))}
            </div>

            <ResponsiveContainer
                width="100%"
                height={500}
            >
                <AreaChart data={data}>

                    <defs>
                        <linearGradient
                            id="priceGradient"
                            x1="0"
                            y1="0"
                            x2="0"
                            y2="1"
                        >
                            <stop
                                offset="0%"
                                stopColor="#22c55e"
                                stopOpacity={0.45}
                            />
                            <stop
                                offset="100%"
                                stopColor="#22c55e"
                                stopOpacity={0}
                            />
                        </linearGradient>
                    </defs>

                    <CartesianGrid
                        stroke="#222"
                        vertical={false}
                    />

                    <XAxis
                        dataKey="time"
                        tick={{ fill: "#777", fontSize: 12 }}
                        tickLine={false}
                        axisLine={false}
                    />

                    <Tooltip
                        contentStyle={{
                            background: "#111",
                            border: "1px solid #333",
                            borderRadius: "12px",
                            color: "white",
                        }}
                    />

                    <Area
                        type="monotone"
                        dataKey="price"
                        stroke="#22c55e"
                        strokeWidth={4}
                        fill="url(#priceGradient)"
                        dot={false}
                    />
                </AreaChart>
            </ResponsiveContainer>
        </div>
    );
}
