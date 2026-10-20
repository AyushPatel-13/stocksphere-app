"use client";

import { supabase } from "../supabase";
import { isMissingTable } from "../watchlistRules";
import { STARTING_CASH, type PaperAssetType, type PaperCurrency, type PaperSide, type PaperTrade } from "./ledger";

/**
 * Paper account reads (straight from Supabase under the member's session;
 * RLS limits them to their own rows) and order placement (through the
 * server, which prices and fills it).
 */

export type PaperAccount = { cash: Record<PaperCurrency, number>; trades: PaperTrade[] };

export type AccountLoad = { status: "ready"; account: PaperAccount } | { status: "not-set-up" } | { status: "signed-out" };

export async function loadPaperAccount(): Promise<AccountLoad> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { status: "signed-out" };

  const [account, trades] = await Promise.all([
    supabase.from("paper_accounts").select("cash_inr, cash_usd").eq("user_id", auth.user.id).maybeSingle(),
    supabase
      .from("paper_trades")
      .select("id, asset_type, symbol, side, quantity, price, currency, executed_at")
      .order("executed_at", { ascending: false })
      .limit(500),
  ]);

  if (isMissingTable(account.error) || isMissingTable(trades.error)) return { status: "not-set-up" };
  if (account.error) throw account.error;
  if (trades.error) throw trades.error;

  return {
    status: "ready",
    account: {
      // No account row yet means no trades yet: the starting balance.
      cash: account.data
        ? { INR: Number(account.data.cash_inr), USD: Number(account.data.cash_usd) }
        : { ...STARTING_CASH },
      trades: (trades.data ?? []).map((row) => ({
        id: row.id,
        assetType: row.asset_type as PaperAssetType,
        symbol: row.symbol,
        side: row.side as PaperSide,
        quantity: Number(row.quantity),
        price: Number(row.price),
        currency: row.currency as PaperCurrency,
        executedAt: row.executed_at,
      })),
    },
  };
}

export type OrderResponse =
  | { ok: true; price: number; currency: PaperCurrency; replayed: boolean }
  | { ok: false; error: string; code?: string };

export async function submitPaperOrder(order: {
  requestId: string;
  assetType: PaperAssetType;
  symbol: string;
  side: PaperSide;
  quantity: number;
}): Promise<OrderResponse> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, error: "Sign in to paper trade.", code: "SIGNED_OUT" };

  try {
    const response = await fetch("/api/paper/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(order),
    });
    const json = await response.json();
    return json?.success
      ? { ok: true, price: json.price, currency: json.currency, replayed: Boolean(json.replayed) }
      : { ok: false, error: json?.error ?? "Couldn't place the order.", code: json?.code };
  } catch {
    return { ok: false, error: "Couldn't place the order. Check your connection." };
  }
}
