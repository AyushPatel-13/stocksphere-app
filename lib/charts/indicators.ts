/**
 * Technical indicators for the price chart. Pure functions over closing
 * prices, oldest first. A value that can't be computed yet (not enough
 * history) is null, never zero, so the chart leaves a gap instead of drawing
 * a line down to 0.
 */

/** Simple moving average over `period` closes. */
export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;

  values.forEach((value, i) => {
    sum += value;
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  });

  return out;
}

/** Exponential moving average, seeded with the SMA of the first `period` closes. */
export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (period + 1);
  let previous: number | null = null;

  values.forEach((value, i) => {
    if (i < period - 1) {
      out.push(null);
      return;
    }
    if (previous === null) {
      previous = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      previous = value * k + previous * (1 - k);
    }
    out.push(previous);
  });

  return out;
}

/**
 * Relative Strength Index with Wilder's smoothing (the standard 14-period
 * RSI). 0–100; above 70 is conventionally "overbought", below 30 "oversold".
 */
export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = values.map(() => null);
  if (values.length <= period) return out;

  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const delta = values[i] - values[i - 1];
    if (delta >= 0) gain += delta;
    else loss -= delta;
  }
  gain /= period;
  loss /= period;

  const value = (g: number, l: number) => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
  out[period] = value(gain, loss);

  for (let i = period + 1; i < values.length; i++) {
    const delta = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(delta, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-delta, 0)) / period;
    out[i] = value(gain, loss);
  }

  return out;
}
