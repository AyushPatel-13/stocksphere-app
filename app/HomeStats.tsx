"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function HomeStats() {
  const router = useRouter();

  const [trending, setTrending] = useState<any[]>([]);
const [leaders, setLeaders] = useState<any[]>([]);
const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    const stocks = [
      "AAPL",
      "TSLA",
      "NVDA",
      "MSFT",
      "RELIANCE",
      "TCS",
      "INFY",
    ];

    const trendingData = stocks
      .map((symbol) => {
        const discussions = JSON.parse(
          localStorage.getItem(
            `stockDiscussions_${symbol}`
          ) || "[]"
        );

        return {
          symbol,
          count: discussions.length,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    setTrending(trendingData);

    const predictions = JSON.parse(
      localStorage.getItem("predictions") || "[]"
    );

    const users: any = {};

    predictions.forEach((p: any) => {
      if (!users[p.username]) {
        users[p.username] = {
          username: p.username,
          correct: 0,
        };
      }

      if (p.status === "Correct") {
        users[p.username].correct++;
      }
    });

    const topUsers = Object.values(users)
      .sort(
        (a: any, b: any) =>
          b.correct - a.correct
      )
      .slice(0, 3);

    setLeaders(topUsers);
    const savedEvents = JSON.parse(
  localStorage.getItem("events") || "[]"
);

setEvents(savedEvents.slice(0, 3));
  }, []);

  return (
    <>
      <section className="px-10 mt-16">
        <h2 className="text-3xl font-bold mb-6">
          🔥 Trending Stocks
        </h2>

        <div className="grid md:grid-cols-3 gap-6">
          {trending.map((stock) => (
            <div
  key={stock.symbol}
  onClick={() =>
    router.push(`/stock/${stock.symbol}`)
  }
  className="
    bg-gray-900
    p-6
    rounded-xl
    cursor-pointer
    hover:bg-gray-800
  "
>
              {stock.symbol} - {stock.count} Discussions
            </div>
          ))}
        </div>
      </section>

      <section className="px-10 mt-16">
        <h2 className="text-3xl font-bold mb-6">
          🏆 Top Predictors
        </h2>

        <div className="grid md:grid-cols-3 gap-6">
          {leaders.map((user: any) => (
            <div
  key={user.username}
  onClick={() =>
    router.push(
      `/profile/${user.username}`
    )
  }
  className="
    bg-gray-900
    p-6
    rounded-xl
    cursor-pointer
    hover:bg-gray-800
  "
>
              {user.username}
              <br />
              ✅ {user.correct} Correct
            </div>
          ))}
        </div>
      </section>

      <section className="px-10 mt-16">
  <h2 className="text-3xl font-bold mb-6">
    📅 Upcoming Events
  </h2>

  <div className="grid md:grid-cols-3 gap-6">
    {events.map(
      (event: any, index) => (
        <div
          key={index}
          className="bg-gray-900 p-6 rounded-xl"
        >
          <h3>{event.symbol}</h3>

          <p>
            📌 {event.eventType}
          </p>

          <p>
            📅 {event.eventDate}
          </p>
        </div>
      )
    )}
  </div>
</section>

    </>
  );
}