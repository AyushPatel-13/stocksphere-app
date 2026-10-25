-- StockSphere · Shared rate limit for StockSphere AI
--
-- Every AI answer costs provider quota (Gemini / Groq free tiers, or real
-- money once a paid provider key is added). The old limiter lived in server
-- memory, so on Vercel each serverless instance had its own count and a
-- redeploy reset it. This moves the count into Postgres, shared by every
-- instance:
--
--   ai_usage           one row per AI answer the server actually generated
--                      (cached repeats are not recorded). Server-only: RLS
--                      is on with no policies, and anon/authenticated have
--                      no privileges, so the browser can't read or write it.
--   ai_take_slot(...)  atomically checks the caller's per-minute and per-day
--                      counts and, if under both, records the new request.
--                      A per-user advisory lock makes two parallel requests
--                      queue rather than both slipping under the limit.
--                      Callable only by the service role.
--
-- Rows older than 2 days are deleted as each user makes new requests, so the
-- table stays small. Deleting an account removes its rows (on delete cascade).
--
-- Additive only: creates one table and one function, changes nothing else.
-- Rollback:
--   drop function if exists public.ai_take_slot(uuid, integer, integer);
--   drop table if exists public.ai_usage;
--
-- Review before applying. Safe to re-run.

create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_user_time_idx on public.ai_usage (user_id, created_at desc);

alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from public, anon, authenticated;

create or replace function public.ai_take_slot(
  p_user uuid,
  p_per_minute integer,
  p_per_day integer
)
returns table (allowed boolean, reason text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  minute_count integer;
  day_count integer;
  oldest_in_window timestamptz;
begin
  if p_user is null or p_per_minute < 1 or p_per_day < 1 then
    raise exception 'ai_take_slot: invalid arguments' using errcode = '22023';
  end if;

  -- One request at a time per user, until this transaction ends.
  perform pg_advisory_xact_lock(hashtextextended('ai_usage:' || p_user::text, 0));

  select count(*) into day_count
  from public.ai_usage
  where user_id = p_user and created_at > now() - interval '1 day';

  if day_count >= p_per_day then
    select min(created_at) into oldest_in_window
    from public.ai_usage
    where user_id = p_user and created_at > now() - interval '1 day';
    return query select false, 'day'::text,
      greatest(1, ceil(extract(epoch from (oldest_in_window + interval '1 day' - now())))::integer);
    return;
  end if;

  select count(*) into minute_count
  from public.ai_usage
  where user_id = p_user and created_at > now() - interval '1 minute';

  if minute_count >= p_per_minute then
    select min(created_at) into oldest_in_window
    from public.ai_usage
    where user_id = p_user and created_at > now() - interval '1 minute';
    return query select false, 'minute'::text,
      greatest(1, ceil(extract(epoch from (oldest_in_window + interval '1 minute' - now())))::integer);
    return;
  end if;

  insert into public.ai_usage (user_id) values (p_user);

  delete from public.ai_usage
  where user_id = p_user and created_at < now() - interval '2 days';

  return query select true, null::text, 0;
end;
$$;

revoke all on function public.ai_take_slot(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_take_slot(uuid, integer, integer) to service_role;
