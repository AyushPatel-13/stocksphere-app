export interface RecentlyViewedAsset {
  symbol: string;
  name?: string;
  type: string;
  market?: string;
  viewedAt: number;
}

const STORAGE_KEY = "stocksphere-recently-viewed";
const MAX_ITEMS = 8;

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