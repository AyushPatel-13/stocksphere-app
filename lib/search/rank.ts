/**
 * Instrument match ranking, shared by the AI assistant's symbol resolver
 * (lib/agent/tools/symbolResolverTool.ts) and the search box (/api/search),
 * so both order "TCS", "Reliance" or "HDFC Bank" the same way.
 */

// The words a registry decorates a company name with that say nothing about
// *which* company it is: "Reliance Industries Ltd" and "Reliance Industries" are
// the same name to someone typing it. Only these trailing forms are dropped —
// never a distinguishing word. "Industries" is what separates Reliance
// Industries from Reliance Power, so stripping it would merge two companies.
const LEGAL_FORM_TOKENS = new Set([
  "ltd",
  "limited",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "llp",
  "pvt",
  "private",
]);

const NAME_SEPARATORS = /[^a-z0-9]+/g;

/**
 * A company name reduced to comparable words: lower-cased, punctuation dropped,
 * trailing legal forms removed. "HDFC Bank Ltd" and "HDFC Bank" both become
 * ["hdfc", "bank"].
 */
export function companyNameTokens(name: string): string[] {
  const tokens = name.toLowerCase().split(NAME_SEPARATORS).filter(Boolean);

  while (tokens.length > 0 && LEGAL_FORM_TOKENS.has(tokens[tokens.length - 1])) {
    tokens.pop();
  }

  return tokens;
}

/** Whether `name` begins with the query as a whole run of words, not mid-word. */
function startsWithTokenRun(nameTokens: string[], queryTokens: string[]): boolean {
  return (
    queryTokens.length > 0 &&
    queryTokens.length <= nameTokens.length &&
    queryTokens.every((token, index) => nameTokens[index] === token)
  );
}

// Ordered by how much the match actually proves:
//
//   0  the query IS the ticker                    "TCS"          -> TCS
//   1  the query is the start of the ticker       "RELI"         -> RELIANCE
//   2  the query IS the company name              "Infosys"      -> Infosys Ltd
//   3  the name starts with the query as words    "HDFC Bank"    -> HDFC Bank Ltd
//   4  the name contains the query                "Infosys"      -> HCL Infosystems
//   5  anything else (e.g. symbol merely contains the query)
//
// Tiers 2 and 3 compare *words with the legal form set aside*, not raw strings:
// a registry spells names out ("Infosys Ltd"), so a query a person would call
// the exact company name would otherwise never equal the stored one. Tier 3 is
// the honest home of real ambiguity — "Tata" leaves TATAMOTORS, TATASTEEL and
// TCS tied, and they should stay tied.
export function matchTier(
  bareSymbol: string,
  name: string,
  lowerQuery: string,
  queryTokens: string[] = companyNameTokens(lowerQuery)
): number {
  const symbol = bareSymbol.toLowerCase();

  if (symbol === lowerQuery) return 0;
  if (symbol.startsWith(lowerQuery)) return 1;

  const nameTokens = companyNameTokens(name);

  if (nameTokens.length > 0 && nameTokens.join(" ") === queryTokens.join(" ")) return 2;
  if (startsWithTokenRun(nameTokens, queryTokens)) return 3;

  const lowerName = name.toLowerCase();

  if (lowerName === lowerQuery) return 2;
  if (lowerName.includes(lowerQuery)) return 4;
  return 5;
}
