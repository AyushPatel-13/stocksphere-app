"use client";

import { useEffect, useState } from "react";

export default function StockEvents({
  symbol,
}: {
  symbol: string;
}) {
  const [events, setEvents] = useState<{ symbol: string; eventType: string; eventDate: string }[]>([]);

  useEffect(() => {
    // Reminders from the Events page, kept in this browser. Read after mount
    // (the server has no localStorage); a broken value just shows nothing.
    const timer = window.setTimeout(() => {
      try {
        const saved: unknown = JSON.parse(localStorage.getItem("events") || "[]");
        const list = Array.isArray(saved) ? saved : [];
        setEvents(
          list.filter(
            (event): event is { symbol: string; eventType: string; eventDate: string } =>
              typeof event?.symbol === "string" && event.symbol === symbol.toUpperCase()
          )
        );
      } catch {
        setEvents([]);
      }
    }, 0);
    return () => window.clearTimeout(timer);
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