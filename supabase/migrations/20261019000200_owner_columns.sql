-- StockSphere · Phase 0 · Ownership columns on existing tables
--
-- Verified from your query 5 output (2026-10-19):
--   portfolio.user_id  nullable, DEFAULT gen_random_uuid()   ← wrong
--   activity.user_id   nullable, no default                   ← weak
--   watchlist.user_id  NOT NULL, no default                   ← fine
--
-- gen_random_uuid() on an ownership column means a row inserted without a
-- user_id belongs to a random, non-existent user. Every row must belong to the
-- user who created it, so the default becomes auth.uid() and NULL is refused.
--
-- This migration deliberately does NOT touch the 12 existing RLS policies:
-- they have not been reviewed yet (query 1 output still needed).
--
-- GUARDED: if any existing row has no owner, the migration stops before
-- changing anything and tells you how many, so no data is altered or lost.

do $$
declare
  orphan_portfolio int;
  orphan_activity int;
begin
  select count(*) into orphan_portfolio from public.portfolio where user_id is null;
  select count(*) into orphan_activity from public.activity where user_id is null;

  if orphan_portfolio > 0 or orphan_activity > 0 then
    raise exception
      'Stopped: % portfolio row(s) and % activity row(s) have no user_id. Review them before applying this migration.',
      orphan_portfolio, orphan_activity;
  end if;

  -- Rows that got a random owner from the old default point at no real user.
  -- They are reported, not changed: nobody can see them under RLS anyway.
  select count(*) into orphan_portfolio
  from public.portfolio p
  where not exists (select 1 from auth.users u where u.id = p.user_id);

  if orphan_portfolio > 0 then
    raise notice '% portfolio row(s) belong to no existing user (likely from the old random default).',
      orphan_portfolio;
  end if;
end $$;

alter table public.portfolio
  alter column user_id set default auth.uid(),
  alter column user_id set not null;

alter table public.activity
  alter column user_id set default auth.uid(),
  alter column user_id set not null;

alter table public.watchlist
  alter column user_id set default auth.uid();
