create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-reminders-every-15-min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://wzfpknrgmjfzlqvhvzue.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json')
  );
  $$
);
