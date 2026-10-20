-- StockSphere · Prediction results (Phase 2: resolution and scoring)
--
-- Requires 20261019000400_predictions.sql.
--
--   prediction_resolutions  one immutable result per prediction: the exit
--                           price and session it came from, the outcome, the
--                           points and the scoring version + config
--                           fingerprint used, so every score can be re-checked.
--   prediction_record_resolution()
--                           the only way a result is written: inserts the
--                           result, moves the prediction out of 'open' (the
--                           predictions lock allows exactly one such move) and
--                           recomputes the member's counters, in one transaction.
--                           Callable by the app server (service role) only.
--
-- Review before applying. Safe to re-run.

create table if not exists public.prediction_resolutions (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null unique references public.predictions (id) on delete cascade,
  outcome text not null
    constraint prediction_resolutions_outcome check (outcome in ('correct', 'incorrect', 'flat', 'void', 'review')),
  counted boolean not null,
  reason text,
  exit_price numeric check (exit_price is null or exit_price > 0),
  exit_session date,
  exit_source text,
  move_pct numeric,
  band_pct numeric not null,
  region_error_pct numeric,
  target_error_pct numeric,
  target_reached boolean,
  direction_points integer not null default 0,
  target_points integer not null default 0,
  total_points integer not null default 0,
  scoring_version text not null,
  config_fingerprint text not null,
  resolved_at timestamptz not null default now(),
  constraint prediction_resolutions_points check (total_points = direction_points + target_points),
  constraint prediction_resolutions_uncounted_zero check (counted or total_points = 0)
);

create index if not exists prediction_resolutions_resolved_idx on public.prediction_resolutions (resolved_at desc);

-- Results can never be edited. They can be deleted only as part of deleting
-- the prediction they belong to (an account deletion cascades through
-- profiles -> predictions -> results); a direct delete is refused.
create or replace function public.prediction_resolutions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.predictions p where p.id = old.prediction_id) then
    return old;
  end if;
  raise exception 'prediction results are immutable';
end;
$$;

drop trigger if exists prediction_resolutions_immutable on public.prediction_resolutions;
create trigger prediction_resolutions_immutable
  before update or delete on public.prediction_resolutions
  for each row execute function public.prediction_resolutions_immutable();

-- ---------------------------------------------------------------- record a result

create or replace function public.prediction_record_resolution(
  p_prediction uuid,
  p_outcome text,
  p_counted boolean,
  p_reason text,
  p_exit_price numeric,
  p_exit_session date,
  p_exit_source text,
  p_move_pct numeric,
  p_band_pct numeric,
  p_region_error_pct numeric,
  p_target_error_pct numeric,
  p_target_reached boolean,
  p_direction_points integer,
  p_target_points integer,
  p_scoring_version text,
  p_config_fingerprint text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  -- Lock the prediction; only an open one can be resolved, once.
  select user_id into v_user from predictions where id = p_prediction and status = 'open' for update;
  if v_user is null then
    return false;
  end if;

  insert into prediction_resolutions (
    prediction_id, outcome, counted, reason, exit_price, exit_session, exit_source, move_pct, band_pct,
    region_error_pct, target_error_pct, target_reached, direction_points, target_points, total_points,
    scoring_version, config_fingerprint
  ) values (
    p_prediction, p_outcome, p_counted, p_reason, p_exit_price, p_exit_session, p_exit_source, p_move_pct, p_band_pct,
    p_region_error_pct, p_target_error_pct, p_target_reached, p_direction_points, p_target_points,
    p_direction_points + p_target_points, p_scoring_version, p_config_fingerprint
  );

  update predictions set status = p_outcome where id = p_prediction;

  -- Counters from scratch, so they always equal the results table.
  update profiles set
    pred_resolved = s.resolved,
    pred_wins = s.wins,
    pred_points = s.points
  from (
    select
      count(*) filter (where r.counted) as resolved,
      count(*) filter (where r.counted and r.outcome = 'correct') as wins,
      coalesce(sum(r.total_points) filter (where r.counted), 0) as points
    from prediction_resolutions r
    join predictions p on p.id = r.prediction_id
    where p.user_id = v_user
  ) s
  where profiles.id = v_user;

  return true;
end;
$$;

revoke all on function public.prediction_record_resolution(uuid, text, boolean, text, numeric, date, text, numeric, numeric, numeric, numeric, boolean, integer, integer, text, text) from public, anon, authenticated;
grant execute on function public.prediction_record_resolution(uuid, text, boolean, text, numeric, date, text, numeric, numeric, numeric, numeric, boolean, integer, integer, text, text) to service_role;

-- ---------------------------------------------------------------- privileges and RLS

revoke all on public.prediction_resolutions from anon, authenticated;
grant select on public.prediction_resolutions to anon, authenticated;

alter table public.prediction_resolutions enable row level security;
drop policy if exists "prediction results are public" on public.prediction_resolutions;
create policy "prediction results are public" on public.prediction_resolutions
  for select to anon, authenticated using (true);
