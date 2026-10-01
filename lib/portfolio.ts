import { supabase } from "./supabase";
import { addActivity } from "./activity";

export async function addHolding(
  symbol: string,
  quantity: number,
  buyPrice: number
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const result = await supabase
    .from("portfolio")
    .insert({
      user_id: user.id,
      symbol,
      quantity,
      buy_price: buyPrice,
    });

  await addActivity(`💼 Bought ${quantity} ${symbol}`);

  return result;
}

export async function getPortfolio() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data } = await supabase
    .from("portfolio")
    .select("*")
    .eq("user_id", user.id);

  return data || [];
}

/**
 * Remove one holding.
 *
 * Scoped by user_id as well as row id. Row-level security is the real control,
 * but this repository contains no migrations or schema, so RLS cannot be
 * confirmed from source and must not be assumed — and without the second
 * filter the only thing deciding whose row `id` names is the caller. A row
 * belonging to somebody else now matches nothing instead of being deleted.
 *
 * Same convention as addHolding(): no authenticated user, no mutation.
 */
export async function removeHolding(id: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const result = await supabase
    .from("portfolio")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  await addActivity("🗑 Removed a portfolio holding");

  return result;
}

/**
 * Update one holding's quantity and buy price.
 *
 * user-scoped for the same reason as removeHolding() above: the row id alone
 * does not establish who owns the row.
 */
export async function updateHolding(
  id: string,
  quantity: number,
  buyPrice: number
) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  return await supabase
    .from("portfolio")
    .update({
      quantity,
      buy_price: buyPrice,
    })
    .eq("id", id)
    .eq("user_id", user.id);
}