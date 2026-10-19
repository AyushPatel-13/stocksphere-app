export function formatPrice(
  value: number | null,
  currency = "USD"
) {
  if (value === null) return "N/A";

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatPercent(
  value: number | null
) {
  if (value === null) return "N/A";

  return `${value.toFixed(2)}%`;
}

export function formatVolume(
  value: number | null
) {
  if (value === null) return "N/A";

  return new Intl.NumberFormat("en-US").format(value);
}

export function formatLargeNumber(
  value: number | null
) {
  if (value === null) return "N/A";

  const abs = Math.abs(value);

  if (abs >= 1_000_000_000_000)
    return (value / 1_000_000_000_000).toFixed(2) + "T";

  if (abs >= 1_000_000_000)
    return (value / 1_000_000_000).toFixed(2) + "B";

  if (abs >= 1_000_000)
    return (value / 1_000_000).toFixed(2) + "M";

  if (abs >= 1_000)
    return (value / 1_000).toFixed(2) + "K";

  return value.toString();
}

export function formatCurrency(
  value: number | null,
  symbol = "$"
) {
  if (value === null) return "N/A";

  return `${symbol}${value.toFixed(2)}`;
}

/**
 * An index level, in points. Indian indices use Indian digit grouping
 * (24,85,012.40); global ones use international grouping. "—" when the
 * provider gave no value.
 */
export function formatIndexValue(
  value: number | null,
  category: "indian" | "global"
) {
  if (value === null) return "—";

  return value.toLocaleString(
    category === "indian" ? "en-IN" : "en-US",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  );
}

/** "+123.45 (+0.52%)", or "—" when either half is missing. */
export function formatIndexChange(
  change: number | null,
  changePercent: number | null
) {
  if (change === null || changePercent === null) return "—";

  const sign = (value: number) => (value >= 0 ? "+" : "");

  return `${sign(change)}${change.toFixed(2)} (${sign(changePercent)}${changePercent.toFixed(2)}%)`;
}
