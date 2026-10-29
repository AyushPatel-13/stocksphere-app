"use client";

import { supabase } from "../supabase";
import type { ThesisDetail, ThesisView } from "./service";

export type ApiError = { error: string; code?: string };

async function token(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function call<T>(path: string, init: RequestInit & { auth?: "required" | "optional" }, pick: (json: Record<string, unknown>) => T, fallback: string): Promise<T | ApiError> {
  const access = init.auth ? await token() : null;
  if (init.auth === "required" && !access) return { error: "Sign in to write a thesis.", code: "SIGNED_OUT" };
  try {
    const response = await fetch(path, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(access ? { Authorization: `Bearer ${access}` } : {}) },
    });
    const json = await response.json();
    return json?.success ? pick(json) : { error: json?.error ?? fallback, code: json?.code };
  } catch {
    return { error: `${fallback} Check your connection.` };
  }
}

export const isApiError = (value: unknown): value is ApiError => Boolean(value && typeof value === "object" && "error" in value);

export function fetchTheses(params: { symbol?: string; user?: string; mine?: boolean; limit?: number }) {
  const query = new URLSearchParams();
  if (params.symbol) query.set("symbol", params.symbol);
  if (params.user) query.set("user", params.user);
  if (params.mine) query.set("mine", "1");
  if (params.limit) query.set("limit", String(params.limit));
  return call(`/api/theses?${query}`, { auth: params.mine ? "required" : undefined }, (j) => j.theses as ThesisView[], "Couldn't load theses.");
}

export function fetchThesis(id: string) {
  return call(`/api/theses/${encodeURIComponent(id)}`, { auth: "optional" }, (j) => ({ thesis: j.thesis as ThesisDetail, scoring: j.scoring as "on" | "off" }), "Couldn't load this thesis.");
}

export function createThesis(symbol: string, content: Record<string, unknown>) {
  return call("/api/theses", { method: "POST", auth: "required", body: JSON.stringify({ symbol, content }) }, (j) => j.id as string, "Couldn't save your thesis.");
}

export function updateThesis(id: string, body: { action: "revise"; content: Record<string, unknown> } | { action: "publish" } | { action: "close" }) {
  return call(`/api/theses/${encodeURIComponent(id)}`, { method: "PATCH", auth: "required", body: JSON.stringify(body) }, () => true, "Couldn't update this thesis.");
}

export function deleteThesis(id: string) {
  return call(`/api/theses/${encodeURIComponent(id)}`, { method: "DELETE", auth: "required" }, () => true, "Couldn't delete this thesis.");
}
