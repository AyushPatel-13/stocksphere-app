"use client";

import type { DraftPhoto } from "@/components/Community/usePhotoDraft";
import { ALT_MAX } from "@/lib/community/images";

/** The draft's photos: a thumbnail each, its upload state, a remove button and an optional description. */
export default function PhotoDraftGrid({
  photos,
  readOnly,
  onRemove,
  onAlt,
}: {
  photos: DraftPhoto[];
  readOnly: boolean;
  onRemove: (id: string) => void;
  onAlt: (id: string, alt: string) => void;
}) {
  return (
    <ul aria-label="Photos" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {photos.map((photo, index) => (
        <li key={photo.id} className="min-w-0">
          <div className="relative aspect-square overflow-hidden rounded-xl border border-[#262626] bg-[#0d0d0d]">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL; next/image can't optimise it */}
            <img src={photo.preview} alt={photo.alt || `Photo ${index + 1}`} className={`h-full w-full object-cover ${photo.status === "uploading" ? "opacity-50" : ""}`} />
            {photo.status === "uploading" && (
              <span role="status" className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-white">
                <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" aria-hidden="true" />
                Uploading…
              </span>
            )}
            {photo.status === "error" && (
              <span role="alert" className="absolute inset-x-0 bottom-0 bg-black/80 px-2 py-1 text-[11px] leading-snug text-[#f87171]">
                {photo.error ?? "Couldn't upload."}
              </span>
            )}
            {!readOnly && (
              <button
                type="button"
                onClick={() => onRemove(photo.id)}
                aria-label={`Remove photo ${index + 1}`}
                className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/75 text-sm text-white hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#22c55e]"
              >
                ✕
              </button>
            )}
          </div>
          {!readOnly && photo.status !== "error" && (
            <input
              type="text"
              value={photo.alt}
              onChange={(event) => onAlt(photo.id, event.target.value)}
              maxLength={ALT_MAX}
              placeholder="Describe it (optional)"
              aria-label={`Description of photo ${index + 1}, for screen readers`}
              className="mt-1 w-full rounded-md border border-[#222] bg-[#0d0d0d] px-2 py-1 text-[11px] text-[#ddd] outline-none placeholder:text-[#555] focus:border-[#3a3a3a]"
            />
          )}
        </li>
      ))}
    </ul>
  );
}
