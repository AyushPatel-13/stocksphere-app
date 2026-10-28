"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { photoUploadsEnabled, prepareImage, removePhotos, uploadPhoto, type UploadedImage } from "@/lib/community/imageClient";
import { ALT_MAX, MAX_IMAGES, fileProblem } from "@/lib/community/images";

/**
 * The photos in a draft. Each is resized and uploaded as soon as it's added,
 * so posting is instant; one taken out again, or a draft discarded or left,
 * is removed from storage straight away (and anything missed by the daily
 * cleanup). Posting hands the uploads to the post (`markPosted`), after which
 * they're no longer the draft's to remove.
 */

export type DraftPhoto = {
  id: string;
  /** A local preview (object URL), shown until and after the upload. */
  preview: string;
  status: "uploading" | "ready" | "error";
  error?: string;
  image?: UploadedImage;
  alt: string;
};

let localIds = 0;

export function usePhotoDraft(active: boolean) {
  const [enabled, setEnabled] = useState(false);
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // The latest list, for cleanup when the composer goes away.
  const current = useRef<DraftPhoto[]>([]);
  useEffect(() => {
    current.current = photos;
  }, [photos]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    photoUploadsEnabled().then((on) => {
      if (!cancelled) setEnabled(on);
    });
    return () => {
      cancelled = true;
    };
  }, [active]);

  // Leaving the page or closing the composer with unposted photos: take them back.
  useEffect(
    () => () => {
      const left = current.current;
      void removePhotos(left.flatMap((p) => (p.image ? [p.image.path] : [])));
      for (const p of left) URL.revokeObjectURL(p.preview);
    },
    []
  );

  const update = (id: string, change: Partial<DraftPhoto>) => setPhotos((all) => all.map((p) => (p.id === id ? { ...p, ...change } : p)));

  const add = useCallback(
    async (files: File[]) => {
      setNotice(null);
      if (!enabled) return;
      const room = MAX_IMAGES - current.current.length;
      if (room <= 0) {
        setNotice(`A post can have up to ${MAX_IMAGES} photos.`);
        return;
      }
      if (files.length > room) setNotice(`Only ${room} more ${room === 1 ? "photo fits" : "photos fit"}; the rest weren't added.`);

      for (const file of files.slice(0, room)) {
        const problem = fileProblem(file);
        if (problem) {
          setNotice(problem);
          continue;
        }
        const id = `photo-${++localIds}`;
        const preview = URL.createObjectURL(file);
        setPhotos((all) => [...all, { id, preview, status: "uploading", alt: "" }]);

        const prepared = await prepareImage(file);
        if (!prepared.ok) {
          update(id, { status: "error", error: prepared.error });
          continue;
        }
        const uploaded = await uploadPhoto(prepared.blob);
        // Removed while it was uploading: take the upload straight back.
        if (!current.current.some((p) => p.id === id)) {
          if (uploaded.ok) void removePhotos([uploaded.image.path]);
          continue;
        }
        update(id, uploaded.ok ? { status: "ready", image: uploaded.image } : { status: "error", error: uploaded.error });
      }
    },
    [enabled]
  );

  function remove(id: string) {
    const photo = current.current.find((p) => p.id === id);
    if (!photo) return;
    if (photo.image) void removePhotos([photo.image.path]);
    URL.revokeObjectURL(photo.preview);
    setPhotos((all) => all.filter((p) => p.id !== id));
    setNotice(null);
  }

  function setAlt(id: string, alt: string) {
    update(id, { alt: alt.slice(0, ALT_MAX) });
  }

  /** Discard: remove every upload and preview. */
  function clear() {
    void removePhotos(current.current.flatMap((p) => (p.image ? [p.image.path] : [])));
    for (const p of current.current) URL.revokeObjectURL(p.preview);
    current.current = [];
    setPhotos([]);
    setNotice(null);
  }

  /** Posted: the uploads now belong to the post, so only the previews go. */
  function markPosted() {
    for (const p of current.current) URL.revokeObjectURL(p.preview);
    current.current = [];
    setPhotos([]);
    setNotice(null);
  }

  return {
    enabled,
    photos,
    notice,
    uploading: photos.some((p) => p.status === "uploading"),
    failed: photos.some((p) => p.status === "error"),
    /** What the post sends: uploaded photos, in order. */
    ready: photos.flatMap((p) => (p.status === "ready" && p.image ? [{ path: p.image.path, alt: p.alt.trim() }] : [])),
    add,
    remove,
    setAlt,
    clear,
    markPosted,
  };
}
