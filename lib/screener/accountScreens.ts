"use client";

import { supabase } from "@/lib/supabase";
import type { AccountScreens } from "./savedScreens";

/**
 * The member's saved screens in Supabase (saved_screens), under their own
 * session: RLS limits every read and write to their own rows. Signed out,
 * or before the table's migration is applied, every method answers
 * "unavailable" and the screener falls back to this browser.
 */

async function signedIn(): Promise<boolean> {
  const { data } = await supabase.auth.getSession();
  return Boolean(data.session);
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const accountScreens: AccountScreens = {
  async list() {
    if (!(await signedIn())) return "unavailable";
    const { data, error } = await supabase.from("saved_screens").select("name, criteria").order("created_at", { ascending: false }).limit(10);
    if (error) return "unavailable";
    return data ?? [];
  },

  async save(name, criteria) {
    if (!(await signedIn())) return "unavailable";
    const existing = await supabase.from("saved_screens").select("id, name");
    if (existing.error) return "unavailable";

    const match = (existing.data ?? []).find((row) => same(String(row.name), name));
    const { error } = match
      ? await supabase.from("saved_screens").update({ name, criteria }).eq("id", match.id)
      : await supabase.from("saved_screens").insert({ name, criteria });
    if (!error) return "saved";
    // P0001 is the table's own ten-screen limit.
    // Anything else (the table not there yet, a network failure): fall back to this browser.
    return error.code === "P0001" ? "full" : "unavailable";
  },

  async remove(name) {
    if (!(await signedIn())) return "unavailable";
    const existing = await supabase.from("saved_screens").select("id, name");
    if (existing.error) return "unavailable";
    const match = (existing.data ?? []).find((row) => same(String(row.name), name));
    if (!match) return "removed";
    const { error } = await supabase.from("saved_screens").delete().eq("id", match.id);
    return error ? "unavailable" : "removed";
  },
};
