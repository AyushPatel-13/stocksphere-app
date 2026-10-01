"use client";

import { useEffect, useState } from "react";

/**
 * The input and the Post button now use the app's form idiom — .ev-input and
 * the primary green button — instead of a #444 border on #222 and white text
 * on #22c55e (1.9:1). The card and heading match the Company Overview card
 * beside them.
 *
 * The comment list, the localStorage key and the submit behaviour are
 * untouched.
 */
const SD_STYLES = `
.sd-input {
  flex: 1;
  min-width: 0;
  padding: 11px 12px;
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  color: #fff;
  font-family: inherit;
  font-size: 14px;
  transition: border-color 150ms ease;
}
.sd-input::placeholder { color: #666; }
.sd-input:hover { border-color: #333; }
.sd-input:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 1px;
  border-color: #22c55e;
}
.sd-submit {
  flex: none;
  padding: 11px 18px;
  border: 1px solid transparent;
  border-radius: 10px;
  background: #22c55e;
  color: #000;
  font-family: inherit;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms ease, transform 150ms ease;
}
.sd-submit:hover { background: #1ea34d; }
.sd-submit:active { transform: translateY(1px); }
.sd-submit:focus-visible {
  outline: 2px solid #22c55e;
  outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) {
  .sd-input, .sd-submit { transition: none; }
}
`;

export default function StockDiscussion({
  symbol,
}: {
  symbol: string;
}) {
  const [comment, setComment] =
    useState("");

  const [comments, setComments] =
    useState<any[]>([]);

  useEffect(() => {
    const saved = JSON.parse(
      localStorage.getItem(
        `stockDiscussions_${symbol}`
      ) || "[]"
    );

    setComments(saved);
  }, [symbol]);

  const addComment = () => {
    if (!comment.trim()) return;

    const username =
      localStorage.getItem(
        "username"
      ) || "Anonymous";

    const updated = [
      {
        username,
        text: comment,
        time:
          new Date().toLocaleString(),
      },
      ...comments,
    ];

    setComments(updated);

    localStorage.setItem(
  `stockDiscussions_${symbol}`,
  JSON.stringify(updated)
)

    setComment("");
  };

  return (
    <div
      style={{
        marginTop: "30px",
        background: "#111",
        border: "1px solid #222",
        padding: "24px",
        borderRadius: "16px",
      }}
    >
      <style>{SD_STYLES}</style>

      <h2
        style={{
          margin: 0,
          fontSize: "22px",
          fontWeight: 700,
          letterSpacing: "-0.01em",
        }}
      >
        💬 Discussion
      </h2>

      <div
        style={{
          display: "flex",
          gap: "10px",
          marginTop: "15px",
        }}
      >
        <input
          value={comment}
          onChange={(e) =>
            setComment(
              e.target.value
            )
          }
          placeholder={`Discuss ${symbol}...`}
          className="sd-input"
        />

        <button
          onClick={addComment}
          className="sd-submit"
        >
          Post
        </button>
      </div>

      <div
        style={{
          marginTop: "20px",
        }}
      >
        {comments.map(
          (c, index) => (
            <div
              key={index}
              style={{
                background:
                  "#1a1a1a",
                padding: "12px",
                borderRadius:
                  "8px",
                marginBottom:
                  "10px",
              }}
            >
              <p
                style={{
                  color:
                    "#22c55e",
                  fontWeight:
                    "bold",
                }}
              >
                <a
  href={`/profile/${c.username}`}
  style={{
    color: "#22c55e",
    textDecoration: "none",
  }}
>
  👤 {c.username}
</a>
              </p>

              <p
                style={{
                  color:
                    "#888",
                  fontSize:
                    "12px",
                }}
              >
                🕒 {c.time}
              </p>

              <p>
                💬 {c.text}
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
