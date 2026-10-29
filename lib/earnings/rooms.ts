import { distinctEvents, ingestIfDue, type MarketEvent, type MarketEventStore } from "../markets/eventIngest";

/**
 * Earnings rooms: one per company per results meeting NSE announced (a
 * board meeting "to consider financial results", in market_events). The room
 * is identified by its listing and meeting date, so there is exactly one per
 * meeting by construction; it isn't a separate record anyone can create.
 *
 * State comes only from the meeting date NSE gave. NSE gives a date, not a
 * time, so a room is never shown as "live": on the day it's "results day",
 * and afterwards it points to NSE for the published results.
 *
 * US companies aren't covered: their dates come only from Finnhub, whose
 * licence doesn't permit showing them in a new feature.
 */

export type RoomState = "upcoming" | "this_week" | "results_day" | "results_due" | "archived";

export const ROOM_STATE_LABEL: Record<RoomState, string> = {
  upcoming: "Upcoming",
  this_week: "This week",
  results_day: "Results day",
  results_due: "Meeting held",
  archived: "Archived",
};

export type EarningsRoom = {
  symbol: string;
  isin: string | null;
  company: string;
  meetingDate: string;
  purpose: string;
  sourceUrl: string;
  publishedAt: string | null;
  state: RoomState;
  daysAway: number;
};

const DAY = 86_400_000;
const IST = 5.5 * 3_600_000;

export function istDay(time: number): string {
  return new Date(time + IST).toISOString().slice(0, 10);
}

export function roomState(meetingDate: string, now: number): { state: RoomState; daysAway: number } {
  const daysAway = Math.round((Date.parse(`${meetingDate}T00:00:00Z`) - Date.parse(`${istDay(now)}T00:00:00Z`)) / DAY);
  const state: RoomState = daysAway > 7 ? "upcoming" : daysAway > 0 ? "this_week" : daysAway === 0 ? "results_day" : daysAway >= -14 ? "results_due" : "archived";
  return { state, daysAway };
}

/** Rooms from stored events: mapped results meetings only, one per listing and date. */
export function roomsFrom(events: MarketEvent[], now: number): EarningsRoom[] {
  const seen = new Set<string>();
  const rooms: EarningsRoom[] = [];
  for (const event of distinctEvents(events)) {
    if (event.kind !== "results" || !event.mapped || !event.symbol || !event.eventDate) continue;
    const key = `${event.symbol}|${event.eventDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rooms.push({
      symbol: event.symbol,
      isin: event.isin,
      company: event.company,
      meetingDate: event.eventDate,
      purpose: event.purpose,
      sourceUrl: event.sourceUrl,
      publishedAt: event.publishedAt,
      ...roomState(event.eventDate, now),
    });
  }
  return rooms.sort((a, b) => a.meetingDate.localeCompare(b.meetingDate) || a.symbol.localeCompare(b.symbol));
}

export async function listRooms(store: MarketEventStore, now: number, refresh = ingestIfDue): Promise<EarningsRoom[]> {
  await refresh(store);
  const events = await store.list({ from: istDay(now - 14 * DAY), to: istDay(now + 45 * DAY), limit: 300 });
  return roomsFrom(events, now).filter((room) => room.state !== "archived");
}

export async function getRoom(store: MarketEventStore, symbol: string, meetingDate: string, now: number): Promise<EarningsRoom | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(meetingDate)) return null;
  const events = await store.list({ symbol, from: meetingDate, to: meetingDate, limit: 10 });
  return roomsFrom(events, now)[0] ?? null;
}

export function roomHref(room: Pick<EarningsRoom, "symbol" | "meetingDate">): string {
  return `/earnings/${encodeURIComponent(room.symbol)}/${room.meetingDate}`;
}
