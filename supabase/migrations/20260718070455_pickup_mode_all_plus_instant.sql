-- =============================================================================
-- AI秘書 フェーズ2: LINEグループ「両方同時」モード all_plus_instant（pro以上限定・有料）
-- Fable裁定・確定仕様。詳細は実装差分（entitlements/store/webhookHandler/channel-digest）参照。
--
-- channel_groups.pickup_mode の CHECK 制約に 'all_plus_instant' を追加する。
-- 挙動（all＋mention_only同時・有料ゲート・重複排除）はアプリ層（API/webhook/cron）の責務。
-- このmigrationはDB側の値域拡張のみを行う。冪等・可逆。
-- =============================================================================

alter table public.channel_groups
  drop constraint if exists channel_groups_pickup_mode_check;

alter table public.channel_groups
  add constraint channel_groups_pickup_mode_check
  check (pickup_mode in ('all', 'mention_only', 'off', 'all_plus_instant'));

comment on column public.channel_groups.pickup_mode is
  '申し送りの拾い方: all=夜間LLM全文抽出 / mention_only=botメンションのみ即時タスク化 / '
  'off=抽出・digest配信とも停止 / all_plus_instant=all+mention_onlyを同時実行（フェーズ2・pro以上限定・有料）。'
  'digest_enabled は本列に置換され deprecated（読み取り禁止）';

-- =============================================================================
-- 検証（適用後にservice roleで実施）:
--   1) 既存3値（all/mention_only/off）の行は無変更のままupdate/insertが通ること
--   2) pickup_mode='all_plus_instant' へのupdateが成功すること
--   3) pickup_mode に上記4値以外を入れようとするとCHECK違反で失敗すること
--
-- ロールバック（'all_plus_instant' を使う行が無いことを確認してから実行）:
--   alter table public.channel_groups drop constraint if exists channel_groups_pickup_mode_check;
--   alter table public.channel_groups add constraint channel_groups_pickup_mode_check
--     check (pickup_mode in ('all', 'mention_only', 'off'));
-- =============================================================================
