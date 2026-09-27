import { NextResponse } from "next/server";

import {
  getNifty50Quotes,
} from "@/lib/providers/market.provider";

export const revalidate = 60;

export async function GET() {
  try {
    const quotes =
      await getNifty50Quotes();

    const advancing = quotes.filter(
      (quote) =>
        (quote.changePercent ?? 0) > 0
    );

    const declining = quotes.filter(
      (quote) =>
        (quote.changePercent ?? 0) < 0
    );

    const unchanged = quotes.filter(
      (quote) =>
        (quote.changePercent ?? 0) === 0
    );

    const totalStocks = quotes.length;

    const breadthPercent =
      totalStocks > 0
        ? (advancing.length / totalStocks) * 100
        : 0;

    let direction:
      | "BULLISH"
      | "BEARISH"
      | "NEUTRAL";

    if (
      advancing.length > declining.length
    ) {
      direction = "BULLISH";
    } else if (
      declining.length > advancing.length
    ) {
      direction = "BEARISH";
    } else {
      direction = "NEUTRAL";
    }

    const gainers = [...advancing]
      .sort(
        (a, b) =>
          (b.changePercent ?? 0) -
          (a.changePercent ?? 0)
      )
      .slice(0, 3);

    const losers = [...declining]
      .sort(
        (a, b) =>
          (a.changePercent ?? 0) -
          (b.changePercent ?? 0)
      )
      .slice(0, 3);

    return NextResponse.json({
      success: true,

      universe: "NIFTY_50",

      totalStocks,

      advancing: advancing.length,

      declining: declining.length,

      unchanged: unchanged.length,

      direction,

      breadthPercent,

      gainers,

      losers,
    });
  } catch (error) {
    console.error(
      "Nifty 50 market movers error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        universe: "NIFTY_50",
        totalStocks: 0,
        advancing: 0,
        declining: 0,
        unchanged: 0,
        direction: "NEUTRAL",
        breadthPercent: 0,
        gainers: [],
        losers: [],
      },
      { status: 500 }
    );
  }
}