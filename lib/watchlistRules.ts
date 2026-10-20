/**
 * Pure rules for named watchlists, shared by the browser client and tests.
 */

export const MAX_LISTS = 10;
export const MAX_NAME_LENGTH = 40;

/** PostgREST / Postgres "relation doesn't exist" — the migration isn't applied. */
export function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|could not find the table/i.test(error.message ?? "");
}

export function cleanListName(raw: string): string | null {
  const name = raw.replace(/\s+/g, " ").trim();
  return name.length >= 1 && name.length <= MAX_NAME_LENGTH ? name : null;
}
