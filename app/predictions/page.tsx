"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Everything inline styles cannot express: hover, focus-visible, the
 * breakpoint and the reduced-motion opt-out. Same palette and scale as
 * PF_STYLES, WL_STYLES and EV_STYLES — #111 surfaces on #222 borders, #2e2e2e
 * on hover, #888 muted text, #22c55e for the primary action, #4ade80 / #f87171
 * for the positive and negative states, #fbbf24 for the pending one (the amber
 * the Agent components already use).
 */
const PRED_STYLES = `
.pred-root {
  background: #000;
  color: #fff;
  /* The navbar is in the root layout and renders 65px, so a full-height page
     that subtracts 64 leaves a scrollbar's worth of nothing. */
  min-height: calc(100vh - 65px);
  padding: 24px 16px 72px;
}
.pred-shell {
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
}

.pred-title {
  margin: 0;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.pred-panel {
  width: 100%;
  max-width: 560px;
  margin-top: 24px;
  padding: 20px;
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
}

.pred-field { margin-bottom: 14px; }
.pred-label {
  display: block;
  margin-bottom: 6px;
  color: #888;
  font-size: 13px;
  font-weight: 600;
}
.pred-input {
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
.pred-input::placeholder { color: #666; }
.pred-input:hover { border-color: #333; }
.pred-input:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 1px;
  border-color: #22c55e;
}

.pred-btn {
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
.pred-btn:active { transform: translateY(1px); }
/* Black on green-500, the app's primary idiom: around 13:1 against the green,
   where white would be under 2:1. */
.pred-btn-primary {
  width: 100%;
  background: #22c55e;
  color: #000;
}
.pred-btn-primary:hover { background: #1ea34d; }
.pred-btn-primary:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 2px;
}

.pred-section { margin-top: 40px; }
.pred-section-title {
  margin: 0 0 16px;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.pred-grid {
  display: grid;
  /* min(100%, 340px) keeps the cards at 340px on a wide screen but lets the
     track collapse to one full-width column once the viewport is narrower than
     a card, so nothing pushes the page sideways at 390px. */
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
  gap: 20px;
}

.pred-card {
  display: flex;
  flex-direction: column;
  background: #111;
  border: 1px solid #222;
  border-radius: 16px;
  padding: 20px;
  /* Border colour only — no lift. This card holds a text field, and moving it
     out from under the pointer on hover is worse than the two pixels are worth. */
  transition: border-color 150ms ease;
}
.pred-card:hover { border-color: #2e2e2e; }

.pred-symbol {
  margin: 0;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}
.pred-user {
  align-self: flex-start;
  margin-top: 10px;
  color: #22c55e;
  font-size: 14px;
  font-weight: 600;
  text-decoration: none;
  border-radius: 6px;
}
.pred-user:hover { color: #4ade80; text-decoration: underline; }
.pred-user:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 2px;
}
.pred-rank {
  margin: 6px 0 0;
  color: #22c55e;
  font-size: 13px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.pred-target {
  margin: 14px 0 0;
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.pred-line {
  margin: 6px 0 0;
  color: #888;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.pred-direction {
  margin: 10px 0 0;
  font-size: 14px;
  font-weight: 600;
}
.pred-up { color: #4ade80; }
.pred-down { color: #f87171; }
.pred-status {
  margin: 6px 0 0;
  font-size: 13px;
  font-weight: 600;
}
.pred-status-correct { color: #4ade80; }
.pred-status-wrong { color: #f87171; }
.pred-status-pending { color: #fbbf24; }

/* The rule above the actions separates them from the prediction's own facts.
   The two votes sit on one row and the two verdicts on the next, which is a
   fixed split rather than whatever the four buttons happen to measure into:
   four of them at 340px are a few pixels too wide for one row, and a wrap then
   leaves "❌ Wrong" alone on a second row. */
.pred-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #222;
}
.pred-actions .pred-btn {
  padding: 8px 12px;
  font-size: 12.5px;
  background: #1a1a1a;
  border-color: #2a2a2a;
}
.pred-actions .pred-btn:hover { background: #242424; border-color: #3a3a3a; }
.pred-verdicts {
  display: flex;
  flex: 1 1 100%;
  gap: 8px;
}
.pred-btn-agree,
.pred-btn-correct { color: #4ade80; }
.pred-btn-disagree,
.pred-btn-wrong { color: #f87171; }
.pred-btn-agree:focus-visible,
.pred-btn-correct:focus-visible { outline: 2px solid #22c55e; outline-offset: 2px; }
.pred-btn-disagree:focus-visible,
.pred-btn-wrong:focus-visible { outline: 2px solid #f87171; outline-offset: 2px; }

.pred-comments { margin-top: 16px; }
.pred-comment-input {
  width: 100%;
  padding: 10px 12px;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  color: #fff;
  font-family: inherit;
  font-size: 13px;
  transition: border-color 150ms ease;
}
.pred-comment-input::placeholder { color: #666; }
.pred-comment-input:hover { border-color: #333; }
.pred-comment-input:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 1px;
  border-color: #22c55e;
}
.pred-comment-list { margin-top: 10px; }
.pred-comment {
  padding: 10px 12px;
  background: #1a1a1a;
  border: 1px solid #222;
  border-radius: 10px;
  overflow-wrap: anywhere;
}
.pred-comment + .pred-comment { margin-top: 8px; }
.pred-comment-user {
  margin: 0;
  color: #22c55e;
  font-size: 12.5px;
  font-weight: 600;
}
.pred-comment-time {
  margin: 2px 0 0;
  color: #888;
  font-size: 11.5px;
}
.pred-comment-text {
  margin: 6px 0 0;
  color: #e5e5e5;
  font-size: 13.5px;
  line-height: 1.5;
}

/* The same note the Home page uses for a section with nothing in it. */
.pred-empty {
  margin: 0;
  padding: 16px 20px;
  background: #151515;
  border-radius: 12px;
  color: #888;
  font-size: 14px;
}

/* A failed read is not the empty state and must not be dressed up as one: the
   same surface the portfolio's unavailable pill and the watchlist's note use. */
.pred-note {
  margin: 0;
  padding: 24px;
  background: #171717;
  border: 1px solid #262626;
  border-radius: 16px;
  color: #8a8a8a;
  font-size: 15px;
}

@media (min-width: 700px) {
  .pred-root { padding: 40px 32px 96px; }
  .pred-title { font-size: 32px; }
  .pred-panel { padding: 24px; }
}

@media (prefers-reduced-motion: reduce) {
  .pred-card, .pred-btn, .pred-input, .pred-comment-input { transition: none; }
}
`;

