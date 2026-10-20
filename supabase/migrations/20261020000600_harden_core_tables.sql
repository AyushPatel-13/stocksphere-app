-- StockSphere · Harden the original tables (watchlist, portfolio, activity)
--
-- Supersedes 20261019000200_owner_columns.sql (never applied); includes its
-- changes. Checked against the live project on 2026-10-20 (read-only): 6
-- watchlist rows, 0 portfolio rows, 1 activity row; no row without an owner,
-- no row whose owner no longer exists, no duplicate watchlist symbols.
--
-- What it changes, and why
--   1. Grants: anon (signed-out visitors) loses every privilege on these
--      three private tables — it held ALL, including TRUNCATE, which RLS does
--      not govern. Signed-in users keep only SELECT/INSERT/UPDATE/DELETE.
--   2. Ownership columns: user_id defaults to the signed-in user and can't be
--      NULL. portfolio.user_id used to default to a RANDOM uuid.
--   3. Foreign keys to auth.users with ON DELETE CASCADE, so deleting a user's
--      account removes their private data (the beta privacy notice promises
--      deletion on request).
--   4. watchlist.created_at defaulted to a fixed date (2026-06-25) — every
--      row got the same time. Now now().
--   5. Portfolio sanity: quantity and buy price must be positive.
--   6. The two UPDATE policies re-evaluated auth.uid() per row (Supabase
--      performance advisor); rewritten as (select auth.uid()). The portfolio
--      one was also misnamed "...watchlist".
--   7. An index for post_reports.reporter_id (performance advisor).
--
-- No row is changed or deleted. Every step is guarded and safe to re-run.
-- Rollback notes at the bottom.

begin;

-- ---------------------------------------------------------------- safety check
do $$
declare
  bad int;
begin
  select (select count(*) from public.watchlist where user_id is null)
       + (select count(*) from public.portfolio where user_id is null)
       + (select count(*) from public.activity where user_id is null)
       + (select count(*) from public.watchlist w where not exists (select 1 from auth.users u where u.id = w.user_id))
       + (select count(*) from public.portfolio p where not exists (select 1 from auth.users u where u.id = p.user_id))
       + (select count(*) from public.activity a where not exists (select 1 from auth.users u where u.id = a.user_id))
       + (select count(*) from public.portfolio where quantity <= 0 or buy_price <= 0)
  into bad;
  if bad > 0 then
    raise exception 'Stopped: % row(s) have no owner, a deleted owner, or a non-positive quantity/price. Review them first.', bad;
  end if;
end $$;

-- ---------------------------------------------------------------- 1. grants
revoke all on public.watchlist, public.portfolio, public.activity from anon;
revoke all on public.watchlist, public.portfolio, public.activity from authenticated;
grant select, insert, update, delete on public.watchlist, public.portfolio, public.activity to authenticated;

-- ---------------------------------------------------------------- 2. ownership columns
alter table public.watchlist alter column user_id set default auth.uid();
alter table public.portfolio alter column user_id set default auth.uid();
alter table public.portfolio alter column user_id set not null;
alter table public.activity alter column user_id set default auth.uid();
alter table public.activity alter column user_id set not null;

-- ---------------------------------------------------------------- 3. foreign keys
alter table public.watchlist drop constraint if exists watchlist_user_id_fkey;
alter table public.watchlist add constraint watchlist_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;
alter table public.portfolio drop constraint if exists portfolio_user_id_fkey;
alter table public.portfolio add constraint portfolio_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;
alter table public.activity drop constraint if exists activity_user_id_fkey;
alter table public.activity add constraint activity_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete cascade;

create index if not exists watchlist_user_idx on public.watchlist (user_id);
create index if not exists portfolio_user_idx on public.portfolio (user_id);
create index if not exists activity_user_idx on public.activity (user_id, created_at desc);

-- ---------------------------------------------------------------- 4. watchlist created_at
alter table public.watchlist alter column created_at set default now();

-- ---------------------------------------------------------------- 5. portfolio sanity
alter table public.portfolio drop constraint if exists portfolio_quantity_positive;
alter table public.portfolio add constraint portfolio_quantity_positive check (quantity > 0);
alter table public.portfolio drop constraint if exists portfolio_buy_price_positive;
alter table public.portfolio add constraint portfolio_buy_price_positive check (buy_price > 0);

-- ---------------------------------------------------------------- 6. update policies
drop policy if exists "Users can update their own watchlist" on public.watchlist;
create policy "Users can update their own watchlist" on public.watchlist
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own watchlist" on public.portfolio;
drop policy if exists "Users can update their own holdings" on public.portfolio;
create policy "Users can update their own holdings" on public.portfolio
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------- 7. index
create index if not exists post_reports_reporter_idx on public.post_reports (reporter_id);

commit;

-- Rollback (restores the previous behaviour; no data involved):
--   grant all on public.watchlist, public.portfolio, public.activity to anon, authenticated;
--   alter table public.portfolio alter column user_id drop not null, alter column user_id set default gen_random_uuid();
--   alter table public.activity alter column user_id drop not null, alter column user_id drop default;
--   alter table public.watchlist drop constraint watchlist_user_id_fkey;
--   alter table public.portfolio drop constraint portfolio_user_id_fkey, drop constraint portfolio_quantity_positive, drop constraint portfolio_buy_price_positive;
--   alter table public.activity drop constraint activity_user_id_fkey;
