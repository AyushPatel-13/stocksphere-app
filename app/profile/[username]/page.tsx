"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import Composer from "@/components/Community/Composer";
import Dialog from "@/components/Profile/Dialog";
import EditProfileDialog from "@/components/Profile/EditProfileDialog";
import ProfileHeader from "@/components/Profile/ProfileHeader";
import ProfileTabs from "@/components/Profile/ProfileTabs";
import ReputationPanel from "@/components/Profile/ReputationPanel";
import { PageShell } from "@/components/ui/Page";
import { useCommunityUser } from "@/lib/community/client";
import type { PostView } from "@/lib/community/types";
import { fetchPredictions } from "@/lib/predictions/client";
import type { PredictionStats } from "@/lib/predictions/rules";
import { getProfileByHandle, type Profile } from "@/lib/profiles";

const NO_STATS: PredictionStats = { resolved: 0, wins: 0, points: 0 };

/**
 * A member's public page: who they are, then their posts, posts and replies,
 * likes and predictions in tabs. The owner can edit their name and bio, and
 * anyone who may post gets a + button for the composer.
 */
export default function UserProfilePage() {
  const params = useParams();
  const username = decodeURIComponent(String(params.username ?? "")).toLowerCase();
  const user = useCommunityUser();

  // undefined while loading, null when no member has this handle.
  const [member, setMember] = useState<Profile | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [stats, setStats] = useState<PredictionStats>(NO_STATS);
  const [editing, setEditing] = useState(false);
  const [composing, setComposing] = useState(false);
  const [added, setAdded] = useState<PostView[]>([]);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getProfileByHandle(username)
      .then((profile) => {
        if (!cancelled) setMember(profile);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    // The prediction record behind the badge (the same one shown next to names in the community).
    fetchPredictions({ user: username, limit: 1 }).then((result) => {
      if (!cancelled && Array.isArray(result) && result[0]) setStats(result[0].user.stats);
    });
    return () => {
      cancelled = true;
    };
  }, [username, attempt]);

  const own = user.status === "ready" && member != null && user.profile.id === member.id;
  const canPost = user.status === "ready";

  return (
    <PageShell>
      {failed ? (
        <div className="rounded-2xl border border-[#222] bg-[#111] px-6 py-12 text-center">
          <p className="font-semibold">This profile couldn&apos;t be loaded.</p>
          <button
            type="button"
            onClick={() => {
              setFailed(false);
              setMember(undefined);
              setAttempt((n) => n + 1);
            }}
            className="mt-3 text-sm text-[#22c55e] hover:underline"
          >
            Try again
          </button>
        </div>
      ) : member === undefined ? (
        <div aria-busy="true" aria-label="Loading profile" className="rounded-2xl border border-[#1f1f1f] bg-[#0d0d0d] p-6">
          <div className="h-20 w-20 animate-pulse rounded-full bg-[#1a1a1a]" />
          <div className="mt-4 h-6 w-48 animate-pulse rounded bg-[#1a1a1a]" />
          <div className="mt-2 h-4 w-32 animate-pulse rounded bg-[#181818]" />
        </div>
      ) : member === null ? (
        <div className="rounded-2xl border border-[#222] bg-[#111] px-6 py-12 text-center">
          <p className="font-semibold">@{username} isn&apos;t a StockSphere member.</p>
          <Link href="/community" className="mt-2 inline-block text-sm text-[#22c55e] hover:underline">
            Back to the community
          </Link>
        </div>
      ) : (
        <>
          <ProfileHeader key={`header-${member.id}`} member={member} user={user} own={own} stats={stats} onEdit={() => setEditing(true)} />
          <ReputationPanel key={`rep-${member.id}`} username={member.username} />
          <ProfileTabs key={`tabs-${member.id}`} username={member.username} user={user} own={own} added={own ? added : []} stats={stats} />
        </>
      )}

      {canPost && member && (
        <button
          type="button"
          onClick={() => setComposing(true)}
          aria-label="Write a post"
          title="Write a post"
          className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#22c55e] text-3xl font-light leading-none text-black shadow-[0_8px_30px_rgba(34,197,94,0.35)] transition hover:scale-105 hover:bg-[#4ade80] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#22c55e] active:scale-95 sm:right-8 sm:bottom-8"
        >
          <span aria-hidden="true">+</span>
        </button>
      )}

      {editing && own && member && (
        <EditProfileDialog
          profile={member}
          onClose={() => setEditing(false)}
          onSaved={(profile) => {
            setMember(profile);
            setEditing(false);
          }}
        />
      )}

      {composing && (
        // The composer asks before discarding a draft, so the dialog leaves Escape and outside clicks to it.
        <Dialog title="New post" onClose={() => setComposing(false)} guarded>
          <Composer
            user={user}
            autoFocus
            onCancel={() => setComposing(false)}
            onPosted={(post) => {
              setAdded((all) => [post, ...all]);
              setComposing(false);
            }}
          />
        </Dialog>
      )}
    </PageShell>
  );
}
