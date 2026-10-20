import type { Metadata } from "next";

import IpoBoard from "@/components/Markets/IpoBoard";

export const metadata: Metadata = {
  title: "IPOs",
  description:
    "Indian mainboard and SME IPOs — open, upcoming and recently closed — with price band, lot size, subscription, allotment and listing dates and listing gains, from Upstox's IPO API.",
};

export default function IpoPage() {
  return <IpoBoard />;
}
