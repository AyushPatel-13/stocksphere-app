import type { Metadata } from "next";

import SavedPosts from "@/components/Community/SavedPosts";

export const metadata: Metadata = {
  title: "Saved posts",
  description: "Community posts you saved. Only you can see this list.",
};

/** /community/saved — the posts you bookmarked, newest save first. Private to you. */
export default function SavedPostsPage() {
  return <SavedPosts />;
}
