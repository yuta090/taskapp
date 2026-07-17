-- =============================================================================
-- AI秘書: channel-digest cron を JST営業時間帯(8:00〜20:00)の毎時実行に変更
--
-- 背景: PC版LINEはbotへの本物メンションを付与できない（実測確認済み。PCの`@名前`は
-- ただの文字列で mention 情報が乗らない）。mention_only グループのPCユーザーは
-- 「@秘書」「タスク追加」の非メンション合図（webhookHandler.ts側で対応）で即時タスク化できるが、
-- all モードは夜間の自動抽出cronに委ねている。1日1回（JST7:00）では取りこぼし・気づきの
-- 遅延が大きいため、営業時間帯（JST8:00〜20:00）は毎時実行に頻度を上げ、PC/全端末を問わず
-- 自動抽出の取りこぼしを減らす。
--
-- 変更前: '0 22 * * *'（UTC）= JST 7:00、1日1回（20260711073329_channel_groups_digest.sql）
-- 変更後: '0 23,0-11 * * *'（UTC）= JST 8:00〜20:00 の毎時
--   JST8:00→UTC23:00(前日) / JST9:00→UTC0:00 / … / JST20:00→UTC11:00
--
-- ジョブ名・実行コマンドは維持する（jobname='channel-digest' / select app_invoke_channel_digest()）。
-- 冪等: 既存ジョブがあれば unschedule してから同名で再登録する。pg_cron 拡張が無い環境ではno-op。
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'channel-digest') then
      perform cron.unschedule('channel-digest');
    end if;
    perform cron.schedule('channel-digest', '0 23,0-11 * * *', 'select app_invoke_channel_digest()');
  end if;
end $$;

-- =============================================================================
-- 検証（適用後・service role）:
--   1) select jobname, schedule from cron.job where jobname = 'channel-digest';
--      → schedule = '0 23,0-11 * * *' であること。
--   2) JST 20:00〜翌8:00 の間は実行されず、JST 8:00〜20:00 は毎時実行されること
--      （cron.job_run_details で確認）。
-- ロールバック（1日1回・JST7:00に戻す場合）:
--   do $$
--   begin
--     if exists (select 1 from pg_extension where extname = 'pg_cron') then
--       if exists (select 1 from cron.job where jobname = 'channel-digest') then
--         perform cron.unschedule('channel-digest');
--       end if;
--       perform cron.schedule('channel-digest', '0 22 * * *', 'select app_invoke_channel_digest()');
--     end if;
--   end $$;
-- =============================================================================
