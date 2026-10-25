import { chooseReference } from "../predictions/v2/reference";
import type { PredictionMarketData } from "../predictions/v2/sources";
import { getAdminClient } from "../supabase/server";
import { MAX_ORDER_VALUE, checkOrder, type PaperAssetType, type PaperCurrency, type PaperSide } from "./ledger";

/**
 * Paper orders: validated here, priced by the server from live market data,
 * and filled by the database function paper_place_trade in one transaction.
 *
 * Market orders fill only while the market is open (crypto: always) at a
 * quote no older than two minutes — the same freshness rule predictions use.
 * Virtual money only: nothing here talks to a broker.
 */

export type FillRequest = {
  userId: string;
  requestId: string;
  assetType: PaperAssetType;
  symbol: string;
  side: PaperSide;
  quantity: number;
  price: number;
  currency: PaperCurrency;
  priceSource: string;
  priceTime: string;
};

export type FillOutcome = { tradeId: string | null; outcome: "filled" | "replayed" | "insufficient_cash" | "insufficient_holding"; cashAfter: number };

export interface PaperStore {
  verifyToken(token: string): Promise<string | null>;
  fill(request: FillRequest): Promise<FillOutcome>;
}

export type OrderResult =
  | { ok: true; status: 200 | 201; tradeId: string; price: number; currency: PaperCurrency; cashAfter: number; replayed: boolean }
  | { ok: false; status: number; error: string; code: string };

export async function placeOrder(
  input: { token: string | null; requestId?: unknown; assetType?: unknown; symbol?: unknown; side?: unknown; quantity?: unknown },
  store: PaperStore | null,
  market: PredictionMarketData,
  now: number = Date.now()
): Promise<OrderResult> {
  if (!store) return { ok: false, status: 503, error: "Paper trading isn't set up yet.", code: "NOT_CONFIGURED" };
  if (!input.token) return { ok: false, status: 401, error: "Sign in to paper trade.", code: "SIGNED_OUT" };
  const userId = await store.verifyToken(input.token);
  if (!userId) return { ok: false, status: 401, error: "Your session expired. Please sign in again.", code: "SIGNED_OUT" };

  const order = checkOrder(input);
  if (!order.ok) return { ok: false, status: 400, error: order.reason, code: "BAD_REQUEST" };
  const { requestId, assetType, symbol, side, quantity } = order.value;

  const snapshot = await market.snapshot(assetType, symbol, now);
  if (!snapshot) return { ok: false, status: 400, error: "We don't recognise that symbol.", code: "BAD_REQUEST" };

  const currency = snapshot.currency === "USD" ? "USD" : snapshot.currency === "INR" ? "INR" : null;
  if (!currency) return { ok: false, status: 422, error: "Only rupee and dollar instruments can be paper traded.", code: "RULES" };

  const reference = chooseReference({ assetType, now, session: snapshot.session, live: snapshot.live, lastClose: snapshot.lastClose });
  if ("error" in reference) {
    return { ok: false, status: 503, error: "The live price is delayed right now. Try again in a minute.", code: "PRICE_UNAVAILABLE" };
  }
  if (reference.mode !== "live") {
    return { ok: false, status: 409, error: "The market is closed. Orders fill during market hours.", code: "MARKET_CLOSED" };
  }

  // A converted quote (BTC in rupees from the dollar pair) arrives as a float
  // like 7600305.873199999; the ledger stores what a contract note would show.
  const price = fillPrice(reference.price);
  const value = price * quantity;
  if (value > MAX_ORDER_VALUE[currency]) {
    return { ok: false, status: 422, error: `One order can be worth at most ${currency === "INR" ? "₹10,00,000" : "$10,000"}.`, code: "RULES" };
  }

  const fill = await store.fill({
    userId,
    requestId,
    assetType,
    symbol: snapshot.symbol,
    side,
    quantity,
    price,
    currency,
    priceSource: reference.source,
    priceTime: new Date(reference.quoteTime).toISOString(),
  });

  if (fill.outcome === "insufficient_cash") return { ok: false, status: 422, error: "Not enough virtual cash for this order.", code: "INSUFFICIENT_CASH" };
  if (fill.outcome === "insufficient_holding") return { ok: false, status: 422, error: "You don't hold that many to sell.", code: "INSUFFICIENT_HOLDING" };
  if (!fill.tradeId) throw new Error("Paper fill returned no trade id");

  return {
    ok: true,
    status: fill.outcome === "replayed" ? 200 : 201,
    tradeId: fill.tradeId,
    price,
    currency,
    cashAfter: Number(fill.cashAfter),
    replayed: fill.outcome === "replayed",
  };
}

/** Two decimals, or six significant digits for a sub-unit price (a 0.12 coin keeps its precision). */
export function fillPrice(price: number): number {
  return price >= 1 ? Math.round(price * 100) / 100 : Number(price.toPrecision(6));
}

export function getPaperStore(): PaperStore | null {
  const admin = getAdminClient();
  if (!admin) return null;

  return {
    async verifyToken(token) {
      const { data, error } = await admin.auth.getUser(token);
      return error || !data.user ? null : data.user.id;
    },

    async fill(request) {
      const { data, error } = await admin.rpc("paper_place_trade", {
        p_user: request.userId,
        p_request: request.requestId,
        p_asset_type: request.assetType,
        p_symbol: request.symbol,
        p_side: request.side,
        p_quantity: request.quantity,
        p_price: request.price,
        p_currency: request.currency,
        p_price_source: request.priceSource,
        p_price_time: request.priceTime,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : data) as { trade_id: string | null; outcome: FillOutcome["outcome"]; cash_after: number | string };
      return { tradeId: row.trade_id, outcome: row.outcome, cashAfter: Number(row.cash_after) };
    },
  };
}
