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
                padding: "30px",
                borderRadius: "20px",
                border: "1px solid #222",
                width: "100%",
            }}
        >
            <h2>Price Chart</h2>

            <div
                style={{
                    display: "flex",
                    gap: "10px",
                    margin: "20px 0",
                }}
            >
                {["1D", "1W", "1M", "3M", "1Y", "5Y"].map((item) => (
                    <button
                        key={item}
                        onClick={() => setRange(item)}
                        style={{
                            background:
                                range === item ? "#2563eb" : "#1e293b",
                            color: "white",
                            border: "none",
                            padding: "8px 16px",
                            borderRadius: "8px",
                            cursor: "pointer",
                            transition: "0.2s",
                        }}
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