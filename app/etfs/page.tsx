import AssetHub from "@/components/Markets/AssetHub";

export const metadata = { title: "ETFs" };

export default function EtfsPage() {
  return (
    <AssetHub
      type="etf"
      eyebrow="ETFs"
      title="Exchange-traded funds"
      description="Popular Indian ETFs in rupees and US ETFs in dollars. Open any fund for its chart and discussion."
    />
  );
}
