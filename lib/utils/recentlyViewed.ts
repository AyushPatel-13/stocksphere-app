import { isIndianEquitySymbol } from "../data/instruments/india";

export interface RecentlyViewedAsset {
  symbol: string;
  name?: string;
  type: string;
  market?: string;
  viewedAt: number;
}

const STORAGE_KEY = "stocksphere-recently-viewed";
const MAX_ITEMS = 10;

/**
 * Which market a viewed symbol belongs to. A bare Indian ticker ("TCS") is
 * Indian too: checking only the ".NS" suffix used to label it "US".
 */
export function marketForSymbol(symbol: string): "INDIA" | "US" {
  const upper = symbol.toUpperCase();
  return upper.endsWith(".NS") || upper.endsWith(".BSE") || upper.endsWith(".BO") || isIndianEquitySymbol(upper)
    ? "INDIA"
    : "US";
}

export function getRecentlyViewed(): RecentlyViewedAsset[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      return [];
    }

    const parsed: RecentlyViewedAsset[] = JSON.parse(stored);

    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addRecentlyViewed(
  asset: RecentlyViewedAsset
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const existing = getRecentlyViewed();

    const previous = existing.find(
      (item) =>
        item.symbol.toUpperCase() === asset.symbol.toUpperCase() &&
        item.type === asset.type
    );

    const filtered = existing.filter(
      (item) =>
        !(
          item.symbol.toUpperCase() ===
            asset.symbol.toUpperCase() &&
          item.type === asset.type
        )
    );

    const updated = [
      {
        ...asset,
        // Keep a name learned on an earlier visit if this one has none.
        name: asset.name || previous?.name,
        viewedAt: Date.now(),
      },
      ...filtered,
    ].slice(0, MAX_ITEMS);

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(updated)
    );
  } catch {
    // Ignore localStorage errors
  }
}

export function clearRecentlyViewed(): void {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.removeItem(STORAGE_KEY);
}