"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import Dialog from "@/components/Profile/Dialog";
import { listFollows, type FollowPerson } from "@/lib/follows";

/** A member's followers, or the members they follow, each linking to their profile. */
export default function FollowListDialog({
  memberId,
  username,
  direction,
  onClose,
}: {
  memberId: string;
  username: string;
  direction: "followers" | "following";
  onClose: () => void;
}) {
  const [people, setPeople] = useState<FollowPerson[] | "error" | null>(null);

  useEffect(() => {
    let cancelled = false;
    listFollows(memberId, direction).then((found) => {
      if (!cancelled) setPeople(found ?? "error");
    });
    return () => {
      cancelled = true;
    };
  }, [memberId, direction]);

  return (
    <Dialog title={direction === "followers" ? `@${username}'s followers` : `Followed by @${username}`} onClose={onClose}>
      {people === null ? (
        <div aria-busy="true" className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-xl bg-[#151515]" />
          ))}
        </div>
      ) : people === "error" ? (
        <p className="py-6 text-center text-sm text-[#888]">This list couldn&apos;t be loaded right now.</p>
      ) : people.length === 0 ? (
        <p className="py-6 text-center text-sm text-[#888]">
          {direction === "followers" ? `Nobody follows @${username} yet.` : `@${username} isn't following anyone yet.`}
        </p>
      ) : (
        <ul className="-mx-2">
          {people.map((person) => (
            <li key={person.username}>
              <Link
                href={`/profile/${person.username}`}
                onClick={onClose}
                className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-[#151515] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#22c55e]"
              >
                {person.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Google avatar host isn't configured for next/image
                  <img src={person.avatarUrl} alt="" width={40} height={40} referrerPolicy="no-referrer" className="h-10 w-10 rounded-full border border-[#262626] object-cover" />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[#262626] bg-[#151515] font-semibold text-[#22c55e]">
                    {person.displayName.charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-white">{person.displayName}</span>
                  <span className="block truncate text-sm text-[#777]">@{person.username}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
