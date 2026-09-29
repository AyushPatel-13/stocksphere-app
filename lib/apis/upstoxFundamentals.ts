const ACCESS_TOKEN = process.env.UPSTOX_ACCESS_TOKEN;

/**
 * A single row from Upstox's /v2/fundamentals/{isin}/key-ratios response.
 *
 * The endpoint returns a generic ratio list rather than a fixed struct, so a
 * row is identified by its `name` (e.g. "P/E", "ROE") and never by its
 * position. `company_value` is the company's own figure; `sector_value` is the
 * peer benchmark. Values arrive as strings, sometimes with a unit suffix.
 */
export interface UpstoxKeyRatio {
  name: string;
  company_value?: unknown;
  sector_value?: unknown;
}

/**
 * GET /v2/fundamentals/{isin}/key-ratios
 *
 * Keyed by ISIN, not by trading symbol — resolve the ISIN with
 * searchUpstoxEquity() first (see lib/providers/financials.ts).
 *
 * Returns:
 *  - an array (possibly empty) when Upstox answered successfully
 *  - null when the request failed or the response was not in the expected shape
 * Throws if UPSTOX_ACCESS_TOKEN is missing, matching lib/apis/upstox.ts; the
 * provider path catches that so it never reaches the agent tool.
 */
export async function getUpstoxKeyRatios(
  isin: string
): Promise<UpstoxKeyRatio[] | null> {
  if (!ACCESS_TOKEN) {
    throw new Error(
      "UPSTOX_ACCESS_TOKEN is missing from environment variables"
    );
  }

  const trimmedIsin = isin.trim();

  if (!trimmedIsin) {
    return null;
  }

  try {
    const response = await fetch(
      `https://api.upstox.com/v2/fundamentals/${encodeURIComponent(
        trimmedIsin
      )}/key-ratios`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${ACCESS_TOKEN}`,
        },
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const errorText = await response.text();

      console.error(
        `Upstox Key Ratios Error ${response.status}:`,
        errorText
      );

      return null;
    }

    const data = await response.json();
    const rows: unknown = data?.data;

    // Not the documented shape: report "unavailable", not "no ratios".
    if (!Array.isArray(rows)) {
      return null;
    }

    const ratios: UpstoxKeyRatio[] = [];

    for (const row of rows) {
      if (!row || typeof row !== "object") continue;

      const entry = row as Record<string, unknown>;

      if (
        typeof entry.name !== "string" ||
        !entry.name.trim()
      ) {
        continue;
      }

      ratios.push({
        name: entry.name,
        ...(entry.company_value !== undefined && {
          company_value: entry.company_value,
        }),
        ...(entry.sector_value !== undefined && {
          sector_value: entry.sector_value,
        }),
      });
    }

    return ratios;
  } catch (error) {
    console.error(
      `Upstox Key Ratios Error [${trimmedIsin}]:`,
      error
    );

    return null;
  }
}
