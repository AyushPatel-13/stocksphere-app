import ThesisPage from "@/components/Theses/ThesisPage";

export const metadata = { title: "Thesis · StockSphere" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ThesisPage id={id} />;
}
