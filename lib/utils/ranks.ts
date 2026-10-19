/**
 * Prediction accuracy → rank title. Shared by the leaderboard and public
 * profiles so the two can never disagree about someone's rank.
 */
export function getAccuracyRank(accuracy: number) {
  if (accuracy >= 80) return "👑 Market Legend";
  if (accuracy >= 70) return "🏆 Market Analyst";
  if (accuracy >= 60) return "💼 Active Investor";
  if (accuracy >= 50) return "📈 Rookie Investor";
  return "🌱 Newcomer";
}

/** Correct predictions as a percentage of all predictions, one decimal. */
export function accuracyOf(correct: number, total: number) {
  return total > 0 ? Number(((correct / total) * 100).toFixed(1)) : 0;
}
