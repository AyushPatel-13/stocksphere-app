import { accuracy, badgeFor, type PredictionStats } from "@/lib/predictions/rules";

/**
 * A member's prediction badge, shown beside their name wherever they post.
 * Members without a badge yet show their record once they have one (e.g.
 * "4/6"), so readers can still judge; members with no scored predictions
 * show nothing.
 */
export default function PredictionBadge({
  stats,
  size = "sm",
  showRecordWithoutBadge = true,
}: {
  stats: PredictionStats;
  size?: "sm" | "md";
  showRecordWithoutBadge?: boolean;
}) {
  const badge = badgeFor(stats);
  const acc = accuracy(stats);
  if (acc === null) return null;

  const title = `${Math.round(acc)}% accurate over ${stats.resolved} scored prediction${stats.resolved === 1 ? "" : "s"} · ${stats.points} pts`;
  const pad = size === "md" ? "px-2 py-0.5 text-xs" : "px-1.5 py-px text-[10px]";

  if (!badge) {
    if (!showRecordWithoutBadge) return null;
    return (
      <span title={title} className={`inline-flex items-center gap-1 rounded-md border border-[#2a2a2a] font-medium tabular-nums text-[#888] ${pad}`}>
        🎯 {stats.wins}/{stats.resolved}
      </span>
    );
  }

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md border font-semibold ${pad}`}
      style={{ color: badge.color, borderColor: `${badge.color}55`, background: `${badge.color}14` }}
    >
      <span aria-hidden="true">{badge.icon}</span>
      {badge.label}
      <span className="sr-only">, {title}</span>
    </span>
  );
}
