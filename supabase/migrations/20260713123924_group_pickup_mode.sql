-- =============================================================================
-- AI秘書 Stage 2.5: グループ運用の現実対応パック §1 — 拾い方モード
-- (docs/spec/AI_SECRETARY_STAGE2_5_GROUP_UX.md §1 — 設計正本。逸脱しないこと)
--
-- channel_groups.digest_enabled(boolean) を pickup_mode(text 3値) に置換する。
-- digest_enabled 列自体はロールバック安全のため残すが、コードからの読み書きは全廃する。
-- =============================================================================

alter table public.channel_groups
  add column if not exists pickup_mode text not null default 'all'
  check (pickup_mode in ('all', 'mention_only', 'off'));

-- 既存の digest_enabled=false は off へ引き継ぐ
update public.channel_groups set pickup_mode = 'off' where digest_enabled = false;

comment on column public.channel_groups.pickup_mode is
  '申し送りの拾い方: all=夜間LLM全文抽出 / mention_only=botメンションのみ即時タスク化 / off=抽出・digest配信とも停止。digest_enabled は本列に置換され deprecated（読み取り禁止）';

-- =============================================================================
-- 検証（適用後にservice roleで実施。docs/spec/AI_SECRETARY_STAGE2_5_GROUP_UX.md §5参照）:
--   1) 既存 digest_enabled=false のグループが pickup_mode='off' へバックフィルされていること
--   2) 既存 digest_enabled=true のグループが pickup_mode='all'（既定）のままであること
-- ロールバック:
--   alter table public.channel_groups drop column pickup_mode;
-- =============================================================================
