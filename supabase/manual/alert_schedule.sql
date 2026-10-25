-- StockSphere · Run the alert check every 5 minutes from Supabase (Stage C)
--
-- NOT APPLIED, and deliberately not in supabase/migrations: it turns on two
-- extensions and calls production, so it runs only by hand, with approval.
--
-- Before running it, the project owner creates these Vault secrets in the
-- Supabase dashboard (Project Settings → Vault, or SQL), so no one else ever
-- sees their values:
--
--   alerts_check_url      https://<production origin>/api/alerts/check
--   alerts_cron_secret    the same value as CRON_SECRET in Vercel Production
--   vercel_bypass_secret  OPTIONAL: Vercel "Protection Bypass for Automation"
--                         secret, only while Deployment Protection stays on
--
-- Why every 5 minutes, around the clock: the endpoint skips closed markets
-- itself (lib/alerts/service.ts), so off-hours runs cost one database read and
-- no market-data calls, and crypto alerts are covered at night and weekends.
-- 288 calls a day.
--
-- Undo:
--   select cron.unschedule('stocksphere-alert-check');
--   (and, if nothing else uses them) drop extension pg_net; drop extension pg_cron;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('stocksphere-alert-check')
where exists (select 1 from cron.job where jobname = 'stocksphere-alert-check');

select cron.schedule(
  'stocksphere-alert-check',
  '*/5 * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'alerts_check_url'),
      headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'alerts_cron_secret')
        )
        || coalesce(
          (select jsonb_build_object('x-vercel-protection-bypass', decrypted_secret) from vault.decrypted_secrets where name = 'vercel_bypass_secret'),
          '{}'::jsonb
        ),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    );
  $job$
);
