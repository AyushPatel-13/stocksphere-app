"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Composer from "@/components/Community/Composer";
import PostCard from "@/components/Community/PostCard";
import { secondaryButtonClass } from "@/components/ui/Page";
import { NO_MARKS, fetchPosts, myMarks, type CommunityUser, type Marks, type FeedRangeId, type FeedSortId } from "@/lib/community/client";
import {
  BOARD_SORTS,
  DEFAULT_TAB,
  FEED_TABS,
  RANGES,
  isRanked,
  nextPage,
  showsNewPost,
  usesRange,
  viewParams,
  type FeedViewState,
} from "@/lib/community/feedView";
import type { MentionPick } from "@/lib/community/mentionInput";
import { POST_KINDS, POST_KIND_LABELS, isPostKind, type PostKind, type Sentiment } from "@/lib/community/rules";
import type { PostView } from "@/lib/community/types";

type Filter = "all" | Sentiment;

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "bullish", label: "🐂 Bullish" },
  { id: "bearish", label: "🐻 Bearish" },
];

type Asset = "all" | "stock" | "ipo" | "bond";

const ASSETS: { id: Asset; label: string; empty: string }[] = [
  { id: "all", label: "All", empty: "" },
  { id: "stock", label: "Stocks", empty: "about stocks" },
  { id: "ipo", label: "IPOs", empty: "about IPOs" },
  { id: "bond", label: "Bonds", empty: "about bonds" },
];

/** Whether a post the member just wrote belongs in the filtered list (same rules as the server's). */
function inAsset(post: PostView, asset: Asset): boolean {
  if (asset === "all") return true;
  if (asset === "stock") return post.symbols.length > 0;
  if (asset === "ipo") return Boolean(post.communityId) || (post.mentions ?? []).some((m) => m.kind === "ipo");
  return (post.mentions ?? []).some((m) => m.kind === "bond");
}

const chipClass = (active: boolean) =>
  `shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
    active ? "border-[#22c55e]/60 bg-[#22c55e]/10 text-white" : "border-[#2a2a2a] text-[#aaa] hover:border-[#3a3a3a] hover:text-white"
  }`;

const PAGE = 20;

