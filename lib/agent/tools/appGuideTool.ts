import { z } from "zod";

import { ToolDefinition, okResult } from "../types";

/**
 * How to use StockSphere's own features, for "how do I…" questions. Kept here
 * (not in the system prompt) so the guide costs tokens only when asked for.
 * Each entry describes what the page in app/ actually does; update it when a
 * feature changes.
 */

const SOURCE = "StockSphere app guide";

export const APP_GUIDE = {
  watchlist:
    "Watchlist (/watchlist, sign-in required): open a stock's page and press its 'Add to Watchlist' button, or on /watchlist use 'Search this list or add a stock…' / '+ Add stocks'. You can keep several named lists; each shows price, daily move and 52-week range.",
  alerts:
    "Price alerts (/alerts, sign-in required): search a stock, index or coin, pick a condition — 'Price rises above', 'Price falls below', 'Day gain reaches' or 'Day fall reaches' — enter the level (price or %), add an optional note, then 'Create alert'. Triggered alerts appear under the bell icon.",
  portfolio:
    "Portfolio (/portfolio, sign-in required): enter a stock symbol, quantity and average buy price to track live value, daily change and total returns. The home dashboard summarises it when signed in.",
  paper:
    "Paper trading (/paper, sign-in required): practise with virtual money — ₹10,00,000 and $10,000 — at real prices. Use 'Place a virtual order', choose Buy or Sell, the stock and quantity. No real money is involved.",
  predictions:
    "Predictions (/predictions): predict where a stock, index, ETF or coin goes next with a target and optional reasoning; predictions are scored on the real price and earn points and badges. The /leaderboard ranks predictors. It is a game of skill, not investment advice.",
  screener:
    "Screener (/screener): filter the NIFTY 50 and 20 US large caps by today's move, 52-week position and volume; each result shows why it matched. Screens can be saved on this device.",
  backtest:
    "Backtest (/backtest): pick a stock, index or coin and a simple rule to see how it would have done on real price history, with costs and without hindsight.",
  heatmap:
    "Heatmap (/heatmap): a treemap of NIFTY indices (50, Next 50, 100, 200, 500, Midcap 100, Smallcap 100, Bank, IT) or US large caps, sized by market cap and coloured by the chosen metric, optionally grouped by sector.",
  markets:
    "Markets: /explore for an overview, /indices for Indian and global indices, /etfs, /crypto (₹ or $), /bonds (US Treasury yields and Indian bond ETFs), /trending for the most-discussed stocks, /news for headlines and exchange filings.",
  ipo:
    "IPOs (/ipo): Indian mainboard and SME IPOs — open, upcoming and recently closed — with price band, lot size, subscription, allotment and listing dates and listing gains, from Upstox.",
  events:
    "Events (/events): upcoming US earnings dates (filter by ticker) and personal reminders saved in this browser only.",
  community:
    "Community (/community): post views on stocks or the market; tag stocks with $TICKER. Each stock page has its own discussion board. Sign in and set up a profile to post.",
  stock_page:
    "Stock pages (/stock/SYMBOL, e.g. /stock/TCS.NS or /stock/AAPL): price chart, key stats (market cap, P/E, EPS, 52-week range) with sources, company profile, news, and the discussion board. Use the search box at the top to open one.",
  assistant:
    "StockSphere AI (this assistant): ask about prices, returns, comparisons, fundamentals, news, indices, sectors, crypto, ETFs, bonds, IPOs and US earnings dates, or general finance concepts. Data may be delayed; it gives information, not investment advice.",
  account:
    "Account: sign in from the top-right 'Login' button (/login). New users go through /onboarding to pick a username. /profile shows your profile; /beta explains the private beta, risks and privacy.",
} as const;

type Topic = keyof typeof APP_GUIDE;
const TOPICS = Object.keys(APP_GUIDE) as Topic[];

const argsSchema = z.object({
  topic: z.enum(TOPICS as [Topic, ...Topic[]]).optional(),
});

export type AppGuideArgs = z.infer<typeof argsSchema>;
export type AppGuideResult = { topic: string; guide: string } | { topic: "all"; guide: Record<string, string> };

export const appGuideTool: ToolDefinition<AppGuideArgs, AppGuideResult> = {
  name: "get_app_help",
  description:
    "How to use StockSphere itself (watchlists, alerts, portfolio, paper trading, predictions, screener, backtest, heatmap, IPO page, community, account). Use for any 'how do I… in StockSphere/the app' question; answer only from what it returns.",
  parameters: {
    type: "object",
    properties: {
      topic: { type: "string", enum: TOPICS, description: "Feature to explain. Omit for the full guide." },
    },
    required: [],
  },
  argsSchema,
  async execute({ topic }) {
    return okResult(topic ? { topic, guide: APP_GUIDE[topic] } : { topic: "all" as const, guide: { ...APP_GUIDE } }, SOURCE);
  },
};
