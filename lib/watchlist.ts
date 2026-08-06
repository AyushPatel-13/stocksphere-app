import { supabase } from "./supabase";
import { addActivity } from "./activity";

export async function addToWatchlist(symbol: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const result = await supabase
    .from("watchlist")
    .insert({
      user_id: user.id,
      symbol,
    });

  await addActivity(`⭐ Added ${symbol} to Watchlist`);

  return result;
}

export async function removeFromWatchlist(symbol: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const result = await supabase
    .from("watchlist")
    .delete()
    .eq("user_id", user.id)
    .eq("symbol", symbol);

  await addActivity(`❌ Removed ${symbol} from Watchlist`);

  return result;
}

export async function getWatchlist() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data } = await supabase
    .from("watchlist")
    .select("symbol")
    .eq("user_id", user.id);

  return data ?? [];
}

export async function isInWatchlist(symbol: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return false;

  const { data } = await supabase
    .from("watchlist")
    .select("id")
    .eq("user_id", user.id)
    .eq("symbol", symbol)
    .maybeSingle();

  return !!data;
}