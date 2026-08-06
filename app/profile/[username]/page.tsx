"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

export default function UserProfilePage() {
  const params = useParams();

  const username =
    params.username as string;

    const [stats, setStats] =
  useState<any>(null);

useEffect(() => {
  const posts = JSON.parse(
    localStorage.getItem(
      "communityPosts"
    ) || "[]"
  );

  const predictions = JSON.parse(
    localStorage.getItem(
      "predictions"
    ) || "[]"
  );

  const myPosts = posts.filter(
    (post: any) =>
      post.author === username
  );

  const totalLikes =
    myPosts.reduce(
      (
        sum: number,
        post: any
      ) =>
        sum +
        (post.likes || 0),
      0
    );

  const myPredictions =
    predictions.filter(
      (prediction: any) =>
        prediction.username ===
        username
    );

  const correct =
    myPredictions.filter(
      (prediction: any) =>
        prediction.status ===
        "Correct"
    ).length;

  const wrong =
    myPredictions.filter(
      (prediction: any) =>
        prediction.status ===
        "Wrong"
    ).length;

  const accuracy =
    myPredictions.length > 0
      ? (
          (correct /
            myPredictions.length) *
          100
        ).toFixed(1)
      : "0";

  let rank =
    "🌱 Newcomer";

  if (
    Number(accuracy) >= 80
  ) {
    rank =
      "👑 Market Legend";
  } else if (
    Number(accuracy) >= 70
  ) {
    rank =
      "🏆 Market Analyst";
  } else if (
    Number(accuracy) >= 60
  ) {
    rank =
      "💼 Active Investor";
  } else if (
    Number(accuracy) >= 50
  ) {
    rank =
      "📈 Rookie Investor";
  }

  setStats({
    posts:
      myPosts.length,
    likes:
      totalLikes,
    predictions:
      myPredictions.length,
    correct,
    wrong,
    accuracy,
    rank,
  });
}, [username]);

return (
<div
  style={{
    background: "#000",
    color: "white",
    minHeight: "100vh",
    padding: "40px",
  }}
>
  <h1>
    👤 {username}
  </h1>

  {stats && (
    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(4, 1fr)",
        gap: "20px",
        marginTop: "30px",
      }}
    >
      <div
        style={{
          background: "#111",
          padding: "20px",
          borderRadius: "10px",
        }}
      >
        <h3>Posts</h3>
        <h2>{stats.posts}</h2>
      </div>

      <div
        style={{
          background: "#111",
          padding: "20px",
          borderRadius: "10px",
        }}
      >
        <h3>Likes</h3>
        <h2>{stats.likes}</h2>
      </div>

      <div
        style={{
          background: "#111",
          padding: "20px",
          borderRadius: "10px",
        }}
      >
        <h3>Predictions</h3>
        <h2>{stats.predictions}</h2>
      </div>

      <div
        style={{
          background: "#111",
          padding: "20px",
          borderRadius: "10px",
        }}
      >
        <h3>Accuracy</h3>
        <h2>
          {stats.accuracy}%
        </h2>
      </div>

      <div
        style={{
          background: "#111",
          padding: "20px",
          borderRadius: "10px",
        }}
      >
        <h3>Correct</h3>
        <h2>{stats.correct}</h2>
      </div>

      <div
        style={{
          background: "#111",
          padding: "20px",
          borderRadius: "10px",
        }}
      >
        <h3>Wrong</h3>
        <h2>{stats.wrong}</h2>
      </div>

      <div
        style={{
          background: "#111",
          padding: "20px",
          borderRadius: "10px",
        }}
      >
        <h3>Rank</h3>
        <h2>{stats.rank}</h2>
      </div>
    </div>
  )}
</div>
);
}