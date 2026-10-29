import { createHash } from "node:crypto";

import { MIN_RANKED, adjustedAccuracy } from "../predictions/reputation";

/**
 * Investor reputation: separate dimensions, each with its own sample size,
 * never folded into one score. Pure: the server passes in counts read from
 * the raw tables, so recomputing from those rows always gives the same result.
 *
 *   predictions      Bayesian-adjusted accuracy of scored calls (the
 *                    leaderboard's rule), from MIN_RANKED scored calls
 *   transparency     of the updates made to published theses, the share made
 *                    before the thesis's target date (not after the fact)
 *   riskAwareness    the share of published theses that state both their
 *                    risks and what would prove them wrong
 *   contribution     posts and replies that stand, against those moderators
 *                    removed
 *   thesisOutcomes   not available until thesis scoring is switched on
 *   helpfulness      not tracked yet (no "helpful" marks exist)
 *
 * Deliberately not inputs: likes, votes, followers, reposts. A member below a
 * dimension's minimum sample shows "not enough data", never a low score.
 */

export const REPUTATION_CONFIG = {
  version: "rep-1",
  minPredictions: MIN_RANKED,
  minThesisUpdates: 5,
  minPublishedTheses: 3,
  minPosts: 10,
} as const;

export const CONFIG_FINGERPRINT = createHash("sha256").update(JSON.stringify(REPUTATION_CONFIG)).digest("hex").slice(0, 12);

export type ReputationInputs = {
  predictions: { resolved: number; wins: number };
  /** Versions added after publishing, split by whether the thesis's target date had passed. */
  thesisUpdates: { beforeTarget: number; afterTarget: number };
  /** Published (or closed) theses, and how many of their published versions state risks and invalidation. */
  publishedTheses: { total: number; withRisksAndInvalidation: number };
  /** Top-level posts and replies by the member, not deleted; hidden = removed by moderators. */
  posts: { standing: number; removed: number };
};

export type Dimension =
  | { key: string; label: string; status: "scored"; value: number; unit: "%"; sample: number; detail: string }
  | { key: string; label: string; status: "not_enough_data"; sample: number; needed: number; detail: string }
  | { key: string; label: string; status: "unavailable"; detail: string };

const pct = (n: number) => Math.round(n * 10) / 10;

function dimension(key: string, label: string, sample: number, needed: number, value: () => number, detail: string): Dimension {
  return sample >= needed
    ? { key, label, status: "scored", value: pct(value()), unit: "%", sample, detail }
    : { key, label, status: "not_enough_data", sample, needed, detail };
}

export function computeReputation(input: ReputationInputs, config = REPUTATION_CONFIG): { version: string; fingerprint: string; dimensions: Dimension[] } {
  const { predictions, thesisUpdates, publishedTheses, posts } = input;
  const updates = thesisUpdates.beforeTarget + thesisUpdates.afterTarget;
  const postTotal = posts.standing + posts.removed;

  return {
    version: config.version,
    fingerprint: CONFIG_FINGERPRINT,
    dimensions: [
      dimension(
        "predictions",
        "Prediction accuracy",
        predictions.resolved,
        config.minPredictions,
        () => adjustedAccuracy({ resolved: predictions.resolved, wins: predictions.wins, points: 0 }),
        "Scored calls, adjusted toward 50% until there's a long record."
      ),
      { key: "thesisOutcomes", label: "Thesis outcomes", status: "unavailable", detail: "Judged at each thesis's target date once outcome scoring is switched on." },
      dimension(
        "transparency",
        "Update transparency",
        updates,
        config.minThesisUpdates,
        () => (thesisUpdates.beforeTarget / updates) * 100,
        "Share of thesis updates made before the target date, not after the outcome was known."
      ),
      dimension(
        "riskAwareness",
        "Risk awareness",
        publishedTheses.total,
        config.minPublishedTheses,
        () => (publishedTheses.withRisksAndInvalidation / publishedTheses.total) * 100,
        "Share of published theses that state their risks and what would prove them wrong."
      ),
      dimension(
        "contribution",
        "Constructive contribution",
        postTotal,
        config.minPosts,
        () => (posts.standing / postTotal) * 100,
        "Share of posts and replies that weren't removed by moderators."
      ),
      { key: "helpfulness", label: "Peer helpfulness", status: "unavailable", detail: "Not tracked yet." },
    ],
  };
}

export function isReputationEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.REPUTATION_ENABLED === "true";
}
