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
      <section className="mt-14">
        <h2 className="text-[22px] sm:text-[26px] font-bold tracking-tight mb-5">
          🔥 Trending Stocks
        </h2>

        {trending.length === 0 ? (
          <p className="rounded-xl bg-[#151515] p-4 text-sm text-[#888]">
            No discussions yet — trending stocks appear once people
            start talking about them.
          </p>
        ) : (
          <div className="grid md:grid-cols-3 gap-4 sm:gap-6">
            {trending.map((stock) => (
              <div
  key={stock.symbol}
  onClick={() =>
    router.push(`/stock/${stock.symbol}`)
  }
  className="
    rounded-2xl
    border
    border-[#222]
    bg-[#111]
    p-5
    cursor-pointer
    transition-colors
    hover:border-[#2e2e2e]
    hover:bg-[#161616]
  "
>
                <p className="text-[15px] font-semibold">
                  {stock.symbol}
                </p>

                <p className="mt-1 text-sm tabular-nums text-[#888]">
                  {stock.count} Discussions
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-14">
        <h2 className="text-[22px] sm:text-[26px] font-bold tracking-tight mb-5">
          🏆 Top Predictors
        </h2>

        {leaders.length === 0 ? (
          <p className="rounded-xl bg-[#151515] p-4 text-sm text-[#888]">
            No predictions recorded yet.
          </p>
        ) : (
          <div className="grid md:grid-cols-3 gap-4 sm:gap-6">
            {leaders.map((user: any) => (
              <div
  key={user.username}
  onClick={() =>
    router.push(
      `/profile/${user.username}`
    )
  }
  className="
    rounded-2xl
    border
    border-[#222]
    bg-[#111]
    p-5
    cursor-pointer
    transition-colors
    hover:border-[#2e2e2e]
    hover:bg-[#161616]
  "
>
                <p className="truncate text-[15px] font-semibold">
                  {user.username}
                </p>

                <p className="mt-1 text-sm tabular-nums text-[#4ade80]">
                  ✅ {user.correct} Correct
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-14">
  <h2 className="text-[22px] sm:text-[26px] font-bold tracking-tight mb-5">
    📅 Upcoming Events
  </h2>

  {events.length === 0 ? (
    <p className="rounded-xl bg-[#151515] p-4 text-sm text-[#888]">
      No upcoming events.
    </p>
  ) : (
    <div className="grid md:grid-cols-3 gap-4 sm:gap-6">
      {events.map(
        (event: any, index) => (
          <div
            key={index}
            className="rounded-2xl border border-[#222] bg-[#111] p-5"
          >
            <p className="text-[15px] font-semibold">
              {event.symbol}
            </p>

            <p className="mt-2 text-sm text-[#888]">
              📌 {event.eventType}
            </p>

            <p className="mt-1 text-sm text-[#888]">
              📅 {event.eventDate}
            </p>
          </div>
        )
      )}
    </div>
  )}
</section>

    </>
  );
}