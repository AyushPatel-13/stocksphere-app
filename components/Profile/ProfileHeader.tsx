"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import FollowListDialog from "@/components/Profile/FollowListDialog";
import PredictionBadge from "@/components/Predictions/Badge";
import { primaryButtonClass, secondaryButtonClass } from "@/components/ui/Page";
import type { CommunityUser } from "@/lib/community/client";
import { isFollowing, setFollowing } from "@/lib/follows";
import type { PredictionStats } from "@/lib/predictions/rules";
import type { Profile } from "@/lib/profiles";
import { afterFollow, countLabel, memberSince, profileUrl, type FollowCounts } from "@/lib/profileView";

/**
 * Who a member is, from their real profile row: photo, @handle, name, bio,
 * when they joined, whom they follow and who follows them, and their
 * prediction badge (shown only once earned). Profiles have no location, so
 * none is invented. Others' profiles get a Follow button; signed out, it
 * leads to sign-in.
 */
export default function ProfileHeader({
  member,
  user,
  own,
  stats,
  onEdit,
}: {
  member: Profile;
  user: CommunityUser;
  own: boolean;
  stats: PredictionStats;
  onEdit: () => void;
}) {
  const [shared, setShared] = useState<string | null>(null);
  const [counts, setCounts] = useState<FollowCounts>({ followers: member.follower_count ?? 0, following: member.following_count ?? 0 });
  // null until known (or when it couldn't be checked).
  const [following, setFollowingState] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [followError, setFollowError] = useState<string | null>(null);
  const [list, setList] = useState<"followers" | "following" | null>(null);

  const viewerId = user.status === "ready" ? user.profile.id : null;
  useEffect(() => {
    if (!viewerId || own) return;
    let cancelled = false;
    isFollowing(viewerId, member.id).then((answer) => {
      if (!cancelled) setFollowingState(answer);
    });
    return () => {
      cancelled = true;
    };
  }, [viewerId, own, member.id]);

  async function toggleFollow() {
    if (busy || following === null) return;
    const next = !following;
    // Shown at once; put back if the database says no.
    setBusy(true);
    setFollowError(null);
    setFollowingState(next);
    setCounts((c) => afterFollow(c, next));
    const ok = await setFollowing(member.id, next);
    setBusy(false);
    if (!ok) {
      setFollowingState(!next);
      setCounts((c) => afterFollow(c, !next));
      setFollowError(next ? "Couldn't follow right now. Please try again." : "Couldn't unfollow right now. Please try again.");
    }
  }
  const since = memberSince(member.created_at);

  async function share() {
    const url = profileUrl(window.location.origin, member.username);
    try {
      if (navigator.share) {
        await navigator.share({ title: `@${member.username} on StockSphere`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared("Link copied");
    } catch (error) {
      // Closing the share sheet isn't a failure.
      if ((error as { name?: string })?.name === "AbortError") return;
      setShared(url);
    }
    window.setTimeout(() => setShared(null), 4000);
  }

  return (
    <header className="rounded-2xl border border-[#1f1f1f] bg-[#0d0d0d] p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        {member.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- Google avatar host isn't configured for next/image
          <img
            src={member.avatar_url}
            alt={`@${member.username}`}
            width={88}
            height={88}
            referrerPolicy="no-referrer"
            className="h-20 w-20 shrink-0 rounded-full border border-[#262626] object-cover sm:h-[88px] sm:w-[88px]"
          />
        ) : (
          <div
            role="img"
            aria-label={`@${member.username}`}
            className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full border border-[#262626] bg-[#151515] text-3xl font-bold text-[#22c55e] sm:h-[88px] sm:w-[88px]"
          >
            {(member.display_name || member.username).charAt(0).toUpperCase()}
          </div>
        )}

        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <button type="button" onClick={share} className={`${secondaryButtonClass} !px-3 !py-1.5`} aria-label="Share profile">
            <span aria-hidden="true">↗</span> <span className="hidden sm:inline">Share</span>
          </button>
          <Link href={`/theses?user=${encodeURIComponent(member.username)}`} className={`${secondaryButtonClass} !px-3 !py-1.5`} aria-label={`Theses by @${member.username}`}>
            <span aria-hidden="true">✎</span> <span className="hidden sm:inline">Theses</span>
          </Link>
          {own && (
            <Link href="/community/saved" className={`${secondaryButtonClass} !px-3 !py-1.5`} aria-label="Saved posts">
              <span aria-hidden="true">★</span> <span className="hidden sm:inline">Saved</span>
            </Link>
          )}
          {own && (
            <button type="button" onClick={onEdit} className={`${secondaryButtonClass} !py-1.5`}>
              Edit profile
            </button>
          )}
          {!own && user.status === "ready" && (
            <button
              type="button"
              onClick={toggleFollow}
              disabled={busy || following === null}
              aria-pressed={following === true}
              className={`group ${following ? secondaryButtonClass : primaryButtonClass} !py-1.5 min-w-[6.5rem]`}
            >
              {following === null ? (
                "Follow"
              ) : following ? (
                <>
                  <span className="group-hover:hidden">Following</span>
                  <span className="hidden text-[#f87171] group-hover:inline">Unfollow</span>
                </>
              ) : (
                "Follow"
              )}
            </button>
          )}
          {!own && (user.status === "signed-out" || user.status === "no-profile") && (
            <Link href={user.status === "no-profile" ? "/onboarding" : "/login"} className={`${primaryButtonClass} !py-1.5`}>
              Follow
            </Link>
          )}
        </div>
      </div>

      <div className="mt-4 min-w-0">
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold leading-tight tracking-tight sm:text-[28px]">
          <span className="break-all">@{member.username}</span>
          {member.role !== "user" && (
            <span className="rounded-md border border-[#22c55e]/40 bg-[#22c55e]/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-[#4ade80]">
              {member.role === "admin" ? "Team" : "Mod"}
            </span>
          )}
          <PredictionBadge stats={stats} size="md" showRecordWithoutBadge={false} />
        </h1>
        <p className="mt-0.5 text-[15px] font-medium text-[#cfcfcf]">{member.display_name}</p>
        {member.bio ? (
          <p className="mt-3 max-w-2xl whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[#e5e5e5]">{member.bio}</p>
        ) : (
          own && <p className="mt-3 text-sm text-[#666]">Add a bio so people know what you invest in.</p>
        )}

        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm">
          {(["following", "followers"] as const).map((kind) => {
            const { value, label } = countLabel(kind === "following" ? counts.following : counts.followers, kind);
            return (
              <button
                key={kind}
                type="button"
                onClick={() => setList(kind)}
                className="rounded text-[#888] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#22c55e]"
              >
                <span className="font-semibold tabular-nums text-white">{value}</span> {label}
              </button>
            );
          })}
        </div>

        <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-[#888]">
          <li className="flex items-center gap-1.5">
            <span aria-hidden="true">📍</span> Location not available
          </li>
          {since && (
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true">🗓</span>
              <time dateTime={member.created_at}>{since}</time>
            </li>
          )}
        </ul>
      </div>

      <p role="status" aria-live="polite" className="mt-3 break-all text-xs text-[#4ade80] empty:hidden">
        {shared}
      </p>
      {followError && (
        <p role="alert" className="mt-2 text-sm text-[#f87171]">
          {followError}
        </p>
      )}

      {list && <FollowListDialog memberId={member.id} username={member.username} direction={list} onClose={() => setList(null)} />}
    </header>
  );
}
