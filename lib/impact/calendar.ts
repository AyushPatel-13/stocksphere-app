/**
 * Central-bank meetings, copied from the banks' own pages (checked 29 Oct
 * 2026). Dates only: neither source gives a decision time on these pages, so
 * none is shown. Add a row only with its source; never an expected date.
 *
 *   FOMC: federalreserve.gov "Meeting calendars and information" (2026, 2027).
 *   RBI MPC: the October 2026 MPC resolution, which names the next meeting.
 *     Later RBI dates are added as each resolution announces them.
 */

export type MacroEvent = {
  id: string;
  kind: "fomc" | "rbi_mpc";
  title: string;
  /** First and last day of the meeting, in the bank's own time zone. */
  start: string;
  end: string;
  timeZone: "ET" | "IST";
  source: { name: string; url: string };
};

const FOMC_SOURCE = { name: "Federal Reserve: FOMC meeting calendar", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" };
const RBI_OCT_2026 = { name: "RBI: Resolution of the MPC, October 5 to 7, 2026", url: "https://www.rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=63742" };

const fomc = (start: string, end: string): MacroEvent => ({ id: `fomc-${end}`, kind: "fomc", title: "US Federal Reserve (FOMC) meeting", start, end, timeZone: "ET", source: FOMC_SOURCE });

export const MACRO_EVENTS: MacroEvent[] = [
  fomc("2026-10-27", "2026-10-28"),
  fomc("2026-12-08", "2026-12-09"),
  fomc("2027-01-26", "2027-01-27"),
  fomc("2027-03-16", "2027-03-17"),
  fomc("2027-04-27", "2027-04-28"),
  fomc("2027-06-08", "2027-06-09"),
  fomc("2027-07-27", "2027-07-28"),
  fomc("2027-09-14", "2027-09-15"),
  fomc("2027-10-26", "2027-10-27"),
  fomc("2027-12-07", "2027-12-08"),
  { id: "rbi-2026-12-04", kind: "rbi_mpc", title: "RBI Monetary Policy Committee meeting", start: "2026-12-02", end: "2026-12-04", timeZone: "IST", source: RBI_OCT_2026 },
];
