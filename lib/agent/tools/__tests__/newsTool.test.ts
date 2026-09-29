import { test } from "node:test";
import assert from "node:assert/strict";
import { createNewsTool } from "../newsTool";
import {
  newsIdFromUrl,
  normalizeUpstoxNews,
  parseUpstoxPublishedTime,
} from "@/lib/adapters/news";
import {
  fetchGlobalNews,
  fetchIndianNews,
  fetchNews,
  type IndianInstrumentLookup,
  type IndianNewsLookup,
} from "@/lib/providers/news";
import type { UpstoxNewsItem } from "@/lib/apis/upstoxNews";
import type { NewsArticle } from "@/lib/types/news";

// --- Fixtures ---------------------------------------------------------------

// The first article Upstox returned live for TCS (instrument_key
// NSE_EQ|INE467B01029), verbatim. published_time is unix MILLISECONDS.
const tcsArticle = {
  heading:
    "Infosys, HCL Tech, Persistent, among other IT stocks drag Nifty IT down 2%; here are key things to know",
  summary:
    "IT stocks were declining on Tuesday, September 22, as investors focused on the elevated US Treasury yields and capital outflow from emerging markets like Indian markets.",
  thumbnail:
    "https://assets.upstox.com/content/assets/images/news/marketfactors15sept24.webp",
  article_link:
    "https://upstox.com/news/market-news/stocks/infosys-hcl-tech-persistent-among-other-it-stocks-drag-nifty-it-down-2-here-are-key-things-to-know/article-200656/",
  published_time: 1790063368434,
};

const tcsNews: UpstoxNewsItem[] = [
  tcsArticle,
  {
    heading: "Top gainers and losers, September 28",
    summary: "The SENSEX tumbled 1,124.02 points.",
    thumbnail: "https://assets.upstox.com/content/assets/images/news/gainers.webp",
    article_link: "https://upstox.com/news/market-news/stocks/top-gainers-and-losers/article-200700/",
    // Live value for INFY's first article.
    published_time: 1790592504685,
  },
  {
    heading: "SENSEX trades flat, NIFTY50 opens at record high",
    summary: "Markets opened marginally higher.",
    thumbnail: "https://assets.upstox.com/content/assets/images/news/sensex.webp",
    article_link: "https://upstox.com/news/market-news/stocks/sensex-trades-flat/article-200701/",
    // Live value for RELIANCE's first article.
    published_time: 1790305920571,
  },
];

const NEWS_ARTICLE_KEYS = [
  "datetime",
  "headline",
  "id",
  "image",
  "source",
  "summary",
  "url",
];

const TCS_INSTRUMENT = { instrument_key: "NSE_EQ|INE467B01029" };

// --- Timestamp conversion ---------------------------------------------------

test("parseUpstoxPublishedTime converts Upstox milliseconds to the contract's seconds", () => {
  // The live TCS value. Seconds, not milliseconds: the project multiplies by
  // 1000 downstream (lib/agent/normalizers/news.ts), so passing milliseconds
  // through would date every article to the year 58694.
  assert.equal(parseUpstoxPublishedTime(1790063368434), 1790063368);

  const asIso = new Date(parseUpstoxPublishedTime(1790063368434)! * 1000).toISOString();
  assert.equal(asIso, "2026-09-22T07:49:28.000Z");
});

test("parseUpstoxPublishedTime handles a value that is already in seconds", () => {
  // Below the millisecond threshold, so it must not be divided again into 1970.
  assert.equal(parseUpstoxPublishedTime(1790063368), 1790063368);
  assert.equal(
    new Date(parseUpstoxPublishedTime(1790063368)! * 1000).toISOString(),
    "2026-09-22T07:49:28.000Z"
  );
});

test("parseUpstoxPublishedTime accepts numeric strings and rejects unusable values", () => {
  assert.equal(parseUpstoxPublishedTime("1790063368434"), 1790063368);
  assert.equal(parseUpstoxPublishedTime(" 1790063368434 "), 1790063368);

  assert.equal(parseUpstoxPublishedTime(undefined), null);
  assert.equal(parseUpstoxPublishedTime(null), null);
  assert.equal(parseUpstoxPublishedTime(""), null);
  assert.equal(parseUpstoxPublishedTime("   "), null);
  assert.equal(parseUpstoxPublishedTime("2026-09-22"), null);
  assert.equal(parseUpstoxPublishedTime(NaN), null);
  assert.equal(parseUpstoxPublishedTime(Infinity), null);
  assert.equal(parseUpstoxPublishedTime(0), null);
  assert.equal(parseUpstoxPublishedTime(-1790063368434), null);
  assert.equal(parseUpstoxPublishedTime({}), null);
});

