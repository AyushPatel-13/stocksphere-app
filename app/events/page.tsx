"use client";

import { useEffect, useState } from "react";

/**
 * Everything inline styles cannot express: hover, focus-visible, the
 * breakpoint and the reduced-motion opt-out. Same palette and scale as
 * PF_STYLES and WL_STYLES — #111 surfaces on #222 borders, #2e2e2e on hover,
 * #888 muted text, #22c55e for the primary action, #f87171 for the destructive
 * one.
 */
const EV_STYLES = `
.ev-root {
  background: #000;
  color: #fff;
  /* The navbar is in the root layout and renders 65px, so a full-height page
     that subtracts 64 leaves a scrollbar's worth of nothing. */
  min-height: calc(100vh - 65px);
  padding: 24px 16px 72px;
}
.ev-shell {
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
}

.ev-title {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.ev-panel {
  width: 100%;
  max-width: 560px;
  margin-top: 24px;
  padding: 20px;
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
}

.ev-field { margin-bottom: 14px; }
.ev-label {
  display: block;
  margin-bottom: 6px;
  color: #888;
  font-size: 13px;
  font-weight: 600;
}
.ev-input {
  width: 100%;
  padding: 11px 12px;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  /* Without this the date field's own picker icon is drawn dark on dark. */
  color-scheme: dark;
  transition: border-color 150ms ease;
}
.ev-input::placeholder { color: #666; }
.ev-input:hover { border-color: #333; }
.ev-input:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 1px;
  border-color: #22c55e;
}

.ev-btn {
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 11px 18px;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease, transform 150ms ease;
}
.ev-btn:active { transform: translateY(1px); }
/* Black on green-500, the app's primary idiom: around 13:1 against the green,
   where white would be under 2:1. */
.ev-btn-primary {
  width: 100%;
  background: #22c55e;
  color: #000;
}
.ev-btn-primary:hover { background: #1ea34d; }
.ev-btn-primary:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 2px;
}

.ev-section-title {
  margin: 40px 0 16px;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.ev-grid {
  display: grid;
  /* min(100%, 340px) keeps the cards at 340px on a wide screen but lets the
     track collapse to one full-width column once the viewport is narrower than
     a card, so nothing pushes the page sideways at 390px. */
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
  gap: 20px;
}

.ev-card {
  display: flex;
  flex-direction: column;
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
  padding: 20px;
  transition: border-color 150ms ease, transform 150ms ease;
}
.ev-card:hover {
  border-color: #2e2e2e;
  transform: translateY(-2px);
}
.ev-symbol {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}
.ev-meta {
  margin: 8px 0 0;
  color: #888;
  font-size: 13px;
  overflow-wrap: anywhere;
}

/* The actions sit at the bottom, so a row of cards of different heights still
   lines its buttons up. */
.ev-actions {
  display: flex;
  gap: 10px;
  margin-top: auto;
  padding-top: 22px;
}
.ev-btn-edit,
.ev-btn-delete {
  flex: 1;
  background: #1a1a1a;
  border-color: #2a2a2a;
}
.ev-btn-edit { color: #e5e5e5; }
.ev-btn-edit:hover { background: #242424; border-color: #3a3a3a; }
.ev-btn-edit:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 2px;
}
.ev-btn-delete { color: #f87171; }
.ev-btn-delete:hover { background: #2a1414; border-color: #4a2020; }
.ev-btn-delete:focus-visible {
  outline: 2px solid #f87171;
  outline-offset: 2px;
}

.ev-empty {
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
  padding: 48px 24px;
  text-align: center;
}
.ev-empty-title {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.ev-empty-text {
  margin: 10px 0 0;
  color: #888;
  font-size: 14px;
}

/* The same surface the portfolio's unavailable pill and the watchlist's note
   use. This is a failed read, which is not the empty state and must not be
   dressed up as one. */
.ev-note {
  margin: 0;
  padding: 24px;
  background: #171717;
  border: 1px solid #262626;
  border-radius: 16px;
  color: #8a8a8a;
  font-size: 15px;
}

@media (min-width: 700px) {
  .ev-root { padding: 40px 32px 96px; }
  .ev-title { font-size: 32px; }
  .ev-panel { padding: 24px; }
  .ev-empty { padding: 56px 40px; }
}

@media (prefers-reduced-motion: reduce) {
  .ev-card, .ev-btn, .ev-input { transition: none; }
  .ev-card:hover { transform: none; }
}
`;

