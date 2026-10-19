import { test } from "node:test";
import assert from "node:assert/strict";

import { parseFeedDate, parseRss, toPlainText } from "@/lib/news/rss";
import {
  FEEDS,
  createNewsLoader,
  finalise,
  fromFinnhub,
  fromNse,
  fromUpstox,
  safeUrl,
  type NewsDeps,
} from "../marketNews";
import { GET } from "@/app/api/news/route";

const NOW = Date.parse("2026-10-19T07:00:00.000Z");

/* ------------------------------------------------------------------ RSS */

const ET_XML = `<?xml version="1.0"?><rss><channel><title>ET</title>
<item><title><![CDATA[PNB shares jump 8% after Q2 &amp; beats]]> </title>
<description><![CDATA[<p>Punjab National Bank <b>rose</b> sharply.</p>]]></description>
<link>https://economictimes.indiatimes.com/markets/stocks/pnb/123.cms</link>
<pubDate>Mon, 19 Oct 2026 11:05:53 +0530</pubDate></item>
<item><title>No date here</title><link>https://example.com/x</link></item>
</channel></rss>`;

test("RSS items come back as plain text: CDATA unwrapped, entities decoded, tags removed", () => {
  const [first, second] = parseRss(ET_XML);

  assert.equal(first.title, "PNB shares jump 8% after Q2 & beats");
  assert.equal(first.description, "Punjab National Bank rose sharply.");
  assert.equal(first.link, "https://economictimes.indiatimes.com/markets/stocks/pnb/123.cms");
  assert.equal(second.pubDate, "");
});

test("escaped HTML inside a description is stripped, not shown as text", () => {
  assert.equal(
    toPlainText("&lt;img src=&quot;x.jpg&quot;/&gt; ICICI Securities is bullish"),
    "ICICI Securities is bullish"
  );
  assert.equal(toPlainText("Tata &#38; Sons &#x20B9;100"), "Tata & Sons ₹100");
});

test("feed dates: RFC 822, and NSE's zone-less format read as Indian time", () => {
  assert.equal(parseFeedDate("Mon, 19 Oct 2026 11:05:53 +0530"), "2026-10-19T05:35:53.000Z");
  assert.equal(parseFeedDate("19-Oct-2026 12:12:10"), "2026-10-19T06:42:10.000Z");
  assert.equal(parseFeedDate("not a date"), null);
});

test("NSE filings use the SUBJECT as the headline and are marked as filings", () => {
  const [filing] = fromNse(
    parseRss(`<rss><channel><item><title>SBI Cards and Payment Services Limited</title>
<link>https://nsearchives.nseindia.com/corporate/a.pdf</link>
<description>SBI CARDS has informed the Exchange about Analyst Meet |SUBJECT: Analyst/Investor Meet</description>
<pubDate>19-Oct-2026 12:12:10</pubDate></item></channel></rss>`)
  );

  assert.equal(filing.title, "SBI Cards and Payment Services Limited: Analyst/Investor Meet");
  assert.equal(filing.summary, "SBI CARDS has informed the Exchange about Analyst Meet");
  assert.equal(filing.kind, "filing");
  assert.equal(filing.source, "nse");
});

/* ------------------------------------------------------------- sources */

test("only http(s) links survive", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,hi"), null);
  assert.equal(safeUrl("/relative"), null);
  assert.equal(safeUrl("https://example.com/a"), "https://example.com/a");
});

test("Upstox: one item per article, carrying every symbol it was filed under", () => {
  const article = {
    heading: "Banks rally",
    summary: "Lenders gained.",
    article_link: "https://news.example.com/banks",
    published_time: NOW - 60_000,
  };

  const items = fromUpstox(
    {
      "NSE_EQ|A": [article, { heading: "", article_link: "https://x.com", published_time: NOW }],
      "NSE_EQ|B": [article],
    },
    new Map([
      ["NSE_EQ|A", "HDFCBANK"],
      ["NSE_EQ|B", "ICICIBANK"],
    ])
  );

  assert.equal(items.length, 1);
  assert.deepEqual(items[0].symbols, ["HDFCBANK", "ICICIBANK"]);
});

