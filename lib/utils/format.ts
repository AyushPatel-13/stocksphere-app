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