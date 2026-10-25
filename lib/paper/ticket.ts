import { isIndianEquitySymbol } from "../data/instruments/india";
import { SCORING_V2 } from "../predictions/v2/config";
import { MAX_ORDER_VALUE, quantityProblem, type PaperAssetType, type PaperCurrency, type PaperSide } from "./ledger";

/**
 * The order ticket's arithmetic, kept pure so it can be checked without a
 * browser. The server (service.ts) stays the authority: it re-prices the order
 * at its own live quote and re-checks cash and holdings in the database. These
 * checks only stop an order that would certainly be refused.
 */

/** Where an instrument trades, for the header: NSE, BSE, US or Crypto. */
export function exchangeLabel(assetType: PaperAssetType, symbol: string): string {
  if (assetType === "crypto") return "Crypto";
  const upper = symbol.toUpperCase();
  if (upper.endsWith(".BO")) return "BSE";
  if (upper.endsWith(".NS") || isIndianEquitySymbol(upper)) return "NSE";
  return "US";
}

export type QuoteStatus = "open" | "delayed" | "closed" | "unavailable";

/**
 * How current the latest price is, from the 1-day history:
 *   open      — inside the trading session and the newest bar is recent;
 *   delayed   — inside the session but the newest bar is older than that;
 *   closed    — outside the session: the price is the last traded one;
 *   unavailable — no price at all.
 * FRESH_MS is the server's own fill rule (a quote no older than two minutes),
 * so "Market open" never shows for a price the engine would call delayed.
 */
export const FRESH_MS = SCORING_V2.submission.maxQuoteAgeSeconds * 1000;

export function quoteStatus(input: {
  assetType: PaperAssetType;
  now: number;
  lastTime: number | null;
  sessionStart: number | null;
  sessionEnd: number | null;
}): QuoteStatus {
  const { assetType, now, lastTime, sessionStart, sessionEnd } = input;
  if (lastTime === null) return "unavailable";
  const fresh = now - lastTime <= FRESH_MS;
  if (assetType === "crypto") return fresh ? "open" : "delayed";
  if (sessionStart === null || sessionEnd === null) return fresh ? "open" : "closed";
  if (now < sessionStart || now >= sessionEnd) return "closed";
  return fresh ? "open" : "delayed";
}

export type TicketReview = {
  quantity: number | null;
  /** price × quantity, or null when either is unknown. */
  value: number | null;
  /** The first reason the order can't go through, or null. */
  problem: string | null;
};

export function reviewTicket(input: {
  side: PaperSide;
  assetType: PaperAssetType;
  quantityText: string;
  price: number | null;
  currency: PaperCurrency | null;
  cash: number | null;
  held: number;
}): TicketReview {
  const { side, assetType, price, currency, cash, held } = input;
  const text = input.quantityText.trim();
  if (text === "") return { quantity: null, value: null, problem: "Enter a quantity." };

  const quantity = Number(text);
  const invalid = quantityProblem(assetType, quantity);
  if (invalid) return { quantity: null, value: null, problem: invalid };

  if (side === "sell" && quantity > held + 1e-9) {
    return {
      quantity,
      value: price !== null ? round2(price * quantity) : null,
      problem: held > 0 ? `You hold ${held}. You can't sell more than that.` : "You don't hold any to sell.",
    };
  }

  // Without a price the value can't be estimated; the server prices it.
  if (price === null || !(price > 0) || currency === null) return { quantity, value: null, problem: null };

  const value = round2(price * quantity);
  if (value > MAX_ORDER_VALUE[currency]) {
    return { quantity, value, problem: `One order can be worth at most ${currency === "INR" ? "₹10,00,000" : "$10,000"}.` };
  }
  if (side === "buy" && cash !== null && value > cash) return { quantity, value, problem: "Not enough virtual cash for this order." };

  return { quantity, value, problem: null };
}

/** The most that can be bought with the cash (within the per-order cap), or sold from the holding. */
export function maxQuantity(input: {
  side: PaperSide;
  assetType: PaperAssetType;
  price: number | null;
  currency: PaperCurrency | null;
  cash: number | null;
  held: number;
}): number | null {
  const { side, assetType, price, currency, cash, held } = input;
  if (side === "sell") return held > 0 ? held : null;
  if (price === null || !(price > 0) || currency === null || cash === null) return null;
  const budget = Math.min(cash, MAX_ORDER_VALUE[currency]);
  const raw = budget / price;
  const quantity = assetType === "crypto" ? Math.floor(raw * 1e8) / 1e8 : Math.floor(raw);
  return quantity > 0 ? quantity : null;
}

const round2 = (value: number) => Math.round(value * 100) / 100;
