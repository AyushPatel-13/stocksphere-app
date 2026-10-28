"use client";

import { useEffect, useRef, useState } from "react";

import { galleryLayout, singleAspect } from "@/lib/community/images";

type Image = { url: string; width: number; height: number; alt: string };

/**
 * A post's photos, laid out like X and Reddit: one shows at its own shape,
 * two side by side, three as one tall beside two stacked, four in a grid.
 * Each opens the full-screen viewer.
 */
export default function PostImages({ images, author }: { images: Image[]; author: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!images.length) return null;
  const layout = galleryLayout(images.length);
  const label = (index: number) => images[index].alt || `Photo ${index + 1} of ${images.length} from @${author}'s post`;

  return (
    <>
      <div
        className={`mt-2.5 grid gap-0.5 overflow-hidden rounded-2xl border border-[#262626] bg-[#0d0d0d] ${layout.grid}`}
        style={images.length === 1 ? { aspectRatio: String(singleAspect(images[0].width, images[0].height)) } : undefined}
      >
        {images.map((image, index) => (
          <button
            key={image.url}
            type="button"
            onClick={() => setOpen(index)}
            aria-label={`Open ${label(index)}`}
            className={`relative block h-full min-h-0 w-full overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#22c55e] ${layout.cells[index] ?? ""}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage isn't a configured next/image host */}
            <img
              src={image.url}
              alt={label(index)}
              width={image.width}
              height={image.height}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-opacity hover:opacity-90"
            />
          </button>
        ))}
      </div>
      {open !== null && <PhotoViewer images={images} start={open} label={label} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Full screen, one photo at a time: arrows or swipe to move, Escape or ✕ to close. */
function PhotoViewer({ images, start, label, onClose }: { images: Image[]; start: number; label: (index: number) => string; onClose: () => void }) {
  const [index, setIndex] = useState(start);
  const closeButton = useRef<HTMLButtonElement>(null);
  const touchX = useRef<number | null>(null);
  const count = images.length;
  const go = (step: number) => setIndex((i) => (i + step + count) % count);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight" && count > 1) setIndex((i) => (i + 1) % count);
      if (event.key === "ArrowLeft" && count > 1) setIndex((i) => (i - 1 + count) % count);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [count, onClose]);

  const image = images[index];
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Photo ${index + 1} of ${count}`}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/95"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onTouchStart={(event) => {
        touchX.current = event.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(event) => {
        const startX = touchX.current;
        touchX.current = null;
        const endX = event.changedTouches[0]?.clientX;
        if (startX === null || endX === undefined || count < 2) return;
        if (endX - startX > 50) go(-1);
        if (startX - endX > 50) go(1);
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- Supabase Storage isn't a configured next/image host */}
      <img src={image.url} alt={label(index)} className="max-h-[88vh] max-w-[94vw] select-none object-contain" draggable={false} />

      <button
        ref={closeButton}
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-lg text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#22c55e]"
      >
        ✕
      </button>

      {count > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-xl text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#22c55e] sm:left-4"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-xl text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#22c55e] sm:right-4"
          >
            ›
          </button>
        </>
      )}

      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-1 px-4 pb-4 text-center text-sm text-white/80">
        {image.alt && <p className="max-w-2xl break-words">{image.alt}</p>}
        <p className="flex items-center gap-3 text-xs text-white/60">
          {count > 1 && (
            <span aria-live="polite">
              {index + 1} / {count}
            </span>
          )}
          <a href={image.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-white">
            Open original
          </a>
        </p>
      </div>
    </div>
  );
}
