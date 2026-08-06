import { supabase } from "@/lib/supabase";

export async function addActivity(action: string) {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  await supabase.from("activity").insert({
    user_id: user.id,
    action,
  });
}

export async function getActivity() {
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data } = await supabase
    .from("activity")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", {
      ascending: false,
    });

  return data || [];
}