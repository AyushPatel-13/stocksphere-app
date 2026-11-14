import { normaliseCriteria, type ScreenCriteria } from "../analytics/screener";

/**
 * Saved screener screens. A signed-in member's screens are kept with their
 * account (the saved_screens table), so they follow them to every device; a
 * visitor's, and everyone's until that table exists, are kept in this
 * browser. The page is told which, so it can say where a screen is saved.
 *
 * The storage is injected (a Supabase-backed one in the browser, fakes in
 * tests). Criteria are normalised on the way in and on the way out: nothing
 * read from either store is trusted as-is.
 */

export type SavedScreen = { name: string; criteria: ScreenCriteria };
export type SavedScreens = { where: "account" | "device"; screens: SavedScreen[] };

export const MAX_SAVED_SCREENS = 10;
export const SAVED_KEY = "stocksphere.screener.saved";

/** The account side. Each method answers "unavailable" when signed out or the table isn't there yet. */
export interface AccountScreens {
  list(): Promise<{ name: string; criteria: unknown }[] | "unavailable">;
  /** Replace the screen of this name, or add it. "full" when the member already has the maximum. */
  save(name: string, criteria: ScreenCriteria): Promise<"saved" | "full" | "unavailable">;
  remove(name: string): Promise<"removed" | "unavailable">;
}

export type DeviceStorage = Pick<Storage, "getItem" | "setItem">;

/** A screen's name as it's kept: single spaces, trimmed, at most 40 characters; null when nothing is left. */
export function cleanScreenName(raw: string | null | undefined): string | null {
  const name = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, 40).trim();
  return name ? name : null;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function clean(rows: unknown): SavedScreen[] {
  if (!Array.isArray(rows)) return [];
  const screens: SavedScreen[] = [];
  for (const row of rows) {
    const rawName = row && typeof row === "object" ? (row as { name?: unknown }).name : null;
    const name = typeof rawName === "string" ? cleanScreenName(rawName) : null;
    if (!name || screens.some((s) => sameName(s.name, name))) continue;
    screens.push({ name, criteria: normaliseCriteria((row as { criteria?: unknown }).criteria) });
    if (screens.length === MAX_SAVED_SCREENS) break;
  }
  return screens;
}

export function readDevice(storage: DeviceStorage | null): SavedScreen[] {
  try {
    return clean(JSON.parse(storage?.getItem(SAVED_KEY) ?? "[]"));
  } catch {
    return [];
  }
}

function writeDevice(storage: DeviceStorage | null, screens: SavedScreen[]): void {
  try {
    storage?.setItem(SAVED_KEY, JSON.stringify(screens.slice(0, MAX_SAVED_SCREENS)));
  } catch {
    // Storage unavailable: the screen just doesn't persist on this device.
  }
}

export async function loadScreens(account: AccountScreens, storage: DeviceStorage | null): Promise<SavedScreens> {
  const rows = await account.list().catch(() => "unavailable" as const);
  return rows === "unavailable" ? { where: "device", screens: readDevice(storage) } : { where: "account", screens: clean(rows) };
}

export type SaveResult = { ok: true; saved: SavedScreens } | { ok: false; reason: "name" | "full" };

/** Save under a name, replacing a screen of the same name. Newest first. */
export async function saveScreen(rawName: string | null, criteria: ScreenCriteria, account: AccountScreens, storage: DeviceStorage | null): Promise<SaveResult> {
  const name = cleanScreenName(rawName);
  if (!name) return { ok: false, reason: "name" };
  const screen = { name, criteria: normaliseCriteria(criteria) };

  const outcome = await account.save(name, screen.criteria).catch(() => "unavailable" as const);
  if (outcome === "full") return { ok: false, reason: "full" };
  if (outcome === "saved") return { ok: true, saved: await loadScreens(account, storage) };

  const existing = readDevice(storage);
  const replacing = existing.some((s) => sameName(s.name, name));
  if (!replacing && existing.length >= MAX_SAVED_SCREENS) return { ok: false, reason: "full" };
  const screens = [screen, ...existing.filter((s) => !sameName(s.name, name))];
  writeDevice(storage, screens);
  return { ok: true, saved: { where: "device", screens } };
}

export async function removeScreen(name: string, account: AccountScreens, storage: DeviceStorage | null): Promise<SavedScreens> {
  const outcome = await account.remove(name).catch(() => "unavailable" as const);
  if (outcome === "removed") return loadScreens(account, storage);
  const screens = readDevice(storage).filter((s) => !sameName(s.name, name));
  writeDevice(storage, screens);
  return { where: "device", screens };
}
