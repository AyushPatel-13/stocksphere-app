import type { Metadata } from "next";
import { notFound } from "next/navigation";

import IpoCommunity from "@/components/Community/IpoCommunity";
import { isIpoId } from "@/lib/community/paths";

export const metadata: Metadata = {
  title: "IPO community",
  description: "Members' views on an Indian IPO, with its details from Upstox's IPO API. The same discussion carries on once the company lists.",
};

/**
 * /community/ipo/<Upstox IPO id> — one IPO's community. The URL is stable:
 * after listing it shows the same community, now linked to its stock.
 */
export default async function IpoCommunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ipoId = decodeURIComponent(id);
  if (!isIpoId(ipoId)) notFound();
  return <IpoCommunity ipoId={ipoId} />;
}
