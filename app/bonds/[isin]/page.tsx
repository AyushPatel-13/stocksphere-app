import type { Metadata } from "next";
import { notFound } from "next/navigation";

import BondCommunity from "@/components/Community/BondCommunity";
import { isBondIsin } from "@/lib/bonds/bonds";
import { getBond } from "@/lib/bonds/catalog";

export const metadata: Metadata = {
  title: "Bond",
  description: "An NSE/BSE-listed bond's exchange record and the community posts that mention it.",
};

/**
 * /bonds/<ISIN> — one listed bond, by its ISIN (never an issuer's ticker).
 * The record comes from the exchange listing; an ISIN no exchange lists as a
 * bond is a 404. If the listing can't be reached the discussion still shows.
 */
export default async function BondPage({ params }: { params: Promise<{ isin: string }> }) {
  const { isin: raw } = await params;
  const isin = decodeURIComponent(raw).toUpperCase();
  if (!isBondIsin(isin)) notFound();

  const found = await getBond(isin);
  if (!found.ok && found.code === "not_found") notFound();

  return <BondCommunity isin={isin} bond={found.ok ? found.bond : null} />;
}
