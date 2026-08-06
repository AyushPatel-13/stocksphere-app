"use client";

import { useEffect, useState } from "react";

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
        padding: "20px",
        borderRadius: "10px",
      }}
    >
      <h2>💬 Discussion</h2>

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
          style={{
            flex: 1,
            padding: "12px",
            background: "#222",
            color: "white",
            border:
              "1px solid #444",
            borderRadius: "8px",
          }}
        />

        <button
          onClick={addComment}
          style={{
            background:
              "#22c55e",
            color: "white",
            border: "none",
            padding:
              "12px 20px",
            borderRadius: "8px",
            cursor: "pointer",
          }}
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