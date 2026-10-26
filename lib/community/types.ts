import type { BondCategory } from "../bonds/bonds";
import type { InstrumentType } from "../search/types";
import type { PredictionStats } from "../predictions/rules";
import type { StoredMention } from "./mentions";
import type { Sentiment } from "./rules";

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
  | { kind: "instrument"; id: string; type: InstrumentType; name: string; symbol: string; exchange: string; href: string; via: "mention" }
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
  body: string;
  sentiment: Sentiment | null;
  symbols: string[];
  parentId: string | null;
  likeCount: number;
  replyCount: number;
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
