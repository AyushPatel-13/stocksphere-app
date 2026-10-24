-- StockSphere · Shared AI rate limit test
--
-- Proves migrations/20261024000100_ai_usage.sql. One transaction ending in
-- ROLLBACK: nothing is saved. Success prints "ALL AI USAGE CHECKS PASSED".

begin;

insert into auth.users (id, aud, role, email) values
  ('00000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'ai-a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated', 'ai-b@example.invalid');

do $$
declare
  r record;
  user_a constant uuid := '00000000-0000-4000-8000-0000000000a1';
  user_b constant uuid := '00000000-0000-4000-8000-0000000000a2';
begin
  -- Three per minute allowed, the fourth refused with a retry time.
  for i in 1..3 loop
    select * into r from public.ai_take_slot(user_a, 3, 10);
    if not r.allowed then raise exception 'FAIL: request % was refused', i; end if;
  end loop;
  select * into r from public.ai_take_slot(user_a, 3, 10);
  if r.allowed or r.reason <> 'minute' or r.retry_after_seconds not between 1 and 60 then
    raise exception 'FAIL: minute limit not enforced (% % %)', r.allowed, r.reason, r.retry_after_seconds;
  end if;
  if (select count(*) from public.ai_usage where user_id = user_a) <> 3 then
    raise exception 'FAIL: a refused request was recorded';
  end if;

  -- Limits are per user.
  select * into r from public.ai_take_slot(user_b, 3, 10);
  if not r.allowed then raise exception 'FAIL: user B was limited by user A''s usage'; end if;

  -- Daily limit, using rows older than a minute.
  update public.ai_usage set created_at = now() - interval '2 hours' where user_id = user_a;
  select * into r from public.ai_take_slot(user_a, 3, 3);
  if r.allowed or r.reason <> 'day' then raise exception 'FAIL: day limit not enforced'; end if;

  -- Rows older than 2 days are cleaned up on the next allowed request.
  update public.ai_usage set created_at = now() - interval '3 days' where user_id = user_a;
  select * into r from public.ai_take_slot(user_a, 3, 3);
  if not r.allowed then raise exception 'FAIL: old usage still counted'; end if;
  if (select count(*) from public.ai_usage where user_id = user_a) <> 1 then
    raise exception 'FAIL: old rows were not cleaned up';
  end if;

  -- Bad arguments are rejected.
  begin
    perform public.ai_take_slot(user_a, 0, 10);
    raise exception 'FAIL: zero limit accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- Members can neither read the table nor call the function.
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

do $$
begin
  begin
    perform 1 from public.ai_usage;
    raise exception 'FAIL: a member could read ai_usage';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.ai_take_slot('00000000-0000-4000-8000-0000000000a1', 1000, 1000);
    raise exception 'FAIL: a member could call ai_take_slot';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

-- Deleting an account removes its usage rows.
delete from auth.users where id = '00000000-0000-4000-8000-0000000000a1';
do $$
begin
  if exists (select 1 from public.ai_usage where user_id = '00000000-0000-4000-8000-0000000000a1') then
    raise exception 'FAIL: deleting an account left usage rows behind';
  end if;
end $$;

select 'ALL AI USAGE CHECKS PASSED' as result;

rollback;
