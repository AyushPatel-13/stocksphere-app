import { getYahooChartQuotes, type ChartQuote } from "../apis/yahooChart";
import { BONDS, CRYPTO, ETFS, cryptoAsset, type CatalogAsset } from "../data/assets";

/**
 * Live quotes for a hub page (ETFs, crypto, bonds): the catalog with each
 * entry's price and day change from Yahoo's chart endpoint. An entry Yahoo
 * couldn't price keeps `price: null` and shows as unavailable.
 */

export type HubType = "etf" | "crypto" | "bond";

export type BoardItem = Omit<CatalogAsset, "yahoo"> & {
  price: number | null;
  change: number | null;
  changePercent: number | null;
  marketTime: string | null;
};

export type AssetBoard = {
  type: HubType;
  vs: "INR" | "USD";
  items: BoardItem[];
  fetchedAt: string;
};

export function catalogFor(type: HubType, vs: "INR" | "USD"): CatalogAsset[] {
  if (type === "etf") return ETFS;
  if (type === "bond") return BONDS;
  return CRYPTO.map((coin) => cryptoAsset(coin.symbol, vs)).filter((a): a is CatalogAsset => a !== null);
}

export function toBoardItems(
  catalog: CatalogAsset[],
  quotes: Record<string, ChartQuote> | null
): BoardItem[] {
  return catalog.map(({ yahoo, ...asset }) => {
    const quote = quotes?.[yahoo];
    return {
      ...asset,
      price: quote?.price ?? null,
      change: quote?.change ?? null,
      changePercent: quote?.changePercent ?? null,
      marketTime: quote?.marketTime ?? null,
    };
  });
}

const TTL_MS = 60_000;

export function createBoardLoader(
  fetchQuotes: typeof getYahooChartQuotes = getYahooChartQuotes,
  now: () => number = Date.now
) {
  const cache = new Map<string, { at: number; board: AssetBoard }>();

  return async function getAssetBoard(type: HubType, vs: "INR" | "USD"): Promise<AssetBoard> {
    const key = `${type}|${vs}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL_MS) return hit.board;

    const catalog = catalogFor(type, vs);
    const quotes = await fetchQuotes(catalog.map((asset) => asset.yahoo));
    const board: AssetBoard = {
      type,
      vs,
      items: toBoardItems(catalog, quotes),
      fetchedAt: new Date(now()).toISOString(),
    };

    // A board where nothing priced is an outage: don't keep it.
    if (board.items.some((item) => item.price !== null)) cache.set(key, { at: now(), board });
    return board;
  };
}

export const getAssetBoard = createBoardLoader();
