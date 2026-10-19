import AssetHub from "@/components/Markets/AssetHub";

export const metadata = { title: "Bonds" };

export default function BondsPage() {
  return (
    <AssetHub
      type="bond"
      eyebrow="Bonds"
      title="Bonds & yields"
      description="US Treasury yields, and Indian gilt, liquid and Bharat Bond ETFs that trade on NSE."
      note="Free sources don't publish live Indian government-bond yields, so Indian bonds are shown through exchange-traded bond funds. US Treasury figures are yields (%), not prices: when yields rise, bond prices fall."
    />
  );
}
