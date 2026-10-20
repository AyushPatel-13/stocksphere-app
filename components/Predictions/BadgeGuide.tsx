import { BADGES, HORIZONS as HORIZON_LABELS } from "@/lib/predictions/rules";
import { SCORING_V2 } from "@/lib/predictions/v2/config";

/** "How scoring and badges work" — generated from the same rules the server applies. */
export default function BadgeGuide() {
  return (
    <section className="rounded-2xl border border-[#222] bg-[#111] p-5">
      <h2 className="font-semibold">How scoring works</h2>
      <ul className="mt-3 space-y-1.5 text-[13px] leading-relaxed text-[#9a9a9a]">
        <li>
          • Call UP, DOWN or SIDEWAYS over {HORIZON_LABELS.map((h) => `${h.label} (${SCORING_V2.horizons[h.id].base} pts)`).join(", ")}.
        </li>
        <li>
          • Each call has a small band around the price, set from how much the asset normally moves. UP/DOWN must finish beyond it;
          SIDEWAYS must finish inside it. Finishing inside the band on an UP/DOWN call is “flat” and doesn&apos;t count.
        </li>
        <li>• A wrong call loses points: more the further the price went the other way, capped at twice the base.</li>
        <li>• A target adds up to +10 when a correct call finishes close to it, and −5 when it&apos;s far off.</li>
        <li>
          • The result is the official close of the last trading session in the time frame (1, 5 or 21
          sessions); crypto uses the exact time. Calls are locked when you make them.
        </li>
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
