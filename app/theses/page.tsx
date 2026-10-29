import ThesesList from "@/components/Theses/ThesesList";

export const metadata = { title: "Theses · StockSphere" };

export default async function ThesesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
  return <ThesesList symbol={one(params.symbol)?.toUpperCase()} user={one(params.user)} />;
}
