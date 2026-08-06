"use client";

import { useEffect, useState } from "react";

export default function StockEvents({
  symbol,
}: {
  symbol: string;
}) {
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    const savedEvents = JSON.parse(
      localStorage.getItem("events") || "[]"
    );

    const stockEvents = savedEvents.filter(
      (event: any) =>
        event.symbol === symbol.toUpperCase()
    );

    setEvents(stockEvents);
  }, [symbol]);

  if (events.length === 0) {
    return null;
  }

  return (
    <>
      <h2
        style={{
          marginTop: "40px",
          marginBottom: "20px",
          fontSize: "28px",
        }}
      >
        📅 Upcoming Events
      </h2>

      <div
        style={{
          display: "grid",
          gap: "15px",
        }}
      >
        {events.map((event, index) => (
          <div
            key={index}
            style={{
              background: "#111",
              padding: "20px",
              borderRadius: "10px",
            }}
          >
            <p>📌 {event.eventType}</p>
            <p>📅 {event.eventDate}</p>
          </div>
        ))}
      </div>
    </>
  );
}