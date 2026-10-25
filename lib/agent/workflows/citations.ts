/**
 * Evidence and citations for research workflows.
 *
 * Every fact the server fetched becomes one evidence item with an id (E1,
 * E2…), its source, when it was fetched, and a URL only when the source itself
 * gave one. The model cites ids, never URLs. Afterwards the answer is checked
 * here, deterministically:
 *
 *   - [E7] where no E7 exists is removed (a citation to nothing);
 *   - any URL in the answer that isn't one of the evidence URLs is removed,
 *     so a made-up link can never reach the user;
 *   - the remaining ids become numbered references with a Sources list that
 *     shows each item's source and timestamp.
 */

export type Evidence = {
  id: string;
  title: string;
  source: string;
  fetchedAt: string;
  /** Time the data itself refers to (last trade, publication), when known. */
  asOf?: string | null;
  url?: string | null;
  data: unknown;
};

export type CitationReport = {
  answer: string;
  cited: Evidence[];
  unknownCitations: number;
  removedUrls: number;
};

// [E2], [E2, E5], and the full-width 【E2】 / 【E2†source】 some models write.
const CITATION_GROUP = /[[【]\s*(E\d+(?:\s*[,;]\s*E\d+)*)\s*(?:†[^\]】\n]*)?[\]】]/g;
const MD_LINK = /\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL = /https?:\/\/[^\s)\]>"']+/g;

function formatTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/** The evidence pack exactly as the model sees it: compact, one item per block. */
export function serialiseEvidence(evidence: Evidence[]): string {
  return evidence
    .map((e) => {
      const when = e.asOf ? `as of ${e.asOf}` : `fetched ${e.fetchedAt}`;
      return `[${e.id}] ${e.title} — source: ${e.source}, ${when}\n${JSON.stringify(e.data)}`;
    })
    .join("\n\n");
}

const DISCLAIMER = "_This is general information, not investment advice._";
const SOURCES_HEADING = "\n\n**Sources**";

/**
 * Makes sure a rendered note carries the disclaimer, placed before the Sources
 * list. When the model's own text didn't end cleanly (the provider's output
 * limit cut it off), says so rather than letting a half-finished note pass as
 * complete.
 */
export function ensureDisclaimer(rendered: string, modelText: string): string {
  if (/not investment advice/i.test(rendered)) return rendered;
  const cutShort = !/[.!?)\]_*]\s*$/.test(modelText.trim());
  const insert = `${cutShort ? "\n\n_The note was cut short by the AI service's length limit._" : ""}\n\n${DISCLAIMER}`;
  const at = rendered.indexOf(SOURCES_HEADING);
  return at === -1 ? `${rendered}${insert}` : `${rendered.slice(0, at)}${insert}${rendered.slice(at)}`;
}

export function renderCitations(answer: string, evidence: Evidence[]): CitationReport {
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const allowedUrls = new Set(evidence.map((e) => e.url).filter((u): u is string => !!u));
  let removedUrls = 0;
  let unknownCitations = 0;

  // 1. Links and bare URLs that didn't come from the evidence are removed.
  let text = answer.replace(MD_LINK, (whole, label: string, url: string) => {
    if (allowedUrls.has(url)) return whole;
    removedUrls++;
    return label;
  });
  text = text.replace(BARE_URL, (url, offset: number, full: string) => {
    if (full.slice(Math.max(0, offset - 2), offset) === "](") return url; // inside an allowed markdown link
    if (allowedUrls.has(url)) return url;
    removedUrls++;
    return "";
  });

  // 2. Citations become numbered references, in order of first use.
  const order: Evidence[] = [];
  const numberOf = (e: Evidence) => {
    let index = order.indexOf(e);
    if (index === -1) {
      order.push(e);
      index = order.length - 1;
    }
    return index + 1;
  };

  text = text.replace(CITATION_GROUP, (_whole, group: string) => {
    const refs = group
      .split(/\s*[,;]\s*/)
      .map((id) => {
        const item = byId.get(id.trim());
        if (!item) unknownCitations++;
        return item;
      })
      .filter((item): item is Evidence => !!item);
    if (refs.length === 0) return "";
    return refs
      .map((item) => {
        const n = numberOf(item);
        return item.url ? `[[${n}]](${item.url})` : `[${n}]`;
      })
      .join("");
  });

  // Tidy the gaps a removed citation or link leaves ("Claim ." → "Claim.").
  text = text.replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").replace(/ +([.,;:!?])/g, "$1").trim();

  if (order.length > 0) {
    const lines = order.map((e, i) => {
      const when = formatTime(e.asOf) ?? formatTime(e.fetchedAt);
      const label = e.url ? `[${e.title}](${e.url})` : e.title;
      return `${i + 1}. ${label} — ${e.source}${when ? `, ${e.asOf ? "as of" : "fetched"} ${when}` : ""}`;
    });
    text += `\n\n**Sources**\n${lines.join("\n")}`;
  }

  return { answer: text, cited: order, unknownCitations, removedUrls };
}
