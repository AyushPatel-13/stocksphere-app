import type { PredictionStats } from "../predictions/rules";
import type { Sentiment } from "./rules";

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