const getRank = (votes: number) => {
  if (votes >= 100) return "👑 Market Legend";
  if (votes >= 50) return "🏆 Market Analyst";
  if (votes >= 25) return "💼 Active Investor";
  if (votes >= 10) return "📈 Rookie Investor";
  return "🌱 Newcomer";
};

export default function PredictionsPage() {
  /**
   * What the one read of localStorage produced.
   *
   *   null      — not read yet, so the page renders no list at all
   *   undefined — read, and the stored value was unusable
   *   array     — read, and this is the list (empty when nothing is saved)
   *
   * Three outcomes in one value, because the read has exactly one place to
   * report back from. localStorage is synchronous, so there is nothing to wait
   * for and no loading state that could hold a skeleton. Before this, the two
   * bad outcomes were both a hard crash: a value that would not parse threw out
   * of the effect, and one that parsed but was not a list threw on .filter
   * during render. Either way the whole app shell was replaced by "This page
   * couldn't load".
   */
  const [predictions, setPredictions] = useState<any[] | null | undefined>(null);

  const [symbol, setSymbol] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [date, setDate] = useState("");

  const [direction, setDirection] = useState("Bullish");

  const username =
    typeof window !== "undefined"
      ? localStorage.getItem("username") || "Anonymous"
      : "Anonymous";

  useEffect(() => {
    let saved;

    try {
      const stored = JSON.parse(localStorage.getItem("predictions") || "[]");

      // A stored value that is not a list is as unusable as one that will not
      // parse; rendering it would throw on .filter instead of saying anything.
      if (Array.isArray(stored)) saved = stored;
    } catch (error) {
      console.error("Predictions storage read error:", error);
    }

    setPredictions(saved);
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
      // predictions is null before the first read and undefined after a failed
      // one. Both start the list from nothing, which is what the read left
      // behind in each case, so a save after either one stores the new
      // prediction alone — exactly what it stored before.
      ...(predictions ?? []),
    ];

    setPredictions(updatedPredictions);

    localStorage.setItem("predictions", JSON.stringify(updatedPredictions));

    // direction is deliberately not reset here — the original left the chosen
    // value in the select, and so does this.
    setSymbol("");
    setTargetPrice("");
    setDate("");

    alert("Prediction Saved");
  };

  const pendingPredictions = (predictions ?? []).filter(
    (prediction) => prediction.status === "Pending"
  );

  const completedPredictions = (predictions ?? []).filter(
    (prediction) => prediction.status !== "Pending"
  );

  return (
    <div className="pred-root">
      <style>{PRED_STYLES}</style>

      <div className="pred-shell">
        <h1 className="pred-title">🎯 Stock Predictions</h1>

        <div className="pred-panel">
          <div className="pred-field">
            <label className="pred-label" htmlFor="pred-symbol">
              Stock Symbol
            </label>

            <input
              id="pred-symbol"
              className="pred-input"
              placeholder="Stock Symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
            />
          </div>

          <div className="pred-field">
            <label className="pred-label" htmlFor="pred-target">
              Target Price
            </label>

            <input
              id="pred-target"
              className="pred-input"
              placeholder="Target Price"
              value={targetPrice}
              onChange={(e) => setTargetPrice(e.target.value)}
            />
          </div>

          <div className="pred-field">
            <label className="pred-label" htmlFor="pred-date">
              Target Date
            </label>

            <input
              id="pred-date"
              className="pred-input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>

          <div className="pred-field">
            <label className="pred-label" htmlFor="pred-direction">
              Direction
            </label>

            <select
              id="pred-direction"
              className="pred-input"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="Bullish">📈 Bullish</option>

              <option value="Bearish">📉 Bearish</option>
            </select>
          </div>

          <button className="pred-btn pred-btn-primary" onClick={savePrediction}>
            Save Prediction
          </button>
        </div>

        {/* Nothing is rendered until the read has happened: showing the empty
            sections first would tell someone with saved predictions that they
            have none, for as long as it took the effect to run. */}
        {predictions === null ? null : predictions === undefined ? (
          <p className="pred-note" role="status">
            Your saved predictions could not be read.
          </p>
        ) : (
          <>
            <section className="pred-section">
              <h2 className="pred-section-title">⏳ Pending Predictions</h2>

              {pendingPredictions.length === 0 ? (
                <p className="pred-empty">No pending predictions.</p>
              ) : (
                <div className="pred-grid">
                  {/* The index is the pending list's own, and the handlers
                      below write to predictions[index] — the same record the
                      original wrote to. See the note in the report: when a
                      completed prediction sits above a pending one, that is
                      the wrong record. It is a pre-existing defect and it is
                      reproduced here unchanged rather than fixed silently. */}
                  {pendingPredictions.map((prediction, index) => (
                    <article key={index} className="pred-card">
                      <h3 className="pred-symbol">{prediction.symbol}</h3>

                      <Link
                        href={`/profile/${prediction.username}`}
                        className="pred-user"
                      >
                        👤 {prediction.username}
                      </Link>

                      <p className="pred-rank">
                        {getRank(
                          (prediction.agrees || 0) + (prediction.disagrees || 0)
                        )}
                      </p>

                      <p className="pred-target">
                        🎯 Target Price: ₹{prediction.targetPrice}
                      </p>

                      <p className="pred-line">📅 Target Date: {prediction.date}</p>

                      <p
                        className={`pred-direction ${
                          prediction.direction === "Bullish"
                            ? "pred-up"
                            : "pred-down"
                        }`}
                      >
                        {prediction.direction === "Bullish"
                          ? "📈 Bullish"
                          : "📉 Bearish"}
                      </p>

                      <p
                        className={`pred-status ${
                          prediction.status === "Correct"
                            ? "pred-status-correct"
                            : prediction.status === "Wrong"
                            ? "pred-status-wrong"
                            : "pred-status-pending"
                        }`}
                      >
                        📌 Status: {prediction.status}
                      </p>

                      <div className="pred-actions">
                        <button
                          className="pred-btn pred-btn-agree"
                          onClick={() => {
                            const updated = [...(predictions ?? [])];

                            updated[index].agrees += 1;

                            setPredictions(updated);

                            localStorage.setItem(
                              "predictions",
                              JSON.stringify(updated)
                            );
                          }}
                        >
                          👍 {prediction.agrees}
                        </button>

                        <button
                          className="pred-btn pred-btn-disagree"
                          onClick={() => {
                            const updated = [...(predictions ?? [])];

                            updated[index].disagrees += 1;

                            setPredictions(updated);

                            localStorage.setItem(
                              "predictions",
                              JSON.stringify(updated)
                            );
                          }}
                        >
                          👎 {prediction.disagrees}
                        </button>

                        <div className="pred-verdicts">
                          <button
                            className="pred-btn pred-btn-correct"
                            onClick={() => {
                              const updated = [...(predictions ?? [])];

                              updated[index].status = "Correct";

                              setPredictions(updated);

                              localStorage.setItem(
                                "predictions",
                                JSON.stringify(updated)
                              );
                            }}
                          >
                            ✅ Correct
                          </button>

                          <button
                            className="pred-btn pred-btn-wrong"
                            onClick={() => {
                              const updated = [...(predictions ?? [])];

                              updated[index].status = "Wrong";

                              setPredictions(updated);

                              localStorage.setItem(
                                "predictions",
                                JSON.stringify(updated)
                              );
                            }}
                          >
                            ❌ Wrong
                          </button>
                        </div>
                      </div>

                      <div className="pred-comments">
                        <input
                          className="pred-comment-input"
                          placeholder="Add a comment..."
                          aria-label="Add a comment..."
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              const updated = [...(predictions ?? [])];

                              if (!updated[index].comments) {
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
                        />

                        <div className="pred-comment-list">
                          {prediction.comments?.map(
                            (comment: any, i: number) => (
                              <div key={i} className="pred-comment">
                                <p className="pred-comment-user">
                                  👤 {comment.username}
                                </p>

                                <p className="pred-comment-time">
                                  🕒 {comment.time}
                                </p>

                                <p className="pred-comment-text">
                                  💬 {comment.text}
                                </p>
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="pred-section">
              <h2 className="pred-section-title">✅ Completed Predictions</h2>

              {completedPredictions.length === 0 ? (
                <p className="pred-empty">No completed predictions.</p>
              ) : (
                <div className="pred-grid">
                  {completedPredictions.map((prediction, index) => (
                    <article key={index} className="pred-card">
                      <h3 className="pred-symbol">{prediction.symbol}</h3>

                      <Link
                        href={`/profile/${prediction.username}`}
                        className="pred-user"
                      >
                        👤 {prediction.username}
                      </Link>

                      <p className="pred-target">🎯 ₹{prediction.targetPrice}</p>

                      <p className="pred-line">📅 {prediction.date}</p>

                      <p
                        className={`pred-status ${
                          prediction.status === "Correct"
                            ? "pred-status-correct"
                            : "pred-status-wrong"
                        }`}
                      >
                        {prediction.status === "Correct"
                          ? "✅ Correct"
                          : "❌ Wrong"}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