/** A compact labelled dropdown for the filter row. */
function Select({
  label,
  value,
  active,
  options,
  onChange,
}: {
  label: string;
  value: string;
  active: boolean;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex shrink-0 items-center">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => event.target.value !== value && onChange(event.target.value)}
        className={`rounded-full border bg-[#111] px-3 py-1.5 text-sm font-medium outline-none transition-colors focus:border-[#3a3a3a] ${
          active ? "border-[#22c55e]/60 text-white" : "border-[#2a2a2a] text-[#aaa]"
        }`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

type State =
  | { status: "loading" }
  | { status: "not-configured" }
  /** A ranked feed whose database update hasn't been approved yet. */
  | { status: "ranking-off" }
  | { status: "signed-out" }
  | { status: "error" }
  | { status: "ready"; posts: PostView[]; hasMore: boolean; next: string | null; empty?: "no-follows" };

/**
 * A post box over a stream of posts: one stock's board when `symbol` is set,
 * one IPO's community when `ipoId` is set, the posts that mention a bond when
 * `bond` is set, otherwise every post on StockSphere — which `assetFilters`
 * lets people narrow to stocks, IPOs or bonds (the same posts, filtered).
 */
export default function Feed({
  user,
  symbol,
  ipoId,
  bond,
  assetFilters = false,
  label,
  onPosted,
}: {
  user: CommunityUser;
  symbol?: string;
  /** An Upstox IPO id: that IPO's community (and, once listed, its stock's posts). */
  ipoId?: string;
  /** A bond: the posts that @mention it; new posts start with it tagged. */
  bond?: { isin: string; seed?: MentionPick };
  /** Show the All / Stocks / IPOs / Bonds filter (the community floor). */
  assetFilters?: boolean;
  /** How the board's instrument is named to people (e.g. "NIFTY 50"). */
  label?: string;
  onPosted?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [asset, setAsset] = useState<Asset>("all");
  const [kind, setKind] = useState<PostKind | "all">("all");
  const [exchange, setExchange] = useState<"all" | "NSE" | "BSE">("all");
  const [view, setView] = useState<FeedViewState>({ tab: DEFAULT_TAB, sort: "new", range: "week" });
  const kindParam = kind === "all" ? undefined : kind;
  const exchangeParam = exchange === "all" ? undefined : exchange;
  const bondIsin = bond?.isin;
  const scoped = Boolean(symbol || ipoId || bondIsin);
  const ranked = isRanked(view, scoped);
  // The asset chips filter the newest-first floor; ranked feeds have their own filters.
  const assetParam = !scoped && !ranked && asset !== "all" ? asset : undefined;
  const { feed: feedParam, sort: sortParam, range: rangeParam } = viewParams(view, scoped);
  const [state, setState] = useState<State>({ status: "loading" });
  const [marks, setMarks] = useState<Marks>(NO_MARKS);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const query = {
    symbol,
    ipo: ipoId,
    bond: bondIsin,
    asset: assetParam,
    kind: kindParam,
    exchange: exchangeParam,
    feed: feedParam,
    sort: sortParam,
    range: rangeParam,
    sentiment: filter === "all" ? undefined : filter,
    limit: PAGE,
  };
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    let cancelled = false;

    fetchPosts(JSON.parse(queryKey)).then((result) => {
      if (cancelled) return;
      if ("error" in result) {
        setState({
          status:
            result.code === "NOT_CONFIGURED" ? (ranked ? "ranking-off" : "not-configured") : result.code === "SIGNED_OUT" ? "signed-out" : "error",
        });
      } else {
        setState({ status: "ready", posts: result.posts, hasMore: result.hasMore, next: result.next, empty: result.empty });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [queryKey, ranked, attempt]);

  /** Change the view or a filter: show loading until the new list arrives. */
  function change(apply: () => void) {
    apply();
    setState({ status: "loading" });
  }

  // Which visible posts the viewer has liked.
  const userId = user.status === "ready" ? user.profile.id : null;
  const postIds = state.status === "ready" ? state.posts.map((post) => post.id).join(",") : "";

  useEffect(() => {
    if (!userId || !postIds) return;
    let cancelled = false;
    myMarks(userId, postIds.split(",")).then((found) => {
      if (!cancelled) setMarks(found);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, postIds]);

  async function loadMore() {
    if (state.status !== "ready" || state.posts.length === 0) return;
    const page = nextPage(view, scoped, state.posts, state.next);
    if (!page) return;
    setLoadingMore(true);
    const result = await fetchPosts({ ...query, ...page });
    setLoadingMore(false);
    if (!("error" in result)) {
      // Rankings can shift between pages; never show a post twice.
      const seen = new Set(state.posts.map((p) => p.id));
      setState({ status: "ready", posts: [...state.posts, ...result.posts.filter((p) => !seen.has(p.id))], hasMore: result.hasMore, next: result.next });
    }
  }

  if (state.status === "not-configured") {
    return (
      <div className="rounded-2xl border border-dashed border-[#2a2a2a] bg-[#0b0b0b] px-6 py-12 text-center">
        <p className="text-2xl" aria-hidden="true">💬</p>
        <p className="mt-3 font-semibold">Discussions are launching soon</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-[#888]">
          Posting on {scoped ? label ?? symbol ?? (bondIsin ? "this bond" : "this IPO") : "StockSphere"} opens as soon as community accounts are switched on.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Composer
        user={user}
        symbol={symbol}
        ipoId={ipoId}
        seed={bond?.seed}
        label={label}
        onPosted={(post) => {
          // A new post shows at the top of the list it belongs in.
          const inBond = !bondIsin || (post.mentions ?? []).some((m) => m.kind === "bond" && m.isin === bondIsin);
          const inExchange = exchange === "all" || (post.mentions ?? []).some((m) => m.kind === "instrument" && m.exchange === exchange);
          if (
            state.status === "ready" &&
            showsNewPost(view, scoped) &&
            (filter === "all" || post.sentiment === filter) &&
            (kind === "all" || post.kind === kind) &&
            inAsset(post, scoped || ranked ? "all" : asset) &&
            inBond &&
            inExchange
          ) {
            setState({ ...state, posts: [post, ...state.posts] });
          }
          onPosted?.();
        }}
      />

      {!scoped && (
        <div role="tablist" aria-label="Feed" className="-mx-4 mt-5 flex overflow-x-auto overflow-y-hidden border-b border-[#1f1f1f] px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
          {FEED_TABS.map((tab) => {
            const active = view.tab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => !active && change(() => setView({ ...view, tab: tab.id }))}
                className={`relative shrink-0 px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#22c55e]/60 ${
                  active ? "text-white" : "text-[#888] hover:bg-[#111] hover:text-white"
                }`}
              >
                {tab.label}
                <span aria-hidden="true" className={`absolute inset-x-3 -bottom-px h-[3px] rounded-full ${active ? "bg-[#22c55e]" : "bg-transparent"}`} />
              </button>
            );
          })}
        </div>
      )}

      {assetFilters && !scoped && !ranked && (
        <div role="group" aria-label="What posts are about" className="-mx-1 mt-3 flex items-center gap-2 overflow-x-auto px-1 pb-1">
          {ASSETS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              aria-pressed={asset === entry.id}
              onClick={() => asset !== entry.id && change(() => setAsset(entry.id))}
              className={chipClass(asset === entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}

      <div role="group" aria-label="Filters" className={`mb-3 flex flex-wrap items-center gap-2 ${!scoped ? "mt-2" : "mt-5"}`}>
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            aria-pressed={filter === entry.id}
            onClick={() => filter !== entry.id && change(() => setFilter(entry.id))}
            className={chipClass(filter === entry.id)}
          >
            {entry.label}
          </button>
        ))}

        <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {scoped && (
            <Select
              label="Sort"
              value={view.sort}
              active={view.sort !== "new"}
              onChange={(value) => change(() => setView({ ...view, sort: value as FeedSortId }))}
              options={BOARD_SORTS.map((s) => ({ value: s.id, label: s.label }))}
            />
          )}
          {usesRange(view, scoped) && (
            <Select
              label="Period"
              value={view.range}
              active
              onChange={(value) => change(() => setView({ ...view, range: value as FeedRangeId }))}
              options={RANGES.map((r) => ({ value: r.id, label: r.label }))}
            />
          )}
          <Select
            label="Post type"
            value={kind}
            active={kind !== "all"}
            onChange={(value) => change(() => setKind(isPostKind(value) ? value : "all"))}
            options={[{ value: "all", label: "All types" }, ...POST_KINDS.map((value) => ({ value, label: POST_KIND_LABELS[value] }))]}
          />
          {!bondIsin && !ipoId && (
            <Select
              label="Exchange"
              value={exchange}
              active={exchange !== "all"}
              onChange={(value) => change(() => setExchange(value === "NSE" || value === "BSE" ? value : "all"))}
              options={[
                { value: "all", label: "All exchanges" },
                { value: "NSE", label: "NSE" },
                { value: "BSE", label: "BSE" },
              ]}
            />
          )}
        </span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#222] bg-[#111]">
        {state.status === "loading" &&
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex gap-3 border-b border-[#1b1b1b] px-5 py-4 last:border-b-0">
              <div className="h-10 w-10 animate-pulse rounded-full bg-[#1a1a1a]" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-40 animate-pulse rounded bg-[#1a1a1a]" />
                <div className="h-3.5 w-full animate-pulse rounded bg-[#181818]" />
                <div className="h-3.5 w-2/3 animate-pulse rounded bg-[#181818]" />
              </div>
            </div>
          ))}

        {state.status === "error" && (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-[#888]">Posts couldn&apos;t be loaded right now.</p>
            <button
              type="button"
              onClick={() => change(() => setAttempt((n) => n + 1))}
              className={`${secondaryButtonClass} mt-3`}
            >
              Try again
            </button>
          </div>
        )}

        {state.status === "ranking-off" && (
          <div className="px-6 py-12 text-center">
            <p className="font-semibold">This feed isn&apos;t switched on yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-[#888]">
              {`${scoped ? "Sorting by votes and discussion" : `${FEED_TABS.find((t) => t.id === view.tab)?.label} ranks posts by votes and engagement, which`} needs a database update that hasn't been approved yet.`}
            </p>
            <button
              type="button"
              onClick={() => change(() => setView({ ...view, tab: "latest", sort: "new" }))}
              className={`${secondaryButtonClass} mt-3`}
            >
              Show latest posts
            </button>
          </div>
        )}

        {state.status === "signed-out" && (
          <div className="px-6 py-12 text-center">
            <p className="font-semibold">Sign in to see your Following feed</p>
            <p className="mt-1 text-sm text-[#888]">It shows posts from people you follow and about stocks on your watchlist.</p>
            <Link href="/login" className={`${secondaryButtonClass} mt-3 inline-block`}>
              Sign in
            </Link>
          </div>
        )}

        {state.status === "ready" && state.posts.length === 0 && state.empty === "no-follows" && (
          <div className="px-6 py-12 text-center">
            <p className="font-semibold">You aren&apos;t following anyone or any stock yet</p>
            <p className="mt-1 text-sm text-[#888]">Follow members from their profiles, or add stocks to your watchlist, and their posts show up here.</p>
          </div>
        )}

        {state.status === "ready" && state.posts.length === 0 && !state.empty && ranked && !scoped && view.tab === "trending" && (
          <div className="px-6 py-12 text-center">
            <p className="font-semibold">Nothing is trending right now</p>
            <p className="mt-1 text-sm text-[#888]">Trending shows posts with votes, likes or comments in the last 24 hours.</p>
          </div>
        )}

        {state.status === "ready" && state.posts.length === 0 && !state.empty && !(ranked && !scoped && view.tab === "trending") && (
          <div className="px-6 py-12 text-center">
            <p className="font-semibold">
              {filter === "all" ? "No" : `No ${filter}`} {kind === "all" ? "posts" : `${POST_KIND_LABELS[kind].toLowerCase()} posts`}
              {!scoped && asset !== "all" ? ` ${ASSETS.find((a) => a.id === asset)!.empty}` : ""} yet
            </p>
            <p className="mt-1 text-sm text-[#888]">
              {scoped
                ? `Be the first to share a view on ${label ?? symbol ?? (bondIsin ? "this bond" : "this IPO")}.`
                : asset === "bond"
                  ? "Tag a bond with @ (try “GOI 2033” or “REC bond”) to start one."
                  : "Start the conversation."}
            </p>
          </div>
        )}

        {state.status === "ready" && state.posts.length > 0 && (
          <ul>
            {state.posts.map((post) => (
              <li key={post.id} className="border-b border-[#1b1b1b] last:border-b-0">
                <PostCard
                  post={post}
                  user={user}
                  liked={marks.liked.has(post.id)}
                  vote={marks.votes.get(post.id) ?? 0}
                  reposted={marks.reposted.has(post.id)}
                  saved={marks.saved.has(post.id)}
                  onQuoted={(quote) => state.status === "ready" && showsNewPost(view, scoped) && setState({ ...state, posts: [quote, ...state.posts] })}
                  boardSymbol={symbol}
                  boardIpoId={ipoId}
                  boardBondIsin={bondIsin}
                  onDeleted={(id) =>
                    setState({ ...state, posts: state.posts.filter((p) => p.id !== id) })
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {state.status === "ready" && state.hasMore && (
        <div className="mt-4 text-center">
          <button type="button" onClick={loadMore} disabled={loadingMore} className={secondaryButtonClass}>
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </div>
  );
}
