import Link from "next/link";
import { notFound } from "next/navigation";

import StockTheses from "@/components/Theses/StockTheses";
import { EmptyState, Notice, PageShell, secondaryButtonClass } from "@/components/ui/Page";
import { ROOM_STATE_LABEL, getRoom, type EarningsRoom } from "@/lib/earnings/rooms";
import { getMarketEventStore } from "@/lib/markets/eventIngest";
import { isValidSymbol } from "@/lib/validation/symbol";

export const metadata = { title: "Earnings room" };
export const dynamic = "force-dynamic";

const STATE_TEXT: Record<EarningsRoom["state"], (room: EarningsRoom) => string> = {
  upcoming: (r) => `The board meets in ${r.daysAway} days to consider results.`,
  this_week: (r) => `The board meets in ${r.daysAway} day${r.daysAway === 1 ? "" : "s"} to consider results.`,
  results_day: () => "The board meets today. Results are usually filed with NSE during or after the meeting; NSE doesn't give a time.",
  results_due: () => "The meeting was scheduled for this date. Check NSE's filings for the published results.",
  archived: () => "This meeting was more than two weeks ago.",
};

export default async function EarningsRoomPage({ params }: { params: Promise<{ symbol: string; date: string }> }) {
  const { symbol: rawSymbol, date } = await params;
  const symbol = decodeURIComponent(rawSymbol).toUpperCase();
  if (!isValidSymbol(symbol)) notFound();
  const store = getMarketEventStore();
  // A failed lookup isn't a missing room: say so instead of answering 404.
  const room = store ? await getRoom(store, symbol, date, Date.now()).catch(() => undefined) : undefined;

  if (room === undefined) {
    return (
      <PageShell>
        <EmptyState title="Earnings rooms are unavailable right now" description="Try again in a minute." action={<Link href="/earnings" className={secondaryButtonClass}>All earnings rooms</Link>} />
      </PageShell>
    );
  }
  if (!room) notFound();

  const day = new Date(`${room.meetingDate}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const nseQuote = `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(room.symbol)}`;

  return (
    <PageShell>
      <nav className="mb-4 text-sm text-[#888]" aria-label="Breadcrumb">
        <Link href="/earnings" className="hover:text-white">Earnings rooms</Link> <span aria-hidden="true">›</span> {room.symbol}
      </nav>
      <header className="mb-6">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={`/stock/${encodeURIComponent(room.symbol)}`} className="font-semibold hover:text-[#22c55e]">{room.symbol}</Link>
          <span className="text-xs text-[#777]">NSE{room.isin ? ` · ${room.isin}` : ""}</span>
          <span className="rounded-full border border-[#2a2a2a] px-2 py-0.5 text-[11px] text-[#aaa]">{ROOM_STATE_LABEL[room.state]}</span>
        </div>
        <h1 className="mt-2 text-[26px] font-bold leading-tight sm:text-[30px]">{room.company}: results meeting</h1>
        <p className="mt-1 text-sm text-[#888]">{day}</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-2xl border border-[#222] bg-[#111] p-5">
            <p className="text-[15px] leading-relaxed">{STATE_TEXT[room.state](room)}</p>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs text-[#777]">NSE purpose</dt>
                <dd>{room.purpose}</dd>
              </div>
              <div>
                <dt className="text-xs text-[#777]">Announced</dt>
                <dd>{room.publishedAt ? new Date(room.publishedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST" : "Not given"}</dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <a href={room.sourceUrl} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass}>NSE announcement ↗</a>
              <a href={nseQuote} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass}>Filings on NSE ↗</a>
            </div>
          </section>

          <Notice>
            StockSphere doesn&apos;t read results filings yet, so there&apos;s no AI summary or reported figures here. Ask StockSphere AI to research {room.symbol} for the latest sourced data.
          </Notice>

          <StockTheses symbol={room.symbol} />
        </div>

        <aside className="space-y-3">
          <Link href={`/stock/${encodeURIComponent(room.symbol)}#community`} className={`${secondaryButtonClass} w-full`}>Discuss {room.symbol} in the community</Link>
          <Link href={`/stock/${encodeURIComponent(room.symbol)}`} className={`${secondaryButtonClass} w-full`}>Stock page and chart</Link>
          <Link href={`/theses/new?symbol=${encodeURIComponent(room.symbol)}`} className={`${secondaryButtonClass} w-full`}>Write a thesis</Link>
        </aside>
      </div>
    </PageShell>
  );
}
