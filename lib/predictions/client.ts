"use client";

import { supabase } from "../supabase";
import type { LeaderRow, PredictionView } from "./service";
import type { Direction, Horizon, PredictionAssetType } from "./rules";

export type ApiError = { error: string; code?: string };

export async function fetchPredictions(params: {
  user?: string;
  symbol?: string;
  status?: "open" | "resolved";
  limit?: number;
}): Promise<PredictionView[] | ApiError> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  try {
    const data = await (await fetch(`/api/predictions?${query.toString()}`)).json();
    return data?.success ? (data.predictions as PredictionView[]) : { error: data?.error ?? "Couldn't load predictions.", code: data?.code };
  } catch {
    return { error: "Couldn't load predictions." };
  }
}

export async function submitPrediction(input: {
  assetType: PredictionAssetType;
  symbol: string;
  direction: Direction;
  horizon: Horizon;
  target?: string;
  note?: string;
}): Promise<{ prediction: PredictionView } | ApiError> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { error: "Sign in to make predictions.", code: "SIGNED_OUT" };

  try {
    const response = await fetch("/api/predictions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    });
    const json = await response.json();
    return json?.success ? { prediction: json.prediction } : { error: json?.error ?? "Couldn't save your prediction.", code: json?.code };
  } catch {
    return { error: "Couldn't save your prediction. Check your connection." };
  }
}

export async function fetchLeaderboard(): Promise<LeaderRow[] | ApiError> {
  try {
    const data = await (await fetch("/api/predictions/leaderboard")).json();
    return data?.success ? (data.leaders as LeaderRow[]) : { error: data?.error ?? "Couldn't load the leaderboard.", code: data?.code };
  } catch {
    return { error: "Couldn't load the leaderboard." };
  }
}

/** "in 3d 4h" / "in 45m" / "due — scoring at the next market close". */
export function timeUntil(iso: string, now: number = Date.now()): string {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return "due — scored at the next market price";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h ${minutes % 60}m`;
  return `in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}
