/**
 * Individual Indian bonds, as NSE and BSE list them in the cash segment
 * (Upstox instrument search, lib/apis/upstoxInstruments.ts): central
 * government securities, state development loans, T-bills, Sovereign Gold
 * Bonds and corporate bonds/NCDs. Pure functions, safe in the browser.
 *
 * Identity is the ISIN: one per bond, never the issuer's stock ticker (an
 * issuer has many bonds). Only fields the exchange record states are kept:
 *
 *   name        the exchange's description ("GOI LOAN 7.18% 2033")
 *   category    from the instrument type the exchange assigns (GS, SG, TB,
 *               GB, N… or F) together with the ISIN's own structure
 *   issuer      Government of India / a state government (ISIN prefix
 *               IN00 / IN<state>); for a company, the listed equity whose
 *               ISIN carries the same issuer code (INE062A… → State Bank of
 *               India). Null when neither applies.
 *   coupon      the single rate printed in the description; null when there
 *               is none or more than one ("8.12/8.32%")
 *   maturity    the year or date printed in the description, in the formats
 *               the exchanges use; null otherwise
 *
 * Nothing is guessed: a row that doesn't fit these rules isn't a bond here.
 */

export type BondCategory = "government" | "state" | "tbill" | "sgb" | "corporate";

export type BondListing = { exchange: "NSE" | "BSE"; symbol: string };

export type Bond = {
  isin: string;
  name: string;
  issuer: string | null;
  category: BondCategory;
  /** % a year, as printed by the exchange. */
  coupon: number | null;
  /** "2033" or "2027-07-08". */
  maturity: string | null;
  currency: "INR";
  /** NSE first when it lists the bond. */
  listings: BondListing[];
};

/** The cash-segment row fields this module reads (a subset of InstrumentRow). */
export type BondSourceRow = {
  tradingSymbol: string;
  segment: string;
  isin: string | null;
  instrumentType: string | null;
  name: string | null;
};

export const BOND_ISIN = /^IN[A-Z0-9]{9}[0-9]$/;

export const CATEGORY_LABEL: Record<BondCategory, string> = {
  government: "Government security",
  state: "State development loan",
  tbill: "Treasury bill",
  sgb: "Sovereign Gold Bond",
  corporate: "Corporate bond",
};

export function sectorOf(category: BondCategory): "government" | "corporate" {
  return category === "corporate" ? "corporate" : "government";
}

export function bondPath(isin: string): string {
  return `/bonds/${encodeURIComponent(isin)}`;
}

export function isBondIsin(value: unknown): value is string {
  return typeof value === "string" && BOND_ISIN.test(value);
}

/** Central government (IN00…), a state government (IN<digits>…), or a company (INE…). */
const CENTRAL = /^IN00/;
const STATE = /^IN[0-9]{2}/;
/** A company ISIN whose security code (characters 8–9) is a debenture or bond: 07 or 08. */
const CORPORATE_DEBT = /^INE[A-Z0-9]{4}0[78][A-Z0-9]{2}[0-9]$/;
const EQUITY = /^INE[A-Z0-9]{4}01[A-Z0-9]{2}[0-9]$/;

/** The issuer code an ISIN shares with the issuer's other securities ("INE062A"). */
export function issuerCode(isin: string): string | null {
  return /^INE[A-Z0-9]{4}/.test(isin) ? isin.slice(0, 7) : null;
}

export function isEquityIsin(isin: string | null): boolean {
  return Boolean(isin && EQUITY.test(isin));
}

function exchangeOf(segment: string): "NSE" | "BSE" | null {
  return segment.startsWith("NSE_") ? "NSE" : segment.startsWith("BSE_") ? "BSE" : null;
}

/** What kind of bond a row is, or null when it isn't one we can vouch for. */
export function categoryOf(row: BondSourceRow): BondCategory | null {
  const isin = row.isin;
  if (!isin || !BOND_ISIN.test(isin)) return null;
  const type = (row.instrumentType ?? "").toUpperCase();
  const exchange = exchangeOf(row.segment);
  const central = CENTRAL.test(isin);
  const state = !central && STATE.test(isin);

  if (exchange === "NSE") {
    if (central && type === "GS") return "government";
    if (central && type === "TB") return "tbill";
    if (central && type === "GB") return "sgb";
    if (state && type === "SG") return "state";
    if (/^N[0-9A-Z]$/.test(type) && CORPORATE_DEBT.test(isin)) return "corporate";
    return null;
  }
  if (exchange === "BSE") {
    if (type === "G" && state) return "state";
    if (type === "G" && central) {
      if (/^SGB/.test(row.tradingSymbol)) return "sgb";
      if (/^\d{2,3}D\d{6}$/.test(row.tradingSymbol)) return "tbill";
      return "government";
    }
    if (type === "F" && CORPORATE_DEBT.test(isin)) return "corporate";
  }
  return null;
}

