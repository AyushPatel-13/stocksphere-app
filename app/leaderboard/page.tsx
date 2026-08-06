"use client";

import { useEffect, useState } from "react";

export default function LeaderboardPage() {
  const [leaders, setLeaders] = useState<any[]>([]);

  useEffect(() => {
    const predictions = JSON.parse(
      localStorage.getItem("predictions") || "[]"
    );

    const users: any = {};

    predictions.forEach((prediction: any) => {
      const username = prediction.username;

      if (!users[username]) {
  users[username] = {
    username,
    predictions: 0,
    correct: 0,
    wrong: 0,
  };
}

      users[username].predictions += 1;

      if (
  prediction.status === "Correct"
) {
  users[username].correct += 1;
}

if (
  prediction.status === "Wrong"
) {
  users[username].wrong += 1;
}
    });

    const leaderboard = Object.values(users)
  .map((user: any) => {
  const accuracy =
    user.predictions > 0
      ? (
          (user.correct /
            user.predictions) *
          100
        ).toFixed(1)
      : "0";

  let rank = "🌱 Newcomer";

  if (Number(accuracy) >= 80) {
    rank = "👑 Market Legend";
  } else if (
    Number(accuracy) >= 70
  ) {
    rank = "🏆 Market Analyst";
  } else if (
    Number(accuracy) >= 60
  ) {
    rank = "💼 Active Investor";
  } else if (
    Number(accuracy) >= 50
  ) {
    rank = "📈 Rookie Investor";
  }

  return {
    ...user,
    accuracy,
    rank,
  };
})
  .sort(
  (a: any, b: any) =>
    Number(b.accuracy) -
    Number(a.accuracy)
);

    setLeaders(leaderboard);
  }, []);

  return (
    <div
      style={{
        background: "#000",
        color: "white",
        minHeight: "100vh",
        padding: "40px",
      }}
    >
      <h1>🏆 Prediction Leaderboard</h1>

      <div style={{ marginTop: "30px" }}>
        {leaders.map(
          (user: any, index) => (
            <div
              key={index}
              style={{
                background: "#111",
                padding: "20px",
                borderRadius: "10px",
                marginBottom: "15px",
              }}
            >
              <div>
  <h2>
    <a
  href={`/profile/${user.username}`}
  style={{
    color: "white",
  }}
>
  #{index + 1}
  {" "}
  {user.username}
</a>
  </h2>

  <p
    style={{
      color: "#22c55e",
      fontWeight: "bold",
      marginTop: "5px",
    }}
  >
    {user.rank}
  </p>
</div>

              <p>
                Predictions:{" "}
                {user.predictions}
              </p>

              <p>
  Correct: {user.correct}
</p>

<p>
  Wrong: {user.wrong}
</p>

<p>
  Accuracy: {user.accuracy}%
</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}