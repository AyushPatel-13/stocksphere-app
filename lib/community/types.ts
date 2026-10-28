import type { BondCategory } from "../bonds/bonds";
import type { InstrumentType } from "../search/types";
import type { PredictionStats } from "../predictions/rules";
import type { StoredMention } from "./mentions";
import type { StockQuote } from "./quotes";
import type { PostKind, Sentiment } from "./rules";

export type IpoStatus = "upcoming" | "open" | "closed" | "listed";

/**
 * What a post is about, from stored relations only: the IPO community it was
 * written in, and the stocks/IPOs/bonds its author picked with @. Never guessed from
 * the text. IPO status comes from Upstox (or the verified listing link).
 */
export type PostContext =
  | {
      kind: "ipo";
      communityId: string;
      ipoId: string | null;
      name: string;
      /** Null when Upstox couldn't be asked right now. */
      status: IpoStatus | null;
      /** The IPO community page. */
      href: string;
      /** Set once the listing service linked it to its stock. */
      listed: { exchange: string; symbol: string; href: string } | null;
      via: "community" | "mention";
    }
  | {
      kind: "instrument";
      id: string;
      type: InstrumentType;
      name: string;
      symbol: string;
      exchange: string;
      href: string;
      via: "mention";
      /** Last price and day change from the market-data provider; absent when there is no verified quote. */
      quote?: StockQuote;
    }
  | {
      kind: "bond";
      communityId: string;
      isin: string;
      name: string;
      /** Verified fields only; null where the exchange record doesn't state one. */
      issuer: string | null;
      category: BondCategory;
      coupon: number | null;
      maturity: string | null;
      /** The bond's page, /bonds/<ISIN>. */
      href: string;
      via: "mention";
    };

/** A post as the UI receives it. Plain text body; never HTML. */
export type PostView = {
  id: string;
  /** Optional headline of a top-level post (post_titles_and_kinds migration). */
  title?: string | null;
  /** Optional post type of a top-level post. */
  kind?: PostKind | null;
  body: string;
  sentiment: Sentiment | null;
  symbols: string[];
  /** The post or comment this one directly answers; null for a top-level post. */
  parentId: string | null;
  /** A comment's top-level post (null for a top-level post). */
  rootId?: string | null;
  likeCount: number;
  /** Photos (community_images migration), 1-4, with their public addresses. */
  images?: { path: string; url: string; width: number; height: number; alt: string }[];
  /** Times reposted (reposts migration); absent before it, and then no repost, quote or save controls are shown. */
  repostCount?: number;
  /** A quote post: the post it quotes. */
  quoteOf?: string | null;
  /** Added by the API to quote posts: the quoted post, or null when it's no longer visible. */
  quoted?: PostView | null;
  /** Up and down votes (post_votes migration); absent before it, and then no vote control is shown. */
  upCount?: number;
  downCount?: number;
  /** Direct replies. */
  replyCount: number;
  /** On a top-level post: comments in its thread at any depth. */
  commentCount?: number;
  /** A deleted comment kept so its replies keep their place: no text or author. */
  deleted?: boolean;
  createdAt: string;
  author: {
    username: string;
    displayName: string;
    avatarUrl: string | null;
    role: "user" | "moderator" | "admin";
    /** Prediction record, for the badge shown next to the name. */
    stats: PredictionStats;
  };
  /** The community the post was written in (an IPO's, or a linked stock's). */
  communityId?: string | null;
  /** Verified @mentions, with their positions in `body`. */
  mentions?: StoredMention[];
  editedAt?: string | null;
  /** Added by the API from the relations above; see PostContext. */
  context?: PostContext[];
};

export type SentimentSummary = {
  symbol: string;
  bullish: number;
  bearish: number;
  /** Posts in the window, with or without a stance. */
  total: number;
  windowDays: number;
};

export type TrendingSymbol = { symbol: string; posts: number };