const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** The one coupon rate the description prints, or null. */
export function couponOf(name: string, category: BondCategory): number | null {
  if (category === "tbill") return null;
  // Two rates ("8.12/8.32%") — which one applies isn't stated.
  if (/\d\s*\/\s*\d+(?:\.\d+)?\s*%/.test(name)) return null;
  const rates = [...name.matchAll(/(?<![\d.])(\d{1,2}(?:\.\d{1,4})?)\s?%/g)].map((m) => Number(m[1]));
  const unique = [...new Set(rates)];
  return unique.length === 1 && unique[0] < 30 ? unique[0] : null;
}

const pad = (n: string) => n.padStart(2, "0");

/** Day, month and a 2- or 4-digit year → "YYYY-MM-DD"; null when it isn't a date. */
function isoDate(day: string, month: string, year: string): string | null {
  const d = Number(day);
  const m = Number(month);
  if (d < 1 || d > 31 || m < 1 || m > 12) return null;
  const full = year.length === 2 ? `20${year}` : year;
  return /^20\d{2}$/.test(full) ? `${full}-${pad(month)}-${pad(day)}` : null;
}

/** The maturity year or date the description prints, or null. */
export function maturityOf(name: string, category: BondCategory): string | null {
  const text = tidy(name).toUpperCase();
  if (category === "tbill") {
    const m = /TBILL \d{2,3}D-(\d{2})\/(\d{2})\/(\d{2})$/.exec(text);
    return m ? isoDate(m[1], m[2], m[3]) : null;
  }
  if (category === "sgb") {
    return /GOLDBONDS?(20\d{2})/.exec(text)?.[1] ?? null;
  }
  // BSE corporate style: "SBI-7.23%-19-11-39-PVT", "NHAI-6.94%-27-11-2037-PVT" (day-month-year).
  const dated = /\d%-(\d{1,2})-(\d{1,2})-(\d{4}|\d{2})(?:-|$)/.exec(text);
  if (dated) return isoDate(dated[1], dated[2], dated[3]);
  // "GOI LOAN 7.18% 2033", "SDL RJ 6.75% 2030", "REC 7.45% 2035 SR 236A".
  return /\d%\s*(20\d{2})(?:\s|$)/.exec(text)?.[1] ?? null;
}

function issuerFor(category: BondCategory): string | null {
  if (category === "state") return "State government";
  if (category === "corporate") return null;
  return "Government of India";
}

/**
 * Rows → bonds, one per ISIN (NSE's description preferred, both listings
 * kept), in the order the rows came. `issuers` maps an issuer code to the
 * name of the listed equity that carries it.
 */
export function toBonds(rows: BondSourceRow[], issuers: Map<string, string> = new Map()): Bond[] {
  const byIsin = new Map<string, { nse?: BondSourceRow; bse?: BondSourceRow; category: BondCategory }>();
  for (const row of rows) {
    const category = categoryOf(row);
    if (!category || !row.isin) continue;
    const exchange = exchangeOf(row.segment)!;
    const entry = byIsin.get(row.isin) ?? { category };
    if (exchange === "NSE") {
      entry.nse ??= row;
      entry.category = category;
    } else entry.bse ??= row;
    byIsin.set(row.isin, entry);
  }

  const bonds: Bond[] = [];
  for (const [isin, entry] of byIsin) {
    // A BSE row can't change what NSE says the bond is.
    if (entry.nse && entry.bse && categoryOf(entry.bse) !== entry.category) entry.bse = undefined;
    const main = entry.nse ?? entry.bse!;
    const name = tidy(main.name ?? main.tradingSymbol);
    const code = issuerCode(isin);
    bonds.push({
      isin,
      name,
      issuer: issuerFor(entry.category) ?? (code ? issuers.get(code) ?? null : null),
      category: entry.category,
      coupon: couponOf(name, entry.category) ?? (entry.bse && entry.nse ? couponOf(entry.bse.name ?? "", entry.category) : null),
      maturity: maturityOf(name, entry.category) ?? (entry.bse && entry.nse ? maturityOf(entry.bse.name ?? "", entry.category) : null),
      currency: "INR",
      listings: [entry.nse, entry.bse]
        .filter((r): r is BondSourceRow => Boolean(r))
        .map((r) => ({ exchange: exchangeOf(r.segment)!, symbol: r.tradingSymbol })),
    });
  }
  return bonds;
}

/* ------------------------------------------------------------ display */