export default function EventsPage() {
  /**
   * What the one read of localStorage produced.
   *
   *   null      — not read yet, so the page renders no list at all
   *   undefined — read, and the stored value was unusable
   *   array     — read, and this is the list (empty when there are no events)
   *
   * Three outcomes in one value, because the read has exactly one place to
   * report back from. It keeps "nothing stored yet" distinguishable from
   * "could not be read" without a loading state that would flash: localStorage
   * is synchronous, so there is nothing to wait for.
   */
  const [events, setEvents] = useState<any[] | null | undefined>(null);

  const [symbol, setSymbol] = useState("");
  const [eventType, setEventType] =
    useState("Dividend");
  const [eventDate, setEventDate] =
    useState("");

const [editingIndex, setEditingIndex] =
  useState<number | null>(null);

  useEffect(() => {
    let saved;

    try {
      const stored = JSON.parse(
        localStorage.getItem("events") || "[]"
      );

      // A stored value that is not a list is as unusable as one that will not
      // parse; rendering it would throw on .map instead of saying anything.
      if (Array.isArray(stored)) saved = stored;
    } catch (error) {
      console.error("Events storage read error:", error);
    }

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
  const updatedEvents = [...(events ?? [])];

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

    // events is null before the first read and undefined after a failed one.
    // Both start the list from nothing, which is what the read left behind in
    // each case, so a write after either one stores the new event alone —
    // exactly what it stored before.
    const updated = [
      newEvent,
      ...(events ?? []),
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
    <div className="ev-root">
      <style>{EV_STYLES}</style>

      <div className="ev-shell">
        <h1 className="ev-title">📅 Events Center</h1>

        <div className="ev-panel">
          <div className="ev-field">
            <label className="ev-label" htmlFor="ev-symbol">
              Stock Symbol
            </label>

            <input
              id="ev-symbol"
              className="ev-input"
              placeholder="Stock Symbol"
              value={symbol}
              onChange={(e) =>
                setSymbol(e.target.value)
              }
            />
          </div>

          <div className="ev-field">
            <label className="ev-label" htmlFor="ev-type">
              Event Type
            </label>

            <select
              id="ev-type"
              className="ev-input"
              value={eventType}
              onChange={(e) =>
                setEventType(e.target.value)
              }
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
          </div>

          <div className="ev-field">
            <label className="ev-label" htmlFor="ev-date">
              Event Date
            </label>

            <input
              id="ev-date"
              className="ev-input"
              type="date"
              value={eventDate}
              onChange={(e) =>
                setEventDate(
                  e.target.value
                )
              }
            />
          </div>

          <button
            className="ev-btn ev-btn-primary"
            onClick={addEvent}
          >
            {editingIndex !== null
  ? "Update Event"
  : "Add Event"}
          </button>
        </div>

        <h2 className="ev-section-title">
          Your Events
        </h2>

        {/* Nothing is rendered until the read has happened: showing the empty
            panel first would tell someone with saved events that they have
            none, for as long as it took the effect to run. */}
        {events === null ? null : events === undefined ? (
          <p className="ev-note" role="status">
            Your saved events could not be read.
          </p>
        ) : events.length === 0 ? (
          <div className="ev-empty">
            <h3 className="ev-empty-title">
              No events yet 📅
            </h3>

            <p className="ev-empty-text">
              Add your first event using the form above.
            </p>
          </div>
        ) : (
          <div className="ev-grid">
            {events.map(
              (
                event,
                index
              ) => (
                <article
                  key={index}
                  className="ev-card"
                >
                  <h3 className="ev-symbol">
                    {event.symbol}
                  </h3>

                  <p className="ev-meta">
                    📌{" "}
                    {
                      event.eventType
                    }
                  </p>

                  <p className="ev-meta">
                    📅{" "}
                    {
                      event.eventDate
                    }
                  </p>

<div className="ev-actions">

<button
  className="ev-btn ev-btn-edit"
  onClick={() => {
    setSymbol(event.symbol);
    setEventType(event.eventType);
    setEventDate(event.eventDate);

    setEditingIndex(index);
  }}
>
  ✏️ Edit
</button>

  <button
    className="ev-btn ev-btn-delete"
    onClick={() => {
      const updatedEvents =
        (events ?? []).filter(
          (_: any, i: number) =>
            i !== index
        );

      setEvents(updatedEvents);

      localStorage.setItem(
        "events",
        JSON.stringify(updatedEvents)
      );
    }}
  >
    🗑️ Delete
  </button>
</div>
                </article>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
