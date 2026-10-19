export type NewsRegion = "india" | "us";

export type NewsSourceId = "upstox" | "nse" | "et" | "bs" | "finnhub";

/** One headline, normalised from any source. Plain text only. */
export type NewsItem = {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: NewsSourceId;
  sourceName: string;
  /** "filing" for exchange announcements, "news" for articles. */
  kind: "news" | "filing";
  publishedAt: string;
  /** NSE symbols the item is about, when the source says so. */
  symbols: string[];
};

export type NewsSourceStatus = {
  id: NewsSourceId;
  name: string;
  ok: boolean;
  count: number;
};

export type NewsFeed = {
  region: NewsRegion;
  items: NewsItem[];
  sources: NewsSourceStatus[];
  fetchedAt: string;
};

export const SOURCE_NAMES: Record<NewsSourceId, string> = {
  upstox: "Upstox",
  nse: "NSE filings",
  et: "ET Markets",
  bs: "Business Standard",
  finnhub: "Finnhub",
};
