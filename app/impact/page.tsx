import Link from "next/link";

import { EmptyState, Notice, PageHeader, PageShell, secondaryButtonClass } from "@/components/ui/Page";
import { buildImpactMap, macroInWindow, type ImpactMap } from "@/lib/impact/map";
import { getMarketEventStore, ingestIfDue, type MarketEvent } from "@/lib/markets/eventIngest";

export const metadata = { title: "Impact map" };
export const dynamic = "force-dynamic";

const DAY = 86_400_000;
const istDay = (t: number) => new Date(t + 5.5 * 3_600_000).toISOString().slice(0, 10);

async function load(now: number): Promise<{ map: ImpactMap; marketError: boolean }> {
  const from = istDay(now);
  let market: MarketEvent[] = [];
  let marketError = false;
  const store = getMarketEventStore();
  if (store) {
    try {
      await ingestIfDue(store);
      market = await store.list({ from, to: istDay(now + 30 * DAY), limit: 300 });
    } catch {
      marketError = true;
    }
  } else marketError = true;
  return { map: buildImpactMap({ macro: macroInWindow(from, istDay(now + 60 * DAY)), market }), marketError };
}

/** Events on the left, what they connect to on the right; solid = fact, dashed = inference. */
function MapSvg({ map }: { map: ImpactMap }) {
  const row = 30;
  const height = Math.max(map.events.length, map.targets.length) * row + 20;
  const eventY = new Map(map.events.map((e, i) => [e.id, 20 + i * row]));
  const targetY = new Map(map.targets.map((t, i) => [t.id, 20 + i * row]));
  return (
    <svg viewBox={`0 0 900 ${height}`} className="w-full" role="img" aria-label="Impact map: events linked to companies and sectors. The same links are listed below.">
      {map.links.map((link, i) => (
        <path
          key={i}
          d={`M 330 ${eventY.get(link.eventId)} C 450 ${eventY.get(link.eventId)}, 520 ${targetY.get(link.targetId)}, 640 ${targetY.get(link.targetId)}`}
          fill="none"
          stroke={link.kind === "fact" ? "#22c55e" : "#a3a3a3"}
          strokeOpacity={link.kind === "fact" ? 0.7 : 0.45}
          strokeWidth={1.5}
          strokeDasharray={link.kind === "inference" ? "5 4" : undefined}
        />
      ))}
      {map.events.map((e) => (
        <g key={e.id}>
          <circle cx={330} cy={eventY.get(e.id)} r={4} fill={e.category === "central_bank" ? "#facc15" : "#22c55e"} />
          <text x={320} y={(eventY.get(e.id) ?? 0) + 4} textAnchor="end" fontSize="12" fill="#ddd">
            {e.title.length > 40 ? `${e.title.slice(0, 39)}…` : e.title} · {e.date.slice(5)}
          </text>
        </g>
      ))}
      {map.targets.map((t) => (
        <g key={t.id}>
          <circle cx={640} cy={targetY.get(t.id)} r={4} fill={t.kind === "sector" ? "#a3a3a3" : "#22c55e"} />
          <text x={652} y={(targetY.get(t.id) ?? 0) + 4} fontSize="12" fill="#ddd">
            {t.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default async function ImpactPage() {
  const { map, marketError } = await load(Date.now());
  const targets = new Map(map.targets.map((t) => [t.id, t]));

  return (
    <PageShell>
      <PageHeader
        eyebrow="Impact map"
        title="What's coming, and what it touches"
        description="Central-bank meetings and NSE corporate events over the coming weeks, with the companies and sectors they connect to."
        actions={<Link href="/events" className={secondaryButtonClass}>Events calendar →</Link>}
      />
      <Notice>
        <strong className="text-[#ddd]">Fact</strong> links are announcements about that company. <strong className="text-[#ddd]">Inference</strong> links are sectors investors often watch around such events. They aren&apos;t predictions of what will move. Not investment advice.
      </Notice>
      {marketError && <p className="mb-4 text-sm text-[#888]">NSE events are unavailable right now; only central-bank meetings are shown.</p>}

      {map.events.length === 0 ? (
        <EmptyState title="No upcoming events stored" />
      ) : (
        <>
          <section className="mb-6 hidden rounded-2xl border border-[#222] bg-[#111] p-4 lg:block" aria-hidden="true">
            <MapSvg map={map} />
            <p className="mt-2 text-[11px] text-[#666]">Solid green: fact. Dashed grey: inference. Yellow: central bank.</p>
          </section>

          <ol className="space-y-3" aria-label="Events and their links">
            {map.events.map((event) => (
              <li key={event.id} className="rounded-2xl border border-[#222] bg-[#111] p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <p className="font-semibold">{event.title}</p>
                  <p className="text-xs text-[#888]">{event.dateLabel}</p>
                  <a href={event.source.url} target="_blank" rel="noopener noreferrer" className="ml-auto text-[11px] text-[#888] hover:text-white">
                    {event.source.name} ↗
                  </a>
                </div>
                <ul className="mt-2 space-y-1.5">
                  {map.links
                    .filter((link) => link.eventId === event.id)
                    .map((link) => {
                      const target = targets.get(link.targetId)!;
                      return (
                        <li key={link.targetId} className="flex flex-wrap items-baseline gap-2 text-sm">
                          <span className={`rounded border px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${link.kind === "fact" ? "border-[#22c55e]/40 text-[#4ade80]" : "border-[#3a3a3a] text-[#aaa]"}`}>
                            {link.kind}
                          </span>
                          {target.href ? (
                            <Link href={target.href} className="font-medium hover:text-[#22c55e]">{target.label}</Link>
                          ) : (
                            <span className="font-medium">{target.label}</span>
                          )}
                          <span className="text-xs text-[#888]">{link.reason}</span>
                        </li>
                      );
                    })}
                </ul>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[11px] text-[#666]">
            Crude oil and other commodities: see <Link href="/commodities" className="underline">Commodities</Link>. US company earnings aren&apos;t shown (their data source&apos;s licence doesn&apos;t allow it here).
          </p>
        </>
      )}
    </PageShell>
  );
}
