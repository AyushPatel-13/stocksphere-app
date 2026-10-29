import Link from "next/link";

import { EmptyState, PageShell, secondaryButtonClass } from "@/components/ui/Page";

export default function EarningsRoomNotFound() {
  return (
    <PageShell>
      <EmptyState title="Earnings room not found" description="There's no NSE results meeting stored for this company on that date." action={<Link href="/earnings" className={secondaryButtonClass}>All earnings rooms</Link>} />
    </PageShell>
  );
}
