-- StockSphere · Trigger functions are not API endpoints
--
-- watchlist_list_owner() (from 20261020000100_watchlists.sql) runs only as a
-- trigger. Supabase's security advisor (0028/0029) flagged that, as a SECURITY
-- DEFINER function in the public schema, it was also callable through
-- /rest/v1/rpc. Revoking EXECUTE doesn't affect the trigger.
--
-- Applied to the StockSphere project on 2026-10-20. Safe to re-run.

revoke all on function public.watchlist_list_owner() from public, anon, authenticated;
