-- =============================================================================
-- 共通LINE(共有Bot) の org 単位 利用ライフサイクル: 未申込→申込→開通
-- 設計正本: fable 裁定(2026-07-20) / docs/spec/AI_SECRETARY_STAGE4_SHARED_BOT_TENANCY.md
--
-- 背景: これまで isLineSelfServeReady は「共有botが1つでも存在すれば全org ready」で、per-org の
--   申込/開通状態が無かった。そのため申込制/コンシェルジュ導入の期待値制御が効かず、全orgに
--   「LINEを連携」CTA＋group-claim発行が出ていた（Codexレビュー指摘）。
--
-- org_channel_policy に shared_bot_access を足し、group-claim の発行/承認(=新規紐付けの確立境界)を
-- granted の org だけに許す。**既存の紐付け・送信・digest は一切ゲートしない**（CLAUDE.md「新規紐付けの
-- 拒否のみ・既存は切らない」）。
--
-- 状態: none(未申込・既定) / requested(org側が申込) / granted(当社が開通付与、or 既存利用者を backfill)。
-- 付与は service role のみ（allow_code_only と同型）。申込(none→requested)は org 側 self-service。
-- =============================================================================

alter table public.org_channel_policy
  add column if not exists shared_bot_access text not null default 'none'
    check (shared_bot_access in ('none', 'requested', 'granted')),
  add column if not exists shared_bot_access_requested_at timestamptz,
  add column if not exists shared_bot_access_requested_by uuid,
  add column if not exists shared_bot_access_granted_at timestamptz,
  add column if not exists shared_bot_access_granted_by uuid;

comment on column public.org_channel_policy.shared_bot_access is
  '共通LINE(共有Bot)の org 単位利用状態: none(未申込) / requested(申込) / granted(開通)。付与は service role のみ';

-- -----------------------------------------------------------------------------
-- backfill: 共有bot利用の「痕跡」がある org を granted に倒す（既存を絶対に切らないため）。
-- 痕跡 = platform account に紐づく channel_groups が1件でもある(status不問。'left'=過去に正規導入)
--        または allow_code_only=true(当社が信頼確認済みの上位entitlement)。
-- channel 非依存（Discord等の platform 共有botも同じ claim パイプライン）。
-- ※ user-link は platform account を参照できない（composite FK・org_id NULL のため構造上作れない）ので対象外。
-- ※ 未承認の in-flight claim だけを持つ org(痕跡なし)は none になり得るが、承認時の二重チェックで
--    403＋申込導線に落ち、ops が granted にすればコードは失われない（設計正本の受け皿）。
-- -----------------------------------------------------------------------------
with platform_accounts as (
  select id from public.channel_accounts where owner_type = 'platform'
), grant_orgs as (
  select distinct org_id from public.channel_groups
    where account_id in (select id from platform_accounts)
  union
  select org_id from public.org_channel_policy where allow_code_only
)
insert into public.org_channel_policy (org_id, shared_bot_access, shared_bot_access_granted_at)
select org_id, 'granted', now() from grant_orgs
on conflict (org_id) do update
  set shared_bot_access = 'granted',
      shared_bot_access_granted_at =
        coalesce(public.org_channel_policy.shared_bot_access_granted_at, now())
  where public.org_channel_policy.shared_bot_access is distinct from 'granted';

-- =============================================================================
-- 検証（run_org_shared_bot_access.sh）:
--   (最重要・既存を切らない) platform グループを持つ org は granted（status='left' も granted）。
--   allow_code_only=true の org は granted。痕跡なしの既存 org は none。
--   billing トリガー(20260720201858)/resync(205553) の org_channel_policy upsert が
--   shared_bot_access を default 'none' で潰さないこと（それらは monthly_push_quota のみ upsert）。
-- ロールバック:
--   alter table public.org_channel_policy
--     drop column if exists shared_bot_access,
--     drop column if exists shared_bot_access_requested_at,
--     drop column if exists shared_bot_access_requested_by,
--     drop column if exists shared_bot_access_granted_at,
--     drop column if exists shared_bot_access_granted_by;
-- =============================================================================
