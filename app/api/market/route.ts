import { NextResponse } from "next/server";

import { getMarketQuote } from "@/lib/providers/market.provider";
import {
  getIndianMarketQuotes,
} from "@/lib/providers/market.provider";

export const revalidate = 60;

const US_SYMBOLS = {
  apple: "AAPL",
  microsoft: "MSFT",
  tesla: "TSLA",
  nvidia: "NVDA",
};

const INDIAN_SYMBOLS = [
  "RELIANCE.NS",
  "TCS.NS",
  "HDFCBANK.NS",
  "INFY.NS",
];

export async function GET() {
  try {
    const [
      apple,
      microsoft,
      tesla,
      nvidia,
      indianQuotes,
    ] = await Promise.all([
      getMarketQuote(US_SYMBOLS.apple),
      getMarketQuote(US_SYMBOLS.microsoft),
      getMarketQuote(US_SYMBOLS.tesla),
      getMarketQuote(US_SYMBOLS.nvidia),
      getIndianMarketQuotes(INDIAN_SYMBOLS),
    ]);

    return NextResponse.json({
      success: true,

      us: {
        apple,
        microsoft,
        tesla,
        nvidia,
      },

      india: indianQuotes,
    });
  } catch (error) {
    console.error(
      "Market API error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        us: {
          apple: null,
          microsoft: null,
          tesla: null,
          nvidia: null,
        },
        india: [],
      },
      { status: 500 }
    );
  }
}