test("Finnhub: names the real publisher and keeps only ticker-like related symbols", () => {
  const [entry] = fromFinnhub([
    {
      headline: "Stocks slip",
      summary: "Wall Street fell.",
      url: "https://reuters.example/x",
      source: "Reuters",
      datetime: NOW / 1000 - 600,
      related: "AAPL, msft ,<script>",
    },
    { headline: "bad", url: "javascript:x", datetime: NOW / 1000 },
  ]);

  assert.equal(entry.sourceName, "Reuters · Finnhub");
  assert.deepEqual(entry.symbols, ["AAPL", "MSFT"]);
});

test("finalise drops stale and future items and duplicate headlines, newest first", () => {
  const make = (title: string, minutesAgo: number, source: "et" | "bs" = "et") => ({
    id: `${source}:${title}`,
    title,
    summary: "",
    url: `https://example.com/${encodeURIComponent(title)}`,
    source,
    sourceName: source,
    kind: "news" as const,
    publishedAt: new Date(NOW - minutesAgo * 60_000).toISOString(),
    symbols: [],
  });

  const out = finalise(
    [
      make("Older", 120),
      make("Newest", 5),
      make("Newest!", 6, "bs"), // same headline, different punctuation
      make("From 2024", 60 * 24 * 900), // a dead feed
      make("Future", -24 * 60),
    ],
    NOW
  );

  assert.deepEqual(out.map((entry) => entry.title), ["Newest", "Older"]);
});

test("NSE filings are capped so they can't crowd out news", () => {
  const filings = Array.from({ length: 40 }, (_, i) => ({
    id: `nse:${i}`,
    title: `Company ${i}: Board Meeting`,
    summary: "",
    url: `https://nsearchives.nseindia.com/${i}.pdf`,
    source: "nse" as const,
    sourceName: "NSE filings",
    kind: "filing" as const,
    publishedAt: new Date(NOW - i * 60_000).toISOString(),
    symbols: [],
  }));

  const out = finalise(filings, NOW);
  assert.equal(out.length, 25);
});

/* -------------------------------------------------------------- loader */

function deps(overrides: Partial<NewsDeps> = {}): NewsDeps {
  return {
    fetchFeed: async (url) => (url === FEEDS.et ? ET_XML : null),
    resolveInstrumentKey: async (symbol) => `NSE_EQ|${symbol}`,
    getUpstoxNewsForKeys: async () => ({
      "NSE_EQ|TCS": [
        {
          heading: "TCS wins deal",
          article_link: "https://news.example.com/tcs",
          published_time: NOW - 30 * 60_000,
        },
      ],
    }),
    getMarketNews: async () => [],
    now: () => NOW,
    ...overrides,
  };
}

test("India merges the sources that answered and reports the ones that didn't", async () => {
  const feed = await createNewsLoader(deps())("india");

  assert.deepEqual(
    feed.items.map((entry) => entry.source),
    ["upstox", "et"]
  );
  assert.deepEqual(
    feed.sources.map((s) => [s.id, s.ok]),
    [["upstox", true], ["nse", false], ["et", true], ["bs", false]]
  );
});

test("a missing Upstox token makes Upstox unavailable, not the whole feed", async () => {
  const feed = await createNewsLoader(
    deps({
      getUpstoxNewsForKeys: async () => {
        throw new Error("UPSTOX_ACCESS_TOKEN is missing");
      },
    })
  )("india");

  assert.equal(feed.sources.find((s) => s.id === "upstox")?.ok, false);
  assert.equal(feed.items.length, 1);
});

test("a feed is cached per region; a total outage is not cached", async () => {
  let calls = 0;
  const load = createNewsLoader(
    deps({
      getMarketNews: async () => {
        calls++;
        return calls === 1 ? null : [];
      },
    })
  );

  const down = await load("us");
  assert.equal(down.sources[0].ok, false);

  await load("us");
  await load("us");
  assert.equal(calls, 2);
});

/* --------------------------------------------------------------- route */

test("/api/news validates the region and maps outages to 503", async () => {
  const bad = await GET(new Request("http://x/api/news?region=mars"));
  assert.equal(bad.status, 400);

  const outage = createNewsLoader(deps({ getMarketNews: async () => null }));
  const down = await GET(new Request("http://x/api/news?region=us"), undefined, outage);
  assert.equal(down.status, 503);

  const ok = await GET(new Request("http://x/api/news?region=india"), undefined, createNewsLoader(deps()));
  const body = await ok.json();
  assert.equal(ok.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.region, "india");
});
