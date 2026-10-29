/**
 * Listings that no longer trade under the symbol or name people still use,
 * and what to show instead. Browser-safe; shared by the search box
 * (./instruments), the AI's resolve_symbol tool and the stock page, so they
 * can't disagree about where an old name leads.
 *
 * Only add an entry once the successor is verified on the exchange (each
 * successor below was priced by Upstox on 28 Oct 2026). Lower-case names.
 */

export type Successor = { symbol: string; name: string };

export type RetiredListing = {
  /** The NSE symbol that no longer trades. */
  symbol: string;
  /** Names people still search by, lower-case. */
  formerNames: string[];
  successors: Successor[];
  /** One sentence, shown to people and to the AI. */
  note: string;
};

export const RETIRED_LISTINGS: RetiredListing[] = [
  {
    symbol: "ZOMATO",
    formerNames: ["zomato"],
    successors: [{ symbol: "ETERNAL", name: "Eternal Ltd" }],
    note: "Zomato Ltd was renamed Eternal Ltd in 2025 and trades on NSE as ETERNAL.",
  },
  {
    symbol: "TATAMOTORS",
    formerNames: ["tata motors"],
    successors: [
      { symbol: "TMPV", name: "Tata Motors Passenger Vehicles Ltd" },
      { symbol: "TMCV", name: "Tata Motors Ltd (commercial vehicles)" },
    ],
    note: "Tata Motors demerged in 2025: the passenger-vehicle business trades on NSE as TMPV and the commercial-vehicle business as TMCV.",
  },
];

const BY_SYMBOL = new Map(RETIRED_LISTINGS.map((listing) => [listing.symbol, listing]));
const BY_NAME = new Map(RETIRED_LISTINGS.flatMap((listing) => listing.formerNames.map((name) => [name, listing] as const)));

/** The retired listing a symbol ("TATAMOTORS", "zomato.ns") or former name ("Tata Motors") refers to, if any. */
export function retiredListing(query: string | null | undefined): RetiredListing | null {
  const text = (query ?? "").trim().replace(/\.(NS|BSE|BO)$/i, "").replace(/\s+/g, " ");
  if (!text) return null;
  return BY_SYMBOL.get(text.toUpperCase()) ?? BY_NAME.get(text.toLowerCase()) ?? null;
}

/** Whether a symbol is one that no longer trades. */
export function isRetiredSymbol(symbol: string): boolean {
  return BY_SYMBOL.has(symbol.trim().replace(/\.(NS|BSE|BO)$/i, "").toUpperCase());
}
