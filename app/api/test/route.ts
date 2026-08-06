import { NextResponse } from "next/server";
import { getStockQuote }
from "@/lib/twelvedata";

export async function GET() {
  const data =
    await getStockQuote("AAPL");

  return NextResponse.json(data);
}