test("newsIdFromUrl is a stable non-negative integer for the same url", () => {
  const first = newsIdFromUrl(tcsArticle.article_link);

  assert.equal(Number.isInteger(first), true);
  assert.equal(first >= 0, true);
  // Stable across calls, so the stock page's React key does not churn.
  assert.equal(newsIdFromUrl(tcsArticle.article_link), first);
  assert.notEqual(newsIdFromUrl("https://example.com/other"), first);
});

// --- Upstox normalisation ---------------------------------------------------

test("normalizeUpstoxNews maps the Upstox row onto the NewsArticle contract", () => {
  const [article] = normalizeUpstoxNews([tcsArticle]);

  assert.equal(article.headline, tcsArticle.heading);
  assert.equal(article.summary, tcsArticle.summary);
  assert.equal(article.image, tcsArticle.thumbnail);
  assert.equal(article.url, tcsArticle.article_link);
  assert.equal(article.source, "Upstox");
  assert.equal(article.datetime, 1790063368);
  assert.equal(article.id, newsIdFromUrl(tcsArticle.article_link));
});

test("normalizeUpstoxNews omits an article it cannot date rather than claiming 1970", () => {
  const rows = [
    { ...tcsArticle, article_link: "https://example.com/datable" },
    { ...tcsArticle, article_link: "https://example.com/undatable", published_time: "N/A" },
  ];

  const result = normalizeUpstoxNews(rows);

  assert.equal(result.length, 1);
  assert.equal(result[0].url, "https://example.com/datable");
});

test("normalizeUpstoxNews drops rows missing a headline or a link", () => {
  const rows = [
    tcsArticle,
    { ...tcsArticle, heading: "" },
    { ...tcsArticle, heading: "   " },
    { ...tcsArticle, article_link: "" },
    { ...tcsArticle, article_link: undefined },
  ];

  const result = normalizeUpstoxNews(rows);

  assert.equal(result.length, 1);
  assert.equal(result[0].headline, tcsArticle.heading);
});

test("normalizeUpstoxNews keeps an article with no thumbnail, with an empty image", () => {
  const [article] = normalizeUpstoxNews([{ ...tcsArticle, thumbnail: undefined }]);

  assert.equal(article.image, "");
  assert.equal(article.headline, tcsArticle.heading);
});

test("normalizeUpstoxNews returns [] for a missing or non-array payload", () => {
  assert.deepEqual(normalizeUpstoxNews(null), []);
  assert.deepEqual(normalizeUpstoxNews(undefined), []);
  assert.deepEqual(normalizeUpstoxNews([]), []);
  // @ts-expect-error deliberately passing the wrong shape
  assert.deepEqual(normalizeUpstoxNews("not an array"), []);
});

test("normalizeUpstoxNews returns exactly the contract shape, leaking no Upstox metadata", () => {
  // Rows carrying Upstox-only fields must not widen the result: NewsArticle has
  // seven fields and nothing else.
  const rowsWithMetadata = [
    {
      ...tcsArticle,
      instrument_key: "NSE_EQ|INE467B01029",
      isin: "INE467B01029",
      published_time_ms: 1790063368434,
    },
  ];

  const [article] = normalizeUpstoxNews(rowsWithMetadata);

  assert.deepEqual(Object.keys(article).sort(), NEWS_ARTICLE_KEYS);

  const values = Object.values(article).map((value) => String(value));
  assert.equal(values.some((value) => value.includes("NSE_EQ")), false);
  assert.equal(values.some((value) => value.includes("INE467B01029")), false);
});

// --- Provider routing -------------------------------------------------------

/** Records every symbol it is asked about. */
function spyInstrument(row: { instrument_key?: string } | null) {
  const calls: string[] = [];
  const lookup: IndianInstrumentLookup = async (symbol) => {
    calls.push(symbol);
    return row;
  };
  return { lookup, calls };
}

/** Records every instrument_key it is asked about. */
function spyIndianNews(rows: UpstoxNewsItem[] | null) {
  const calls: string[] = [];
  const lookup: IndianNewsLookup = async (instrumentKey) => {
    calls.push(instrumentKey);
    return rows;
  };
  return { lookup, calls };
}

function spyGlobalNews(rows: NewsArticle[] | null) {
  const calls: string[] = [];
  const lookup = async (symbol: string) => {
    calls.push(symbol);
    return rows;
  };
  return { lookup, calls };
}

