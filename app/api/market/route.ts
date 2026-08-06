import { NextResponse } from "next/server";
import { getMarketQuote } from "@/lib/providers/market.provider";

export async function GET() {
  const symbols = {
    apple: "AAPL",
    microsoft: "MSFT",
    tesla: "TSLA",
    nvidia: "NVDA",
  };

  const [apple, microsoft, tesla, nvidia] = await Promise.all([
    getMarketQuote(symbols.apple),
    getMarketQuote(symbols.microsoft),
    getMarketQuote(symbols.tesla),
    getMarketQuote(symbols.nvidia),
  ]);

  return NextResponse.json({
    apple,
    microsoft,
    tesla,
    nvidia,
  });
}