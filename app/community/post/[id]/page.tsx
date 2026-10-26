import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PostThread from "@/components/Community/PostThread";

export const metadata: Metadata = {
  title: "Community post",
  description: "A community post and its full comment thread.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /community/post/<post id>?comment=<comment id> — one post with its whole
 * thread open, scrolled to the comment a reply notification points at. A
 * comment's own id opens its post.
 */
export default async function CommunityPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ comment?: string | string[] }>;
}) {
  const { id } = await params;
  const { comment } = await searchParams;
  if (!UUID.test(id)) notFound();
  const highlight = typeof comment === "string" && UUID.test(comment) ? comment.toLowerCase() : undefined;
  return <PostThread id={id.toLowerCase()} highlight={highlight} />;
}
