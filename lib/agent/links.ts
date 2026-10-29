/**
 * Where StockSphere AI can send people: the app's own pages (only routes that
 * exist under app/) and a short list of official external sources. Shared by
 * the server, which builds the links, and the chat panel, which checks them
 * again before rendering — a link that fails here is never shown.
 */

import type { AgentLink } from "@/lib/types/agent";

export type { AgentLink };

type Page = { path: string; label: string; match: RegExp };

/** Every path here is a real route in app/ (see lib/agent/__tests__/navigation.test.ts). */
export const PAGES: Page[] = [
  { path: "/heatmap", label: "Open Heatmap", match: /^heat\s*-?\s*maps?$/i },
  { path: "/ipo", label: "View IPOs", match: /^(?:ipos?|ipo page|upcoming ipos?|open ipos?|ipo list)$/i },
  { path: "/indices", label: "View Indices", match: /^(?:indices|indexes|index|market indices)$/i },
  { path: "/news", label: "Market News", match: /^(?:news|market news|latest news)$/i },
  { path: "/events", label: "Earnings & Events", match: /^(?:events|earnings|earnings calendar|corporate (?:events|actions)|calendar)$/i },
  { path: "/portfolio", label: "Open Portfolio", match: /^(?:portfolio|holdings|my holdings|investments)$/i },
  { path: "/watchlist", label: "Open Watchlist", match: /^(?:watchlists?)$/i },
  { path: "/alerts", label: "Price Alerts", match: /^(?:alerts?|price alerts?|notifications)$/i },
  { path: "/dashboard", label: "Open Dashboard", match: /^(?:dashboard|home dashboard|watchtower)$/i },
  { path: "/screener", label: "Stock Screener", match: /^(?:screener|stock screener|screens?)$/i },
  { path: "/paper", label: "Paper Trading", match: /^(?:paper(?:\s+trading)?|virtual trading|paper portfolio)$/i },
  { path: "/predictions", label: "Predictions", match: /^predictions?$/i },
  { path: "/leaderboard", label: "Leaderboard", match: /^leaderboards?$/i },
  { path: "/community", label: "Community", match: /^(?:community|forum|discussions?)$/i },
  { path: "/explore", label: "Explore Markets", match: /^(?:markets?|explore|stocks)$/i },
  { path: "/crypto", label: "Crypto", match: /^(?:crypto|cryptocurrenc(?:y|ies)|bitcoin)$/i },
  { path: "/etfs", label: "ETFs", match: /^etfs?$/i },
  { path: "/bonds", label: "Bonds", match: /^(?:bonds?|yields?|treasur(?:y|ies))$/i },
  { path: "/backtest", label: "Backtest", match: /^(?:backtest(?:ing|er)?)$/i },
  { path: "/trending", label: "Trending", match: /^trending(?: stocks)?$/i },
  { path: "/profile", label: "Your Profile", match: /^(?:profile|my profile|account)$/i },
];

export const PAGE_PATHS = PAGES.map((p) => p.path);

/** Official sources for exchange rules and restrictions. */
export const OFFICIAL = {
  nseFoBan: {
    label: "Check Today's NSE F&O Ban List",
    href: "https://www.nseindia.com/static/products-services/equity-derivatives-risk-management-sec-ban",
    kind: "external",
    note: "Official NSE page. Its ban-period file is for the next trade date — check the date on the file.",
    primary: true,
  },
  nseClearingLimits: {
    label: "NSE Clearing: position limits",
    href: "https://www.nseclearing.in/risk-management/equity-derivatives/position-limits",
    kind: "external",
    note: "Market-wide position limits and the rules behind the ban.",
  },
} satisfies Record<string, AgentLink>;

const OFFICIAL_HOSTS = new Set(["www.nseindia.com", "nseindia.com", "nsearchives.nseindia.com", "www.nseclearing.in", "nseclearing.in", "www.bseindia.com", "www.sebi.gov.in"]);

const STOCK_PATH = /^\/stock\/[A-Z0-9][A-Z0-9&-]{0,19}$/;
const IPO_COMMUNITY_PATH = /^\/community\/ipo\/[a-z0-9-]{1,120}$/;
const NEW_THESIS_PATH = /^\/theses\/new\?symbol=[A-Z0-9][A-Z0-9&.-]{0,24}$/;

export function isKnownInternalPath(path: string): boolean {
  return PAGE_PATHS.includes(path) || STOCK_PATH.test(path) || IPO_COMMUNITY_PATH.test(path) || NEW_THESIS_PATH.test(path);
}

/**
 * The one gate every link passes. Internal links must be a known route;
 * external links must be https, with no credentials, to a public host —
 * official hosts are always fine, other hosts only for articles a news source
 * gave us (allowArticles). Anything else (javascript:, data:, //host,
 * http:, localhost, an unknown path) is rejected.
 */
export function safeLink(link: AgentLink, options: { allowArticles?: boolean } = {}): AgentLink | null {
  if (!link || typeof link.href !== "string" || typeof link.label !== "string" || !link.label.trim()) return null;
  const label = link.label.trim().slice(0, 90);
  const note = typeof link.note === "string" ? link.note.slice(0, 200) : undefined;

  if (link.kind === "internal") {
    if (!link.href.startsWith("/") || link.href.startsWith("//") || !isKnownInternalPath(link.href)) return null;
    return { label, href: link.href, kind: "internal", note, primary: link.primary === true };
  }
  if (link.kind !== "external") return null;

  let url: URL;
  try {
    url = new URL(link.href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes("[") || !host.includes(".")) return null;
  if (!OFFICIAL_HOSTS.has(host) && !options.allowArticles) return null;
  return { label, href: url.toString(), kind: "external", note, primary: link.primary === true };
}

/** The stock page for a symbol: TCS.NS → /stock/TCS, AAPL → /stock/AAPL. */
export function stockPath(symbol: string): string | null {
  const bare = symbol.trim().toUpperCase().replace(/\.(NS|BO|BSE|NSE)$/, "");
  const path = `/stock/${bare}`;
  return STOCK_PATH.test(path) ? path : null;
}

/** "open the heatmap page" → the heatmap page, when the subject names one exactly. */
export function pageFor(subject: string): Page | null {
  const cleaned = subject
    .trim()
    .replace(/[?.!]+$/, "")
    .replace(/^(?:the|my|our|stocksphere'?s?)\s+/i, "")
    .replace(/\s+(?:page|section|tab|screen|tool|feature)$/i, "")
    .trim();
  return PAGES.find((page) => page.match.test(cleaned)) ?? null;
}

export function pageLink(path: string, primary = false): AgentLink {
  const page = PAGES.find((p) => p.path === path)!;
  return { label: page.label, href: page.path, kind: "internal", primary };
}