/** "7.18%" — trailing zeros dropped. */
export function formatCoupon(coupon: number): string {
  return `${Number(coupon.toFixed(4))}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatMaturity(maturity: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(maturity);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : maturity;
}

/** "Government of India · 7.18% · matures 2033 · IN0020230085" — stated fields only. */
export function bondFacts(bond: Pick<Bond, "issuer" | "coupon" | "maturity" | "isin">): string {
  return [
    bond.issuer,
    bond.coupon !== null ? formatCoupon(bond.coupon) : null,
    bond.maturity ? `matures ${formatMaturity(bond.maturity)}` : null,
    bond.isin,
  ]
    .filter(Boolean)
    .join(" · ");
}

/* ------------------------------------------------------------ queries */

type Alias = { pattern: RegExp; categories: BondCategory[]; upstream: (q: { years: string[]; coupons: string[] }) => string; words: string[] };

const ALIASES: Alias[] = [
  {
    pattern: /\b(?:sovereign gold bonds?|gold bonds?|sgbs?)\b/g,
    categories: ["sgb"],
    upstream: ({ years }) => (years[0] ? `GOLDBONDS${years[0]}` : "SGB"),
    words: ["sovereign", "gold", "sgb"],
  },
  {
    pattern: /\b(?:treasury bills?|t-bills?|tbills?|t bills?)\b/g,
    categories: ["tbill"],
    upstream: () => "GOI TBILL",
    words: ["treasury", "bill", "tbill"],
  },
  {
    pattern: /\b(?:state development loans?|sdls?|state government)\b/g,
    categories: ["state"],
    upstream: ({ years, coupons }) => ["SDL", ...coupons, ...years].join(" "),
    words: ["state", "development", "sdl"],
  },
  {
    pattern: /\b(?:government of india|govt\.? of india|goi|g-?secs?|gilts?|central government|government securit(?:y|ies))\b/g,
    categories: ["government", "tbill", "sgb"],
    upstream: ({ years, coupons }) => ["GOI", ...coupons, ...years].join(" "),
    words: ["government", "india", "goi", "gsec", "gilt"],
  },
];

/** Words that say "a bond" but name none. */
const BOND_WORDS = new Set(["bond", "bonds", "ncd", "ncds", "debenture", "debentures"]);
const NOISE = new Set([...BOND_WORDS, "loan", "loans", "of", "the", "a", "an", "and", "%"]);

export type BondQuery = {
  isin: string | null;
  categories: BondCategory[] | null;
  /** What to ask Upstox. */
  upstream: string;
  words: string[];
  years: string[];
  coupons: number[];
  /** The query says it wants a bond ("REC bond", "GOI 2034", an ISIN). */
  explicit: boolean;
};

/** A typed query → what to search for and how to filter. Null when it can't name a bond. */
export function parseBondQuery(raw: string): BondQuery | null {
  const text = raw.toLowerCase().replace(/\s+/g, " ").trim();
  if (text.length < 2) return null;

  const isin = raw.trim().toUpperCase();
  if (BOND_ISIN.test(isin)) return { isin, categories: null, upstream: isin, words: [], years: [], coupons: [], explicit: true };

  let rest = text;
  let alias: Alias | null = null;
  for (const candidate of ALIASES) {
    if (candidate.pattern.test(rest)) {
      alias ??= candidate;
      rest = rest.replace(candidate.pattern, " ");
    }
    candidate.pattern.lastIndex = 0;
  }

  const years: string[] = [];
  const coupons: string[] = [];
  const words: string[] = [];
  let bondWord = false;
  for (const token of rest.split(/[\s,]+/).filter(Boolean)) {
    const bare = token.replace(/%$/, "");
    if (/^(?:19|20)\d{2}$/.test(bare)) years.push(bare);
    else if (/^\d{1,2}(?:\.\d{1,4})?$/.test(bare) && (token.endsWith("%") || bare.includes("."))) coupons.push(bare);
    else if (NOISE.has(bare)) bondWord ||= BOND_WORDS.has(bare);
    else if (/[a-z0-9]/.test(bare)) words.push(bare.replace(/[^a-z0-9&]/g, ""));
  }
  const cleanWords = words.filter(Boolean);

  if (alias) {
    return { isin: null, categories: alias.categories, upstream: alias.upstream({ years, coupons }), words: cleanWords, years, coupons: coupons.map(Number), explicit: true };
  }
  // A company name (or bond symbol) is needed to search corporate bonds.
  if (cleanWords.length === 0) return null;
  return { isin: null, categories: null, upstream: cleanWords.join(" "), words: cleanWords, years, coupons: coupons.map(Number), explicit: bondWord };
}

const wordsOf = (text: string) => text.toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean);

function aliasWords(bond: Bond): string[] {
  return ALIASES.filter((a) => a.categories.includes(bond.category) && a.categories.length === 1).flatMap((a) => a.words)
    .concat(bond.category === "government" || bond.category === "tbill" || bond.category === "sgb" ? ["government", "india", "goi", "gsec", "gilt"] : []);
}

/** Every part of the query matches the bond's stated fields. */
export function bondMatches(bond: Bond, query: BondQuery): boolean {
  if (query.isin) return bond.isin === query.isin;
  if (query.categories && !query.categories.includes(bond.category)) return false;
  if (query.years.some((year) => !bond.maturity?.startsWith(year))) return false;
  if (query.coupons.some((c) => bond.coupon === null || Math.abs(bond.coupon - c) > 1e-6)) return false;
  const haystack = [
    ...wordsOf(bond.name),
    ...wordsOf(bond.issuer ?? ""),
    ...bond.listings.map((l) => l.symbol.toLowerCase()),
    ...aliasWords(bond),
  ];
  return query.words.every((word) => haystack.some((w) => w.startsWith(word)));
}
