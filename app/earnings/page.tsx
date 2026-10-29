import Link from "next/link";

import { EmptyState, Notice, PageHeader, PageShell, secondaryButtonClass } from "@/components/ui/Page";
import { ROOM_STATE_LABEL, listRooms, roomHref, type EarningsRoom } from "@/lib/earnings/rooms";
import { getMarketEventStore } from "@/lib/markets/eventIngest";
import { isMissingTable } from "@/lib/watchlistRules";

export const metadata = { title: "Earnings rooms" };
export const dynamic = "force-dynamic";

function formatDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
}

async function load(): Promise<{ rooms: EarningsRoom[] } | { error: string }> {
  const store = getMarketEventStore();
  if (!store) return { error: "Earnings rooms aren't set up yet." };
  try {
    return { rooms: await listRooms(store, Date.now()) };
  } catch (error) {
    return { error: isMissingTable(error as { code?: string }) ? "Earnings rooms are launching soon." : "Earnings rooms are unavailable right now." };
  }
}

export default async function EarningsPage() {
  const result = await load();
  return (
    <PageShell>
      <PageHeader
        eyebrow="Earnings"
        title="Earnings rooms"
        description="A room for each Indian company's results meeting announced on NSE: the date, the filing, and the discussion in one place."
        actions={<Link href="/events" className={secondaryButtonClass}>Events calendar →</Link>}
      />
      <Notice>Dates come from NSE board-meeting announcements; NSE gives a date, not a time. US companies aren&apos;t covered yet.</Notice>
      {"error" in result ? (
        <EmptyState title={result.error} />
      ) : result.rooms.length === 0 ? (
        <EmptyState title="No results meetings stored yet" description="Rooms appear as NSE announces results meetings." />
      ) : (
        <ul className="divide-y divide-[#1b1b1b] rounded-2xl border border-[#222] bg-[#111]">
          {result.rooms.map((room) => (
            <li key={`${room.symbol}-${room.meetingDate}`}>
              <Link
                href={roomHref(room)}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm hover:bg-[#151515] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#22c55e]/50"
              >
                <span className="w-24 tabular-nums text-xs text-[#aaa]">{formatDay(room.meetingDate)}</span>
                <span className="w-28 font-semibold">{room.symbol}</span>
                <span className="min-w-0 flex-1 truncate text-[#999]">{room.company}</span>
                <span className={`rounded-full border px-2 py-0.5 text-[11px] ${room.state === "results_day" ? "border-[#22c55e]/50 text-[#4ade80]" : "border-[#2a2a2a] text-[#aaa]"}`}>
                  {ROOM_STATE_LABEL[room.state]}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}
