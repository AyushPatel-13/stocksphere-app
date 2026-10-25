import type { ReactNode } from "react";

import { findCommodity } from "@/lib/data/commodities";

/** The page itself is a client component, so its tab title is set here. */
export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const product = findCommodity(decodeURIComponent(symbol));
  return { title: product ? `${product.name} futures` : "Commodities" };
}

export default function CommodityLayout({ children }: { children: ReactNode }) {
  return children;
}
