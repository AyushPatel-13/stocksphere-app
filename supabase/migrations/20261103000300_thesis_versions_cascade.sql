-- StockSphere · Let a deleted account's thesis versions go with it
--
-- thesis_versions_immutable refused every DELETE, including the cascade when
-- a member deletes their account (profiles → theses → thesis_versions), so
-- account deletion would fail for anyone who wrote a thesis. Same rule as
-- prediction_resolutions_immutable: a version may be deleted only once its
-- thesis row is already gone (the cascade); otherwise it stays immutable.
-- Theses themselves are only ever soft-deleted by the app.
--
-- Rollback: re-run the function body from 20261103000200_theses.sql.

create or replace function public.thesis_versions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.theses t where t.id = old.thesis_id) then
    return old;
  end if;
  raise exception 'thesis versions are append-only';
end;
$$;

revoke all on function public.thesis_versions_immutable() from public, anon, authenticated;
