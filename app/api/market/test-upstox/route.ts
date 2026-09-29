import { NextResponse } from "next/server";

import {
  getNifty50Quotes,
} from "@/lib/providers/market.provider";

import {
  NIFTY_50_SYMBOLS,
} from "@/lib/data/instruments/india";

export async function GET() {
  try {
    const quotes =
      await getNifty50Quotes();

    const returnedSymbols =
      new Set(
        quotes.map(
          (quote) =>
            quote.symbol.toUpperCase()
        )
      );

    const missingSymbols =
      NIFTY_50_SYMBOLS.filter(
        (symbol) =>
          !returnedSymbols.has(
            symbol.toUpperCase()
          )
      );

    return NextResponse.json({
      success: true,
      count: quotes.length,
      expected: NIFTY_50_SYMBOLS.length,
      missingSymbols,
      quotes,
    });
  } catch (error) {
    console.error(
      "Nifty 50 quote test error:",
      error
    );

    return NextResponse.json(
      {
        success: false,
        count: 0,
        expected:
          NIFTY_50_SYMBOLS.length,
        missingSymbols:
          NIFTY_50_SYMBOLS,
        quotes: [],
      },
      { status: 500 }
    );
  }
}