import NewThesis from "@/components/Theses/NewThesis";

export const metadata = { title: "Write a thesis" };

export default async function NewThesisPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { symbol } = await searchParams;
  return <NewThesis symbol={typeof symbol === "string" ? symbol.toUpperCase() : undefined} />;
}
