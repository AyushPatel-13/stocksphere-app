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

export async function removeHolding(id: string) {
  const result = await supabase
    .from("portfolio")
    .delete()
    .eq("id", id);

  await addActivity("🗑 Removed a portfolio holding");

  return result;
}

export async function updateHolding(
  id: string,
  quantity: number,
  buyPrice: number
) {
  return await supabase
    .from("portfolio")
    .update({
      quantity,
      buy_price: buyPrice,
    })
    .eq("id", id);
}