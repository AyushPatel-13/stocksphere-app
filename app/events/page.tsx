"use client";

import { useEffect, useState } from "react";

export default function EventsPage() {
  const [events, setEvents] = useState<any[]>([]);

  const [symbol, setSymbol] = useState("");
  const [eventType, setEventType] =
    useState("Dividend");
  const [eventDate, setEventDate] =
    useState("");

const [editingIndex, setEditingIndex] =
  useState<number | null>(null);

  useEffect(() => {
    const saved = JSON.parse(
      localStorage.getItem("events") || "[]"
    );

    setEvents(saved);
  }, []);

  const addEvent = () => {
    if (
      !symbol ||
      !eventType ||
      !eventDate
    )
      return;

      if (editingIndex !== null) {
  const updatedEvents = [...events];

  updatedEvents[editingIndex] = {
    symbol: symbol.toUpperCase(),
    eventType,
    eventDate,
  };

  setEvents(updatedEvents);

  localStorage.setItem(
    "events",
    JSON.stringify(updatedEvents)
  );

  setEditingIndex(null);

  setSymbol("");
  setEventType("Dividend");
  setEventDate("");

  return;
}

    const newEvent = {
      symbol:
        symbol.toUpperCase(),
      eventType,
      eventDate,
    };

    const updated = [
      newEvent,
      ...events,
    ];

    setEvents(updated);

    localStorage.setItem(
      "events",
      JSON.stringify(updated)
    );

    setSymbol("");
    setEventDate("");
  };

  return (
    <div
      style={{
        background: "#000",
        color: "white",
        minHeight: "100vh",
        padding: "40px",
      }}
    >
      <h1>📅 Events Center</h1>

      <div
        style={{
          background: "#111",
          padding: "20px",
          borderRadius: "10px",
          marginTop: "20px",
          maxWidth: "500px",
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

        <select
  value={eventType}
  onChange={(e) =>
    setEventType(e.target.value)
  }
  style={{
    width: "100%",
    padding: "10px",
    background: "#222",
    color: "white",
    border: "1px solid #444",
    borderRadius: "8px",
    marginBottom: "10px",
  }}
>
          <option>
            Dividend
          </option>

          <option>
            Earnings
          </option>

          <option>
            Bonus
          </option>

          <option>
            Split
          </option>

          <option>
            AGM
          </option>
        </select>

        <input
          type="date"
          value={eventDate}
          onChange={(e) =>
            setEventDate(
              e.target.value
            )
          }
          style={{
            width: "100%",
            padding: "10px",
            marginBottom: "10px",
          }}
        />

        <button
          onClick={addEvent}
          style={{
            background:
              "#22c55e",
            color: "white",
            border: "none",
            padding:
              "10px 20px",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          {editingIndex !== null
  ? "Update Event"
  : "Add Event"}
        </button>
      </div>

      <div
        style={{
          marginTop: "30px",
        }}
      >
        {events.map(
          (
            event,
            index
          ) => (
            <div
              key={index}
              style={{
                background:
                  "#111",
                padding: "20px",
                borderRadius:
                  "10px",
                marginBottom:
                  "15px",
              }}
            >
              <h2>
                {event.symbol}
              </h2>

              <p>
                📌{" "}
                {
                  event.eventType
                }
              </p>

              <p>
                📅{" "}
                {
                  event.eventDate
                }
              </p>

<div
  style={{
    marginTop: "15px",
  }}
>

<button
  onClick={() => {
    setSymbol(event.symbol);
    setEventType(event.eventType);
    setEventDate(event.eventDate);

    setEditingIndex(index);
  }}
  style={{
    background: "#3b82f6",
    color: "white",
    border: "none",
    padding: "8px 15px",
    borderRadius: "8px",
    cursor: "pointer",
    marginRight: "10px",
  }}
>
  ✏️ Edit
</button>

  <button
    onClick={() => {
      const updatedEvents =
        events.filter(
          (_: any, i: number) =>
            i !== index
        );

      setEvents(updatedEvents);

      localStorage.setItem(
        "events",
        JSON.stringify(updatedEvents)
      );
    }}
    style={{
      background: "#ef4444",
      color: "white",
      border: "none",
      padding: "8px 15px",
      borderRadius: "8px",
      cursor: "pointer",
    }}
  >
    🗑️ Delete
  </button>
</div>
            </div>
          )
        )}
      </div>
    </div>
  );
}