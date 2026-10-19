import AssetHub from "@/components/Markets/AssetHub";

export const metadata = { title: "Crypto" };

export default function CryptoPage() {
  return (
    <AssetHub
      type="crypto"
      eyebrow="Crypto"
      title="Cryptocurrencies"
      description="Major coins, priced in Indian rupees or US dollars. Open a coin for its chart and discussion."
      note="Crypto is highly volatile and isn't regulated as a security in India. Under Indian tax rules, gains are taxed at a flat 30% and transfers attract 1% TDS."
    />
  );
}