test("an Indian symbol is looked up by its bare NSE ticker, and its instrument_key keys the feed", async () => {
  const instrument = spyInstrument(TCS_INSTRUMENT);
  const news = spyIndianNews(tcsNews);

  const result = await fetchIndianNews("TCS.NS", instrument.lookup, news.lookup);

  // ".NS" is dropped for the Upstox instrument search and nothing else.
  assert.deepEqual(instrument.calls, ["TCS"]);
  assert.deepEqual(news.calls, ["NSE_EQ|INE467B01029"]);
  assert.equal(result?.provider, "Upstox");
  assert.equal(result?.data.length, 3);
});

test("'BSE' suffixes are stripped for the Upstox lookup too", async () => {
  const instrument = spyInstrument({ instrument_key: "NSE_EQ|INE002A01018" });
  const news = spyIndianNews(tcsNews);

  await fetchIndianNews("RELIANCE.BSE", instrument.lookup, news.lookup);

  assert.deepEqual(instrument.calls, ["RELIANCE"]);
});

test("a successful but empty Upstox feed is data: [], not a failure", async () => {
  const instrument = spyInstrument(TCS_INSTRUMENT);
  const news = spyIndianNews([]);

  const result = await fetchIndianNews("TCS.NS", instrument.lookup, news.lookup);

  // This is the whole point of the distinction: the provider answered, so the
  // caller can honestly report "no news" instead of "we don't know".
  assert.equal(result?.provider, "Upstox");
  assert.deepEqual(result?.data, []);
  assert.notEqual(result, null);
});

test("Indian provider failures resolve to null instead of throwing", async () => {
  const okInstrument = spyInstrument(TCS_INSTRUMENT).lookup;
  const okNews = spyIndianNews(tcsNews).lookup;
  const missingToken: IndianInstrumentLookup = async () => {
    throw new Error("UPSTOX_ACCESS_TOKEN is missing from environment variables");
  };
  const throwingNews: IndianNewsLookup = async () => {
    throw new Error("UPSTOX_ACCESS_TOKEN is missing from environment variables");
  };

  // Unresolved instrument -> no instrument_key -> nothing to ask about.
  assert.equal(await fetchIndianNews("TCS.NS", spyInstrument(null).lookup, okNews), null);
  assert.equal(
    await fetchIndianNews("TCS.NS", spyInstrument({}).lookup, okNews),
    null
  );
  // Missing token on either call.
  assert.equal(await fetchIndianNews("TCS.NS", missingToken, okNews), null);
  assert.equal(await fetchIndianNews("TCS.NS", okInstrument, throwingNews), null);
  // The feed reported itself as unreadable.
  assert.equal(
    await fetchIndianNews("TCS.NS", okInstrument, spyIndianNews(null).lookup),
    null
  );
});

test("fetchGlobalNews: a refused Finnhub request is null, an empty array is not", async () => {
  // getCompanyNews() converts Finnhub's 403 error body into null; the provider
  // must pass that through as a failure.
  assert.equal(await fetchGlobalNews("TCS.NS", async () => null), null);
  assert.equal(
    await fetchGlobalNews("AAPL", async () => {
      throw new Error("network down");
    }),
    null
  );

  const empty = await fetchGlobalNews("AAPL", spyGlobalNews([]).lookup);
  assert.equal(empty?.provider, "Finnhub");
  assert.deepEqual(empty?.data, []);
});

test("a non-Indian symbol goes to Finnhub and never touches Upstox", async () => {
  const instrument = spyInstrument(TCS_INSTRUMENT);
  const indianNews = spyIndianNews(tcsNews);
  const globalNews = spyGlobalNews([
    {
      id: 1,
      headline: "Apple news",
      summary: "",
      image: "",
      source: "Yahoo",
      url: "https://example.com/aapl",
      datetime: 1790063368,
    },
  ]);

  const result = await fetchNews(
    "AAPL",
    instrument.lookup,
    indianNews.lookup,
    globalNews.lookup
  );

  assert.equal(result?.provider, "Finnhub");
  assert.deepEqual(globalNews.calls, ["AAPL"]);
  assert.equal(instrument.calls.length, 0);
  assert.equal(indianNews.calls.length, 0);
});

test("an Indian symbol is never sent to Finnhub, suffixed or bare", async () => {
  const instrument = spyInstrument(TCS_INSTRUMENT);
  const indianNews = spyIndianNews(tcsNews);
  const globalNews = spyGlobalNews([
    {
      id: 1,
      headline: "Should never be used",
      summary: "",
      image: "",
      source: "Yahoo",
      url: "https://example.com/wrong",
      datetime: 1790063368,
    },
  ]);

  const result = await fetchNews(
    "TCS.NS",
    instrument.lookup,
    indianNews.lookup,
    globalNews.lookup
  );

  assert.equal(result?.provider, "Upstox");
  assert.equal(globalNews.calls.length, 0);
  assert.deepEqual(instrument.calls, ["TCS"]);
});

