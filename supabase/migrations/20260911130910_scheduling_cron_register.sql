-- =============================================================================
-- 日程調整の期限切れと催促を定期的に動かす（pg_cron に2本登録する）
--
--   scheduling-expire-proposals  5分ごと   process_scheduling_expirations()
--     期限を過ぎた提案を expired にし、作成者に知らせる
--   scheduling-reminders         15分ごと  process_scheduling_reminders()
--     期限24時間前の催促と、48時間返事のない提案の作成者への催促
--
-- どちらも postgres で登録する（pg_cron は登録したロールの権限で動く）。
-- 同じ名前の job があれば外して作り直すので、何度流しても1本ずつになる。
-- pg_cron が無い環境では何もしない。
--
-- 適用: アプリ稼働中に適用してよい（cron 登録のみ・ほかの job には触れない）。
-- 検証: supabase/tests/run_scheduling_cron_register.sh
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'scheduling-expire-proposals' and username = current_user) then
      perform cron.unschedule('scheduling-expire-proposals');
    end if;
    perform cron.schedule('scheduling-expire-proposals', '*/5 * * * *', 'select public.process_scheduling_expirations()');

    if exists (select 1 from cron.job where jobname = 'scheduling-reminders' and username = current_user) then
      perform cron.unschedule('scheduling-reminders');
    end if;
    perform cron.schedule('scheduling-reminders', '*/15 * * * *', 'select public.process_scheduling_reminders()');
  end if;
end $$;

-- =============================================================================
-- ロールバック（2本を外す。外せばこの migration の前と同じになる）:
--   select cron.unschedule('scheduling-expire-proposals');
--   select cron.unschedule('scheduling-reminders');
-- =============================================================================
