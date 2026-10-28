import type { FeedRangeId, FeedSortId, FeedTab } from "./client";

/**
 * The feed's tabs and sorts as data, so every page shows the same choices
 * and the rules (which views are ranked, how they page, where a new post
 * shows up) are unit-tested. Safe in the browser.
 */

export const FEED_TABS: { id: FeedTab; label: string; hint: string }[] = [
  { id: "for-you", label: "For You", hint: "Hot posts, with people you follow and stocks you watch ranked higher" },
  { id: "following", label: "Following", hint: "People you follow and stocks on your watchlist" },
  { id: "trending", label: "Trending", hint: "Most engagement in the last 24 hours" },
  { id: "latest", label: "Latest", hint: "Newest first" },
  { id: "top", label: "Top", hint: "Highest voted in the chosen period" },
];

/** The floor opens on Latest (it works without the ranking migrations). */
export const DEFAULT_TAB: FeedTab = "latest";

/** How a single board (a stock, IPO or bond) can be ordered. */
export const BOARD_SORTS: { id: FeedSortId; label: string }[] = [
  { id: "new", label: "Latest" },
  { id: "hot", label: "Hot" },
  { id: "top", label: "Top" },
  { id: "discussed", label: "Most discussed" },
];

export const RANGES: { id: FeedRangeId; label: string }[] = [
  { id: "day", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "year", label: "This year" },
  { id: "all", label: "All time" },
];

export type FeedViewState = { tab: FeedTab; sort: FeedSortId; range: FeedRangeId };

/** Whether this view is ranked by the server's community_feed (paged by offset) rather than newest-first (paged by time). */
export function isRanked(view: FeedViewState, board: boolean): boolean {
  return board ? view.sort !== "new" : view.tab !== "latest";
}

/** Whether a period applies (Top and Most discussed). */
export function usesRange(view: FeedViewState, board: boolean): boolean {
  return board ? view.sort === "top" || view.sort === "discussed" : view.tab === "top";
}

/** The request parameters for this view. */
export function viewParams(view: FeedViewState, board: boolean): { feed?: FeedTab; sort?: FeedSortId; range?: FeedRangeId } {
  if (board) return view.sort === "new" ? {} : { sort: view.sort, ...(usesRange(view, true) ? { range: view.range } : {}) };
  return { feed: view.tab, ...(view.tab === "top" ? { range: view.range } : {}) };
}

/** The next page: an offset for ranked views, the last post's time otherwise. */
export function nextPage(view: FeedViewState, board: boolean, posts: { createdAt: string }[], next: string | null): { offset?: string; before?: string } | null {
  if (isRanked(view, board)) return next ? { offset: next } : null;
  const last = posts[posts.length - 1];
  return last ? { before: last.createdAt } : null;
}

/** A post the viewer just wrote goes on top where newest-first or "for you" ordering would put it there anyway. */
export function showsNewPost(view: FeedViewState, board: boolean): boolean {
  return board ? view.sort === "new" || view.sort === "hot" : view.tab === "latest" || view.tab === "for-you";
}