test("each path makes exactly one call per provider, with no duplicate fetch", async () => {
  // A single pass through the chain, not two: one instrument search to resolve
  // the key, then one feed call. Nothing retries and nothing is fetched twice.
  const indian = {
    instrument: spyInstrument(TCS_INSTRUMENT),
    news: spyIndianNews(tcsNews),
    global: spyGlobalNews([]),
  };

  await fetchNews(
    "TCS.NS",
    indian.instrument.lookup,
    indian.news.lookup,
    indian.global.lookup
  );

  assert.equal(indian.instrument.calls.length, 1);
  assert.equal(indian.news.calls.length, 1);
  assert.equal(indian.global.calls.length, 0);

  const global = {
    instrument: spyInstrument(TCS_INSTRUMENT),
    news: spyIndianNews(tcsNews),
    global: spyGlobalNews([]),
  };

  await fetchNews(
    "AAPL",
    global.instrument.lookup,
    global.news.lookup,
    global.global.lookup
  );

  assert.equal(global.global.calls.length, 1);
  assert.equal(global.instrument.calls.length, 0);
  assert.equal(global.news.calls.length, 0);
});

// --- Tool behaviour ---------------------------------------------------------

test("a provider failure is ok:false, never ok:true with an empty array", async () => {
  const tool = createNewsTool(async () => null);

  const result = await tool.execute({ symbol: "TCS.NS" });

  // The defect this step exists to fix: a refused request used to arrive here
  // as ok:true, data:[] — indistinguishable from "no news".
  assert.equal(result.ok, false);
  assert.equal(result.data, null);
  assert.notDeepEqual(result.data, []);
});

test("a successful empty feed is ok:true with an empty array", async () => {
  const tool = createNewsTool(async () => ({ provider: "Upstox", data: [] }));

  const result = await tool.execute({ symbol: "TCS.NS" });

  // The provider answered, so "no recent news" is a legitimate result.
  assert.equal(result.ok, true);
  assert.deepEqual(result.data, []);
});

test("a throwing lookup is ok:false and does not escape the tool", async () => {
  const tool = createNewsTool(async () => {
    throw new Error("UPSTOX_ACCESS_TOKEN is missing from environment variables");
  });

  const result = await tool.execute({ symbol: "AAPL" });

  assert.equal(result.ok, false);
  assert.equal(result.data, null);
});

test("an Indian lookup returns agent-ready articles with the right publish time", async () => {
  const instrument = spyInstrument(TCS_INSTRUMENT);
  const news = spyIndianNews(tcsNews);

  // End to end through the real provider and adapter, with only the two network
  // calls faked.
  const tool = createNewsTool((symbol) =>
    fetchIndianNews(symbol, instrument.lookup, news.lookup)
  );

  const result = await tool.execute({ symbol: "TCS.NS" });

  assert.equal(result.ok, true);
  assert.equal(result.data?.length, 3);

  // normalizeNews sorts newest first, so the TCS article is found by url
  // rather than assumed to be first.
  const tcs = result.data!.find((article) => article.url === tcsArticle.article_link);
  assert.ok(tcs);
  assert.equal(tcs.headline, tcsArticle.heading);
  assert.equal(tcs.source, "Upstox");
  // Milliseconds were divided by 1000 and then multiplied back by the agent
  // normalizer: the article is dated 2026, not the year 58694.
  assert.equal(tcs.publishedAt, "2026-09-22T07:49:28.000Z");
});

test("newest article first, and limit slices the result", async () => {
  const instrument = spyInstrument(TCS_INSTRUMENT);
  const news = spyIndianNews(tcsNews);

  const tool = createNewsTool((symbol) =>
    fetchIndianNews(symbol, instrument.lookup, news.lookup)
  );

  const all = await tool.execute({ symbol: "TCS.NS" });
  assert.deepEqual(
    all.data?.map((article) => article.publishedAt),
    ["2026-09-28T10:48:24.000Z", "2026-09-25T03:12:00.000Z", "2026-09-22T07:49:28.000Z"]
  );

  const limited = await tool.execute({ symbol: "TCS.NS", limit: 1 });
  assert.equal(limited.ok, true);
  assert.equal(limited.data?.length, 1);
  assert.equal(limited.data?.[0].publishedAt, "2026-09-28T10:48:24.000Z");
});

test("the default export is the registered get_news tool", async () => {
  const { newsTool } = await import("../newsTool");

  assert.equal(newsTool.name, "get_news");
  assert.equal(typeof newsTool.execute, "function");
});
