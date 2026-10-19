import { BADGES, FLAT_THRESHOLD_PCT, HORIZONS } from "@/lib/predictions/rules";

/** "How scoring and badges work" — generated from the same rules the server applies. */
export default function BadgeGuide() {
  return (
    <section className="rounded-2xl border border-[#222] bg-[#111] p-5">
      <h2 className="font-semibold">How scoring works</h2>
      <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-[#9a9a9a]">
        <li>
          • Call the direction over {HORIZONS.map((h) => `${h.label} (${h.points} pts)`).join(", ")}.
        </li>
        <li>• Hit or come within 1% of your target: +10 bonus. Within 3%: +5.</li>
        <li>• Wrong direction scores 0. A move under {FLAT_THRESHOLD_PCT}% doesn&apos;t count either way.</li>
        <li>• Your entry price is locked by StockSphere when you predict, and predictions can&apos;t be edited or deleted.</li>
      </ul>

      <h2 className="mt-5 font-semibold">Badges</h2>
      <ul className="mt-3 space-y-2">
        {[...BADGES].reverse().map((badge) => (
          <li key={badge.id} className="flex items-center gap-3 text-[13px]">
            <span
              className="inline-flex min-w-[118px] items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold"
              style={{ color: badge.color, borderColor: `${badge.color}55`, background: `${badge.color}14` }}
            >
              {badge.icon} {badge.label}
            </span>
            <span className="text-[#9a9a9a]">
              {badge.minResolved}+ scored · {badge.minAccuracy}%+ accurate
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-[#666]">
        Badges appear next to your name in the community, so others can see your track record.
      </p>
    </section>
  );
}
