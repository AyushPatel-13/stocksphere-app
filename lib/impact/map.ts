import type { MarketEvent } from "../markets/eventIngest";
import { distinctEvents } from "../markets/eventIngest";
import { MACRO_EVENTS, type MacroEvent } from "./calendar";

/**
 * The Impact Map: upcoming events and what they connect to.
 *
 *   fact       the event is about that company (NSE named it, matched
 *              exactly to the listing). Source: the NSE announcement.
 *   inference  a sector investors often watch around that kind of event.
 *              Labelled as an inference, worded without cause or forecast,
 *              and sourced to the event itself, never presented as a fact.
 *
 * Every link carries a reason and a source.
 */

export type ImpactEventNode = {
  id: string;
  title: string;
  /** The day it happens (meeting's last day for central banks), YYYY-MM-DD in timeZone. */
  date: string;
  dateLabel: string;
  timeZone: "ET" | "IST";
  category: "central_bank" | "corporate_action" | "results";
  source: { name: string; url: string };
};

export type ImpactTarget = { id: string; label: string; href: string | null; kind: "company" | "sector" };

export type ImpactLink = { eventId: string; targetId: string; kind: "fact" | "inference"; reason: string; source: { name: string; url: string } };

export type ImpactMap = { events: ImpactEventNode[]; targets: ImpactTarget[]; links: ImpactLink[] };

const SECTORS: Record<MacroEvent["kind"], { id: string; label: string }[]> = {
  rbi_mpc: [
    { id: "sector-banks", label: "Banks and NBFCs" },
    { id: "sector-realty", label: "Real estate" },
    { id: "sector-autos", label: "Autos" },
  ],
  fomc: [
    { id: "sector-it", label: "Indian IT services" },
    { id: "sector-fx", label: "Rupee–dollar rate" },
    { id: "sector-us-banks", label: "US banks" },
  ],
};

const INFERENCE_REASON: Record<MacroEvent["kind"], string> = {
  rbi_mpc: "Interest-rate-sensitive; investors often watch it around RBI policy decisions.",
  fomc: "Often watched around US Federal Reserve rate decisions.",
};

const KIND_TEXT: Record<string, string> = {
  dividend: "Dividend ex-date",
  buyback: "Buyback record date",
  split: "Split ex-date",
  bonus: "Bonus ex-date",
  rights: "Rights ex-date",
  other: "Corporate action",
  results: "Results meeting",
};

function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

export function macroInWindow(from: string, to: string, events: MacroEvent[] = MACRO_EVENTS): MacroEvent[] {
  return events.filter((event) => event.end >= from && event.end <= to);
}

export function buildImpactMap(input: { macro: MacroEvent[]; market: MarketEvent[] }, maxCompanyEvents = 24): ImpactMap {
  const events: ImpactEventNode[] = [];
  const targets = new Map<string, ImpactTarget>();
  const links: ImpactLink[] = [];

  for (const macro of input.macro) {
    const id = macro.id;
    events.push({
      id,
      title: macro.title,
      date: macro.end,
      dateLabel: macro.start === macro.end ? `${dayLabel(macro.end)} (${macro.timeZone})` : `${dayLabel(macro.start)} – ${dayLabel(macro.end)} (${macro.timeZone}); decision time not given`,
      timeZone: macro.timeZone,
      category: "central_bank",
      source: macro.source,
    });
    for (const sector of SECTORS[macro.kind]) {
      targets.set(sector.id, { ...sector, href: null, kind: "sector" });
      links.push({ eventId: id, targetId: sector.id, kind: "inference", reason: INFERENCE_REASON[macro.kind], source: macro.source });
    }
  }

  const company = distinctEvents(input.market).filter((e) => e.mapped && e.symbol && e.eventDate && e.kind !== "board_meeting").slice(0, maxCompanyEvents);
  for (const e of company) {
    const id = `nse-${e.id}`;
    const source = { name: "NSE announcement", url: e.sourceUrl };
    events.push({
      id,
      title: `${e.symbol}: ${KIND_TEXT[e.kind] ?? "Corporate action"}`,
      date: e.eventDate!,
      dateLabel: `${dayLabel(e.eventDate!)} (IST)`,
      timeZone: "IST",
      category: e.kind === "results" ? "results" : "corporate_action",
      source,
    });
    const targetId = `company-${e.symbol}`;
    targets.set(targetId, {
      id: targetId,
      label: e.symbol!,
      href: e.kind === "results" ? `/earnings/${encodeURIComponent(e.symbol!)}/${e.eventDate}` : `/stock/${encodeURIComponent(e.symbol!)}`,
      kind: "company",
    });
    links.push({ eventId: id, targetId, kind: "fact", reason: `NSE announced it for ${e.company}: ${e.purpose || KIND_TEXT[e.kind]}.`, source });
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  return { events, targets: [...targets.values()], links };
}
